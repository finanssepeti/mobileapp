/**
 * TEFAS YAT proxy — Python/pip gerekmez; Node 18+ (Expo ile zaten var).
 * Kökten: cd mobileapp && npm run tefas-service
 */

import http from "node:http";
import { URL } from "node:url";

const ROOT = "https://www.tefas.gov.tr";
const INFO_API = `${ROOT}/api/DB/BindHistoryInfo`;
const REFERER_PAGE = `${ROOT}/TarihselVeriler.aspx`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PORT = Number(process.env.PORT || 8765);

function bindHistoryBody(bastarih, bittarih, fonkod) {
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

/** @returns {{ rows?: unknown[], faultSnippet?: string, httpSnippet?: string } | null} */
function bindHistoryParse(text) {
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
  const bodyStr = bindHistoryBody(bastarih, bittarih, fonkod);

  /** @type {string[]} */
  const attempts = [];

  /** @returns {unknown[] | null} */
  const trySlice = async (cookie, ajaxWanted) => {
    const headers = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: REFERER_PAGE,
      Origin: ROOT,
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      ...(ajaxWanted ? { "X-Requested-With": "XMLHttpRequest" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    };
    const r = await fetch(INFO_API, { method: "POST", headers, body: bodyStr });
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      attempts.push(`HTTP ${r.status} ${text.slice(0, 180)}`);
      return null;
    }
    const parsed = bindHistoryParse(text);
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

  /** @returns {Promise<string>} */
  const cookieFromReferer = async () => {
    const rHome = await fetch(REFERER_PAGE, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
    });
    await rHome.text().catch(() => "");
    return cookieHeaderFromResponse(rHome);
  };

  let lastCookie = "";

  for (const ajaxWanted of [false, true]) {
    const a = await trySlice("", ajaxWanted);
    if (a) return a;

    lastCookie = await cookieFromReferer();
    const b = await trySlice(lastCookie, ajaxWanted);
    if (b) return b;
  }

  const tail = attempts.length ? attempts[attempts.length - 1] : "bilinmeyen";
  throw new Error(`TEFAS ERR (BindHistory): ${tail.slice(0, 240)}`);
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
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

  try {
    if (path === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (path === "/yat-funds") {
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
      const rows = await fetchYatRows(bastarih, bittarih, "");
      json(res, 200, parseYatFunds(rows, bastarih));
      return;
    }

    const m = path.match(/^\/yat-fund\/([^/]+)$/);
    if (m) {
      const code = decodeURIComponent(m[1] || "")
        .trim()
        .toUpperCase();
      if (!code) {
        json(res, 400, { detail: "Geçersiz fon kodu" });
        return;
      }
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
      const rows = await fetchYatRows(bastarih, bittarih, code);
      if (!rows.length) {
        json(res, 404, { detail: "Kayıt bulunamadı" });
        return;
      }
      const row = rows[rows.length - 1];
      const title = String(row.FONUNVAN ?? "").trim() || code;
      let price = null;
      const raw = row.FIYAT;
      if (raw != null) {
        const n = Number(raw);
        price = Number.isFinite(n) ? n : null;
      }
      json(res, 200, { asOf: bastarih, code, name: title, price });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    json(res, 502, { detail: `TEFAS erişim hatası: ${msg}` });
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[TEFAS] Port ${PORT} kullanımda. Eski sunucuyu kapatın veya başka port:  $env:PORT=8766; npm run tefas-service  (.env: EXPO_PUBLIC_TEFAS_BASE_URL=http://<IP>:8766)`,
    );
    process.exit(1);
    return;
  }
  console.error("[TEFAS] Sunucu hatası:", err);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`TEFAS proxy (Node) http://0.0.0.0:${PORT}  —  örn. EXPO_PUBLIC_TEFAS_BASE_URL=http://<PC-IP>:${PORT}`);
});
