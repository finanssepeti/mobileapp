/**
 * Piyasa ağ geçidi — Yahoo chart + TEFAS YAT tek çıkış noktası; Redis veya bellek önbelleği + single-flight.
 *
 * Çalıştırma: cd market-gateway && npm install && npm start
 * veya kökten: npm run market-gateway
 *
 * Ortam:
 *   PORT (varsayılan 8790)
 *   REDIS_URL — örn. redis://127.0.0.1:6379  (yoksa sadece process belleği; tek instance için yeterli)
 *   GATEWAY_RATE_LIMIT_PER_MIN — IP başına dakikada max istek (varsayılan 400)
 *   CACHE_YAHOO_MS — Yahoo önbellek TTL (varsayılan 45000)
 *   CACHE_TEFAS_MS — TEFAS listesi TTL (varsayılan 600000)
 */

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8790);
const CACHE_YAHOO_MS = Number(process.env.CACHE_YAHOO_MS || 45_000);
const CACHE_TEFAS_MS = Number(process.env.CACHE_TEFAS_MS || 10 * 60 * 1000);
const RATE_LIMIT = Math.max(30, Number(process.env.GATEWAY_RATE_LIMIT_PER_MIN || 400));

const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const TEFAS_ROOT = "https://www.tefas.gov.tr";
const TEFAS_INFO_API = `${TEFAS_ROOT}/api/DB/BindHistoryInfo`;
const TEFAS_REFERER_PAGE = `${TEFAS_ROOT}/TarihselVeriler.aspx`;
const TEFAS_UA = YF_HEADERS["User-Agent"];

function tefasBindHistoryBody(bastarih, bittarih, fonkod) {
  return new URLSearchParams({
    fontip: "YAT",
    sfontur: "",
    fonkod: (fonkod || "").trim().toUpperCase(),
    fongrup: "",
    bastarih,
    bittarih,
    fonturkod: "",
    fonunvantip: "",
    kurucukod: "",
  }).toString();
}

function tefasBindHistoryParse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { httpSnippet: text.slice(0, 280) };
  }
  const f = json?.fault;
  const fc = f?.faultCode;
  const fs = typeof f?.faultString === "string" ? f.faultString.replace(/\s+/g, " ").trim() : "";
  if (fc || fs) return { faultSnippet: `${fc ?? "fault"}${fs ? `: ${fs.slice(0, 220)}` : ""}` };

  const data = json?.data;
  if (!Array.isArray(data)) return {};
  const rows = data.filter((x) => x && typeof x === "object");
  return { rows };
}

/** @type {import('redis').RedisClientType | null} */
let redis = null;

const memCache = new Map();
const inflight = new Map();

function memGet(key) {
  const row = memCache.get(key);
  if (!row) return null;
  if (Date.now() >= row.exp) {
    memCache.delete(key);
    return null;
  }
  return row.val;
}

function memSet(key, val, ttlMs) {
  memCache.set(key, { val, exp: Date.now() + ttlMs });
}

async function cacheGetJson(key) {
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return memGet(key);
}

async function cacheSetJson(key, obj, ttlMs) {
  const s = JSON.stringify(obj);
  if (redis) {
    try {
      await redis.set(key, s, { PX: ttlMs });
    } catch {
      memSet(key, obj, ttlMs);
    }
    return;
  }
  memSet(key, obj, ttlMs);
}

async function withInflight(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function cachedCompute(cacheKey, ttlMs, compute) {
  const hit = await cacheGetJson(cacheKey);
  if (hit != null) return hit;
  return withInflight(cacheKey, async () => {
    const again = await cacheGetJson(cacheKey);
    if (again != null) return again;
    const fresh = await compute();
    await cacheSetJson(cacheKey, fresh, ttlMs);
    return fresh;
  });
}

const rateBucket = new Map();

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateOk(ip) {
  const now = Date.now();
  const w = 60_000;
  let b = rateBucket.get(ip);
  if (!b || now - b.start >= w) {
    b = { start: now, n: 0 };
    rateBucket.set(ip, b);
  }
  b.n += 1;
  return b.n <= RATE_LIMIT;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

function nearestWeekday(d = new Date()) {
  const x = new Date(d);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
  const dd = String(x.getDate()).padStart(2, "0");
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const yyyy = x.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function cookieHeaderFromResponse(res) {
  const h = res.headers;
  if (typeof h.getSetCookie === "function") {
    const parts = h.getSetCookie();
    if (parts?.length) return parts.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  }
  const single = h.get("set-cookie");
  if (!single) return "";
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function fetchYatRows(bastarih, bittarih, fonkod) {
  const bodyStr = tefasBindHistoryBody(bastarih, bittarih, fonkod);
  const attempts = [];

  const trySlice = async (cookie, ajaxWanted) => {
    const headers = {
      "User-Agent": TEFAS_UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: TEFAS_REFERER_PAGE,
      Origin: TEFAS_ROOT,
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      ...(ajaxWanted ? { "X-Requested-With": "XMLHttpRequest" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    };
    const r = await fetch(TEFAS_INFO_API, { method: "POST", headers, body: bodyStr });
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      attempts.push(`HTTP ${r.status} ${text.slice(0, 180)}`);
      return null;
    }
    const parsed = tefasBindHistoryParse(text);
    if (parsed?.faultSnippet) {
      attempts.push(parsed.faultSnippet);
      return null;
    }
    if (parsed?.httpSnippet) {
      attempts.push(parsed.httpSnippet.slice(0, 180));
      return null;
    }
    const rows = parsed?.rows ?? [];
    if (rows.length) return rows;
    attempts.push("data[] boş veya eksik");
    return null;
  };

  const cookieFromReferer = async () => {
    const rHome = await fetch(TEFAS_REFERER_PAGE, {
      headers: {
        "User-Agent": TEFAS_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
    });
    await rHome.text().catch(() => "");
    return cookieHeaderFromResponse(rHome);
  };

  for (const ajaxWanted of [false, true]) {
    const a = await trySlice("", ajaxWanted);
    if (a) return a;
    const cookie = await cookieFromReferer();
    const b = await trySlice(cookie, ajaxWanted);
    if (b) return b;
  }

  const tail = attempts.length ? attempts[attempts.length - 1] : "bilinmeyen";
  throw new Error(`TEFAS ERR (BindHistory): ${tail.slice(0, 240)}`);
}

function parseYatFunds(rows, bastarih) {
  const byCode = new Map();
  for (const row of rows) {
    const code = String(row.FONKODU ?? "")
      .trim()
      .toUpperCase();
    if (!code) continue;
    const title = String(row.FONUNVAN ?? "").trim() || code;
    let price = null;
    const raw = row.FIYAT;
    if (raw != null) {
      const n = Number(raw);
      price = Number.isFinite(n) ? n : null;
    }
    const prev = byCode.get(code);
    if (!prev) {
      byCode.set(code, { code, name: title, price });
    } else {
      if (price != null) prev.price = price;
      if (title.length >= (prev.name?.length ?? 0)) prev.name = title;
    }
  }
  const funds = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, "tr"));
  return { asOf: bastarih, count: funds.length, funds };
}

function safeYahooSymbol(sym) {
  const s = String(sym || "").trim();
  if (!s || s.length > 48) return null;
  if (!/^[A-Za-z0-9=^:\-.,]+$/.test(s)) return null;
  return s;
}

async function fetchYahooSliceDirect(symbol) {
  const enc = encodeURIComponent(symbol);
  const bust = `&_=${Date.now()}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d${bust}`;
  const r = await fetch(url, { headers: YF_HEADERS, cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : undefined;
  if (price === undefined || !Number.isFinite(price)) return null;
  const prev =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : undefined;
  const change = typeof prev === "number" && Number.isFinite(prev) ? price - prev : undefined;
  const changePct =
    change !== undefined && prev !== undefined && prev !== 0 ? (change / prev) * 100 : undefined;
  return { price, change, changePct };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  let url;
  try {
    url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  } catch {
    json(res, 400, { error: "Bad URL" });
    return;
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health") {
    json(res, 200, {
      ok: true,
      redis: Boolean(redis?.isOpen),
      cacheYahooMs: CACHE_YAHOO_MS,
      cacheTefasMs: CACHE_TEFAS_MS,
    });
    return;
  }

  if (!path.startsWith("/v1/")) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const ip = clientIp(req);
  if (!rateOk(ip)) {
    json(res, 429, { error: "Too many requests" });
    return;
  }

  try {
    if (path === "/v1/yahoo/chart") {
      const sym = safeYahooSymbol(url.searchParams.get("symbol") || "");
      if (!sym) {
        json(res, 400, { detail: "Geçersiz symbol" });
        return;
      }
      const cacheKey = `yahoo:chart:${sym}`;
      const slice = await withInflight(`fly:${cacheKey}`, async () => {
        const hit = await cacheGetJson(cacheKey);
        if (hit && typeof hit.price === "number") return hit;
        const fresh = await fetchYahooSliceDirect(sym);
        if (fresh) await cacheSetJson(cacheKey, fresh, CACHE_YAHOO_MS);
        return fresh;
      });
      if (!slice) {
        json(res, 502, { detail: "Yahoo yanıtı alınamadı" });
        return;
      }
      json(res, 200, slice);
      return;
    }

    if (path === "/v1/tefas/yat-funds") {
      const date = url.searchParams.get("date");
      let bastarih;
      let bittarih;
      if (date) {
        if (date.length !== 10 || date[2] !== "." || date[5] !== ".") {
          json(res, 400, { detail: "date formatı dd.mm.yyyy olmalı" });
          return;
        }
        bastarih = bittarih = date;
      } else {
        bastarih = bittarih = nearestWeekday();
      }
      const cacheKey = `tefas:yat:${bastarih}`;
      const payload = await cachedCompute(cacheKey, CACHE_TEFAS_MS, async () => {
        const rows = await fetchYatRows(bastarih, bittarih, "");
        return parseYatFunds(rows, bastarih);
      });
      json(res, 200, payload);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    json(res, 502, { detail: msg.slice(0, 240) });
  }
});

async function main() {
  const redisUrl = (process.env.REDIS_URL || "").trim();
  if (redisUrl) {
    try {
      const { createClient } = await import("redis");
      redis = createClient({ url: redisUrl });
      redis.on("error", (err) => console.error("[market-gateway] Redis:", err?.message || err));
      await redis.connect();
      console.log("[market-gateway] Redis bağlı:", redisUrl.replace(/:[^:@/]+@/, ":****@"));
    } catch (e) {
      console.error("[market-gateway] Redis açılamadı, bellek önbelleği kullanılacak:", e?.message || e);
      redis = null;
    }
  } else {
    console.log("[market-gateway] REDIS_URL yok — tek süreç içi bellek önbelleği (çok instance için Redis önerilir)");
  }

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`[market-gateway] Port ${PORT} kullanımda. PORT=8791 npm start`);
      process.exit(1);
      return;
    }
    console.error("[market-gateway]", err);
    process.exit(1);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[market-gateway] http://0.0.0.0:${PORT}  Yahoo TTL=${CACHE_YAHOO_MS}ms TEFAS TTL=${CACHE_TEFAS_MS}ms`,
    );
    console.log(`  Mobil: EXPO_PUBLIC_MARKET_GATEWAY_URL=https://<sunucu>:${PORT}`);
  });
}

void main();
