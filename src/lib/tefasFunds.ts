import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import {
  loadTefasYatFundsCache,
  saveTefasYatFundsCache,
  sanitizeTefasForStorage,
} from "./tefasFundsCache";
import { getMarketGatewayBase } from "./marketGateway";

/** Büyük JSON.parse öncesi kısa nefes — sekme dokunuşları işlensin. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export type TefasFund = {
  code: string;
  name: string;
  price: number | null;
  /** Önceki iş günü fiyatına göre günlük % (TEFAS + bir önceki gün satırı). */
  changePct?: number | null;
};

export type TefasYatFundsResponse = {
  asOf: string;
  count: number;
  funds: TefasFund[];
  /** Bir kez günlük % birleştirmesi yapıldı (çift tefas.gov.tr isteği önlenir). */
  dayChangeResolved?: boolean;
  /** Son başarılı cevaptan AsyncStorage ile servis edildi (TEFAS kapalıysa). */
  servedFromLocalCache?: boolean;
  /** Kullanıcıya gösterilecek kısa uyarı metni */
  cacheWarning?: string | null;
};

/** Metro’nun bağlandığı LAN IP (aynı makinedeki yerel proxy / Python servisi için). */
function devPackagerLanHost(): string | null {
  const expoCfg = Constants.expoConfig as { hostUri?: string } | undefined;
  const uri = (expoCfg?.hostUri ?? (Constants as { debuggerHost?: string }).debuggerHost ?? "").trim();
  if (!uri) return null;
  const host = uri.split(":")[0]?.trim() ?? "";
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  if (!/^[\d.]+$/.test(host)) return null;
  return host;
}

/** Önce Metro’nun LAN IP’si (Python genelde aynı makinede), sonra .env URL’si — eski IP yanlışsa yine de bağlanır. */
function tefasCandidateBases(): string[] {
  const portRaw = process.env.EXPO_PUBLIC_TEFAS_PORT?.trim() || "8765";
  const port = String(parseInt(portRaw, 10) || 8765);
  const raw = process.env.EXPO_PUBLIC_TEFAS_BASE_URL?.trim();
  const seen = new Set<string>();
  const out: string[] = [];

  /* Expo Go: .env ile gelen http://192.168.x.x de dahil LAN http denemesi genelde zaman aşımı / ENGELLİ. */
  const packagerHost = wantsBlockLanHttp() ? null : devPackagerLanHost();
  if (packagerHost) {
    const auto = `http://${packagerHost}:${port}`;
    seen.add(auto);
    out.push(auto);
  }

  if (raw) {
    let base = raw.replace(/\/+$/, "");
    const rewrite =
      String(process.env.EXPO_PUBLIC_TEFAS_USE_DEV_HOST || "")
        .trim()
        .toLowerCase() === "1" ||
      String(process.env.EXPO_PUBLIC_TEFAS_USE_DEV_HOST || "")
        .trim()
        .toLowerCase() === "true";
    if (rewrite && packagerHost) {
      try {
        const u = new URL(base.includes("://") ? base : `http://${base}`);
        u.hostname = packagerHost;
        u.port = port;
        base = u.origin.replace(/\/+$/, "");
      } catch {
        /* keep base */
      }
    }
    if (!seen.has(base)) {
      seen.add(base);
      out.push(base);
    }
  }

  return filterTefasCandidateBases(out);
}

function networkHint(base: string): string {
  if (!base.startsWith("http:")) return "";
  if (Platform.OS === "android") {
    return " Expo Go’da yerel http genelde engellenir: ngrok ile https adresi → EXPO_PUBLIC_TEFAS_BASE_URL; veya `npx expo run:android`; USB’de `adb reverse tcp:8765 tcp:8765` + http://127.0.0.1:8765.";
  }
  if (Platform.OS === "ios") {
    return " Expo Go’da yerel http sık kısıtlıdır; ngrok https veya geliştirme derlemesi önerilir.";
  }
  return "";
}

const TEFAS_SITE = "https://www.tefas.gov.tr";
/** Yalnızca bu yol + POST desteklenir; GET veya /api/db/… ApiProxy ERR-002 üretebilir. */
const TEFAS_INFO_API = `${TEFAS_SITE}/api/DB/BindHistoryInfo`;
const TEFAS_REFERER_PAGE = `${TEFAS_SITE}/TarihselVeriler.aspx`;
const TEFAS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TEFAS_UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.193 Mobile Safari/537.36";

function forceAllowLanHttp(): boolean {
  const v = String(process.env.EXPO_PUBLIC_TEFAS_FORCE_HTTP_LOCAL ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Expo Go / kullanıcı isteği: LAN üzerinden http:// tabanları genelde çalışmaz veya anlamsız zaman aşımı üretir. */
function wantsBlockLanHttp(): boolean {
  if (forceAllowLanHttp()) return false;
  const envSkip = String(process.env.EXPO_PUBLIC_TEFAS_SKIP_LOCAL ?? "")
    .trim()
    .toLowerCase();
  if (envSkip === "1" || envSkip === "true" || envSkip === "yes") return true;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return true;
  const own = (Constants as { appOwnership?: string }).appOwnership;
  return own === "expo";
}

function isProbablyBlockedCleartextLan(base: string): boolean {
  try {
    const normalized = base.includes("://") ? base : `http://${base}`;
    const u = new URL(normalized);
    if (u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1") return false;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
    const [a, b] = h.split(".").map((x) => Number(x));
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  } catch {
    return false;
  }
}

function filterTefasCandidateBases(bases: string[]): string[] {
  if (!wantsBlockLanHttp()) return bases;
  return bases.filter((b) => !isProbablyBlockedCleartextLan(b));
}

function tefasHttpErrorSnippet(status: number, text: string): string {
  const t = text.trim();
  try {
    const j = JSON.parse(t) as { fault?: { faultCode?: string; faultString?: string } };
    const f = j.fault;
    if (f && (f.faultCode || f.faultString)) {
      const fs = (f.faultString ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      return `${f.faultCode ?? "fault"}${fs ? `: ${fs}` : ""}`;
    }
  } catch {
    /* yok */
  }
  return `${status}: ${t.slice(0, 100)}`;
}

function nearestWeekdayTr(d = new Date()): string {
  const x = new Date(d);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
  const dd = String(x.getDate()).padStart(2, "0");
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const yyyy = x.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** `dd.mm.yyyy` → bir önceki iş günü (Cumartesi/Pazar atlanır). */
export function previousWeekdayTrFrom(asOfDdMmYyyy: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(asOfDdMmYyyy.trim());
  if (!m) return nearestWeekdayTr();
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Büyük liste JSON’undan üst kesim — çok fazla yükleme yapılmaz.
 * Kart başına öncelikli kodlar kesim sonrası ayrıca eklenir (düşük fiyatlı NAV’lı fonlar görünür kalır).
 */
export const TEFAS_NETWORK_MAX_FUNDS = 280;

/** Kartlarda her zaman görünmeye çalışılan YAT fon kodları (TEFAS cevabında varsa eklenir). */
export const TEFAS_PRIORITY_CODES: readonly string[] = [
  "GED",
  "VEU",
  "VGD",
  "VES",
  "HHY",
  "HHB",
  "VEL",
  "VEH",
  "ZHB",
  "VEI",
  "VGA",
];

function attachPriorityFundsOutsideCap(funds: TefasFund[], allFunds: Iterable<TefasFund>): TefasFund[] {
  const pool = [...allFunds];
  const poolBy = new Map(pool.map((f) => [f.code.toUpperCase(), f] as const));
  const have = new Set(funds.map((f) => f.code.toUpperCase()));
  const extra: TefasFund[] = [];
  for (const code of TEFAS_PRIORITY_CODES) {
    const u = code.toUpperCase();
    if (have.has(u)) continue;
    const hit = poolBy.get(u);
    if (!hit) continue;
    extra.push(hit);
    have.add(u);
  }
  return [...funds, ...extra];
}

function takeTopFundsByPrice(funds: TefasFund[], limit: number): TefasFund[] {
  if (limit <= 0) return [];
  if (funds.length <= limit) return funds;
  const priceOf = (f: TefasFund) =>
    f.price != null && Number.isFinite(f.price) && f.price > 0 ? f.price! : Number.NEGATIVE_INFINITY;
  const heap: TefasFund[] = [];
  for (const f of funds) {
    if (heap.length < limit) {
      heap.push(f);
      continue;
    }
    let minI = 0;
    let minP = priceOf(heap[0]!);
    for (let i = 1; i < heap.length; i++) {
      const p = priceOf(heap[i]!);
      if (p < minP) {
        minP = p;
        minI = i;
      }
    }
    if (priceOf(f) > minP) heap[minI] = f;
  }
  return heap.sort((a, b) => priceOf(b) - priceOf(a) || a.code.localeCompare(b.code, "tr", { sensitivity: "base" }));
}

/** Önceki iş günü FIYAT ile günlük % — `dayChangeResolved` ile yalnızca bir kez çalışır. */
export async function enrichTefasYatFundsWithPrevDay(data: TefasYatFundsResponse): Promise<TefasYatFundsResponse> {
  if (data.servedFromLocalCache) {
    return {
      ...data,
      dayChangeResolved: true,
      funds: data.funds.map((f) => ({ ...f, changePct: f.changePct ?? null })),
    };
  }
  if (!data.funds.length || data.dayChangeResolved) return data;
  const prevAsOf = previousWeekdayTrFrom(data.asOf);
  const prev = await fetchTefasYatFundsOfficialForBastarih(prevAsOf, 6_000);
  await yieldToEventLoop();
  if (!prev.data?.funds.length) {
    return {
      ...data,
      dayChangeResolved: true,
      funds: data.funds.map((f) => ({ ...f, changePct: f.changePct ?? null })),
    };
  }
  const prevMap = new Map(prev.data.funds.map((f) => [f.code.toUpperCase(), f.price] as const));
  return {
    ...data,
    dayChangeResolved: true,
    funds: data.funds.map((f) => {
      const p0 = prevMap.get(f.code.toUpperCase());
      if (typeof f.price !== "number" || !Number.isFinite(f.price) || p0 == null || !Number.isFinite(p0) || p0 <= 0) {
        return { ...f, changePct: f.changePct ?? null };
      }
      return { ...f, changePct: ((f.price - p0) / p0) * 100 };
    }),
  };
}

function cookieFromSetCookieHeader(h: string | null): string {
  if (!h) return "";
  return h
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function parseYatFundsRows(rows: unknown[], bastarih: string): TefasYatFundsResponse {
  const byCode = new Map<string, TefasFund>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const code = String(o.FONKODU ?? "")
      .trim()
      .toUpperCase();
    if (!code) continue;
    const name = String(o.FONUNVAN ?? "").trim() || code;
    let price: number | null = null;
    const raw = o.FIYAT;
    if (raw != null) {
      const n = Number(raw);
      price = Number.isFinite(n) ? n : null;
    }
    const prev = byCode.get(code);
    if (!prev) {
      byCode.set(code, { code, name, price });
    } else {
      if (price != null) prev.price = price;
      if (name.length >= (prev.name?.length ?? 0)) prev.name = name;
    }
  }
  const all = [...byCode.values()];
  let funds =
    all.length > TEFAS_NETWORK_MAX_FUNDS ? takeTopFundsByPrice(all, TEFAS_NETWORK_MAX_FUNDS) : all;
  funds = attachPriorityFundsOutsideCap(funds, all);
  return { asOf: bastarih, count: funds.length, funds };
}

function tryParseYatFundsJson(text: string, bastarih: string): TefasYatFundsResponse | null {
  try {
    const json = JSON.parse(text) as { data?: unknown };
    const data = (json as { data?: unknown[] }).data;
    if (!Array.isArray(data)) return null;
    return parseYatFundsRows(data, bastarih);
  } catch {
    return null;
  }
}

/** TEFAS BindHistoryInfo — borsajs ile aynı alan seti; yalnızca POST + /api/DB/… */
function buildBindHistoryBody(bastarih: string, bittarih: string, fonkod: string): string {
  return new URLSearchParams({
    fontip: "YAT",
    sfontur: "",
    fonkod,
    fongrup: "",
    bastarih,
    bittarih,
    fonturkod: "",
    fonunvantip: "",
    kurucukod: "",
  }).toString();
}

/** tefas.gov.tr — yalnızca POST /api/DB/BindHistoryInfo (GET ve lowercase yol kaldırıldı: ERR-002 ApiProxy). */
async function fetchTefasYatFundsOfficialForBastarih(
  bastarihFixed: string,
  timeoutMs: number,
): Promise<{
  data: TefasYatFundsResponse | null;
  error: string | null;
}> {
  const bastarih = bastarihFixed.trim() || nearestWeekdayTr();
  const bittarih = bastarih;
  const body = buildBindHistoryBody(bastarih, bittarih, "");

  const postHeaders = (ua: string, cookie: string, ajaxWanted: boolean): Record<string, string> => ({
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Referer: TEFAS_REFERER_PAGE,
    Origin: TEFAS_SITE,
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    ...(ajaxWanted ? { "X-Requested-With": "XMLHttpRequest" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  });

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let lastErr = "TEFAS.gov.tr: JSON veya data[] okunamadı";

  try {
    for (const ua of [TEFAS_UA, TEFAS_UA_MOBILE]) {
      for (const ajaxWanted of [false, true]) {
        let rPost = await fetch(TEFAS_INFO_API, {
          method: "POST",
          signal: ctl.signal,
          headers: postHeaders(ua, "", ajaxWanted),
          body,
        });
        let text = await rPost.text();
        await yieldToEventLoop();
        if (rPost.ok) {
          const fast = tryParseYatFundsJson(text, bastarih);
          if (fast?.funds.length) {
            clearTimeout(t);
            return { data: fast, error: null };
          }
        } else {
          lastErr = `TEFAS.gov.tr ${tefasHttpErrorSnippet(rPost.status, text)}`;
        }

        const rHome = await fetch(TEFAS_REFERER_PAGE, {
          signal: ctl.signal,
          headers: {
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9",
          },
        });
        const cookie = cookieFromSetCookieHeader(rHome.headers.get("set-cookie"));

        rPost = await fetch(TEFAS_INFO_API, {
          method: "POST",
          signal: ctl.signal,
          headers: postHeaders(ua, cookie, ajaxWanted),
          body,
        });
        text = await rPost.text();
        await yieldToEventLoop();
        if (rPost.ok) {
          const parsed = tryParseYatFundsJson(text, bastarih);
          if (parsed?.funds.length) {
            clearTimeout(t);
            return { data: parsed, error: null };
          }
        } else {
          lastErr = `TEFAS.gov.tr ${tefasHttpErrorSnippet(rPost.status, text)}`;
        }
      }
    }

    clearTimeout(t);
    return { data: null, error: lastErr };
  } catch (e) {
    clearTimeout(t);
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "AbortError" || msg.includes("aborted")) {
      return { data: null, error: `TEFAS.gov.tr zaman aşımı (${Math.round(timeoutMs / 1000)} sn)` };
    }
    return { data: null, error: `TEFAS.gov.tr: ${msg}` };
  }
}

async function fetchTefasYatFundsOfficial(timeoutMs: number): Promise<{
  data: TefasYatFundsResponse | null;
  error: string | null;
}> {
  const bastarih = nearestWeekdayTr();
  const first = await fetchTefasYatFundsOfficialForBastarih(bastarih, timeoutMs);
  if (first.data?.funds.length) {
    return first;
  }
  const fallbackDate = previousWeekdayTrFrom(bastarih);
  if (fallbackDate !== bastarih) {
    const second = await fetchTefasYatFundsOfficialForBastarih(fallbackDate, Math.min(timeoutMs, 9500));
    if (second.data?.funds.length) {
      return second;
    }
    return {
      data: null,
      error: second.error ?? first.error ?? "TEFAS.gov.tr veri döndürmedi.",
    };
  }
  return first;
}

function stripTrailingNetworkHint(msg: string): string {
  const i = msg.indexOf(" Expo Go");
  return i >= 0 ? msg.slice(0, i).trim() : msg;
}

async function fetchTefasYatFundsFromGateway(
  base: string,
  timeoutMs: number,
): Promise<{ data: TefasYatFundsResponse | null; error: string | null }> {
  const root = base.replace(/\/+$/, "");
  const url = `${root}/v1/tefas/yat-funds`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      cache: "no-store",
      signal: ctl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(t);
    const text = await r.text();
    await yieldToEventLoop();
    if (!r.ok) {
      let detail = r.statusText || "Hata";
      try {
        const j = JSON.parse(text) as { detail?: string; error?: string; message?: string };
        detail = (j.detail || j.error || j.message || detail).toString().slice(0, 160);
      } catch {
        if (text) detail = text.slice(0, 160);
      }
      return { data: null, error: `TEFAS ağ geçidi (${r.status}): ${detail}` };
    }
    let j: TefasYatFundsResponse;
    try {
      j = JSON.parse(text) as TefasYatFundsResponse;
    } catch {
      return { data: null, error: "TEFAS ağ geçidi yanıtı JSON değil" };
    }
    if (!j || !Array.isArray(j.funds)) {
      return { data: null, error: "TEFAS ağ geçidi: beklenmeyen yanıt" };
    }
    return { data: await enrichTefasYatFundsWithPrevDay(j), error: null };
  } catch (e) {
    clearTimeout(t);
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "AbortError" || msg.includes("aborted")) {
      return { data: null, error: `TEFAS ağ geçidi zaman aşımı (${Math.round(timeoutMs / 1000)} sn)` };
    }
    return { data: null, error: `TEFAS ağ geçidi: ${msg}` };
  }
}

async function fetchTefasYatFundsOnce(
  base: string,
  timeoutMs: number,
): Promise<{ data: TefasYatFundsResponse | null; error: string | null }> {
  const root = base.replace(/\/+$/, "");
  const url = `${root}/yat-funds`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      cache: "no-store",
      signal: ctl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(t);
    const text = await r.text();
    await yieldToEventLoop();
    if (!r.ok) {
      let detail = r.statusText || "Hata";
      try {
        const j = JSON.parse(text) as { detail?: string; error?: string; message?: string };
        detail = (j.detail || j.error || j.message || detail).toString().slice(0, 160);
      } catch {
        if (text) detail = text.slice(0, 160);
      }
      return { data: null, error: `TEFAS servisi (${r.status}): ${detail}` };
    }
    let j: TefasYatFundsResponse;
    try {
      j = JSON.parse(text) as TefasYatFundsResponse;
    } catch {
      return { data: null, error: "TEFAS yanıtı JSON değil" };
    }
    if (!j || !Array.isArray(j.funds)) {
      return { data: null, error: "Beklenmeyen TEFAS yanıtı (funds yok)" };
    }
    return { data: await enrichTefasYatFundsWithPrevDay(j), error: null };
  } catch (e) {
    clearTimeout(t);
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "AbortError" || msg.includes("aborted")) {
      return { data: null, error: `TEFAS zaman aşımı (${Math.round(timeoutMs / 1000)} sn): ${url.slice(0, 52)}…` };
    }
    const core =
      msg === "Network request failed" || msg.includes("Network request failed")
        ? `Ağ bağlantısı başarısız (${url.slice(0, 56)}…). Aynı Wi‑Fi, firewall (TEFAS portu), doğru IP.`
        : `TEFAS listesi alınamadı: ${msg}`;
    return { data: null, error: core };
  }
}

function mergeTefasFailures(
  results: Array<{ data: TefasYatFundsResponse | null; error: string | null }>,
  bases: string[],
): { data: null; error: string } {
  const rawParts = results.map((s) => s.error).filter((e): e is string => !!e);
  const parts = [...new Set(rawParts.map(stripTrailingNetworkHint))];
  const core = parts.length <= 1 ? (parts[0] ?? "TEFAS yanıt alınamadı.") : parts.join(" · ");
  const anyHttp = bases.some((b) => b.startsWith("http:"));
  const hint = anyHttp ? networkHint(bases[0]!) : "";
  const tried =
    bases.length > 0
      ? ` (Yerel ${bases.join(" | ")} ve tefas.gov.tr birlikte denendi.)`
      : " (Doğrudan tefas.gov.tr.)";
  const gatewayTail =
    bases.length === 0 && /\b404\b|ERR-00[26]\b|ApiProxy\b|method not found|disabled\b/i.test(core)
      ? " PC’de: npm run tefas-service sonra HTTPS/ngrok veya EXPO_PUBLIC_MARKET_GATEWAY_URL (market-gateway); Expo Go’da doğrudan tefas.gov.tr sık engellenir."
      : "";
  const err006Hint = /\bERR-006\b|method not found or disabled/i.test(core)
    ? " TEFAS `BindHistoryInfo` bazen ERR-006 ile tamamen kapatılır (embed/kazıma değil, resmi POST); Node/Python proxy aynı hatayı alır."
    : "";
  return { data: null, error: `${core}${tried}${hint}${gatewayTail}${err006Hint}` };
}

/**
 * Yerel proxy ile resmi site aynı anda; ilk başarılı cevapla biter — sıra bekleyip 15+ sn sürmez.
 * Resmi sitede önce hızlı POST, gerekirse cookie ile ikinci POST.
 */
async function fetchTefasYatFundsLive(): Promise<{
  data: TefasYatFundsResponse | null;
  error: string | null;
}> {
  const gw = getMarketGatewayBase();
  if (gw) {
    const gRes = await fetchTefasYatFundsFromGateway(gw, 14_000);
    if (gRes.data) return { data: gRes.data, error: null };
    const strict =
      String(process.env.EXPO_PUBLIC_MARKET_GATEWAY_STRICT_TEFAS || "").trim() === "1" ||
      String(process.env.EXPO_PUBLIC_MARKET_GATEWAY_STRICT_TEFAS || "").trim().toLowerCase() === "true";
    if (strict) {
      return { data: null, error: gRes.error ?? "TEFAS ağ geçidi kullanılamıyor." };
    }
  }

  const bases = tefasCandidateBases();
  const localTimeoutMs = 3500;
  const officialTimeoutMs = bases.length === 0 ? 22_000 : 16_000;

  const localTasks = bases.map((b) => fetchTefasYatFundsOnce(b, localTimeoutMs));
  const officialTask = fetchTefasYatFundsOfficial(officialTimeoutMs);

  if (localTasks.length === 0) {
    const off = await officialTask;
    return off.data ? { data: off.data, error: null } : { data: null, error: off.error ?? "TEFAS alınamadı." };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let pending = localTasks.length + 1;

    const tryOne = (r: { data: TefasYatFundsResponse | null; error: string | null }) => {
      if (settled) return;
      if (r.data) {
        settled = true;
        resolve({ data: r.data, error: null });
        return;
      }
      pending -= 1;
      if (pending === 0) {
        void Promise.all([...localTasks, officialTask]).then((all) => {
          if (settled) return;
          resolve(mergeTefasFailures(all, bases));
        });
      }
    };

    for (const p of localTasks) void p.then(tryOne);
    void officialTask.then(tryOne);
  });
}

async function finalizeTefasFetchResult(core: {
  data: TefasYatFundsResponse | null;
  error: string | null;
}): Promise<{ data: TefasYatFundsResponse | null; error: string | null }> {
  if (core.data) {
    const enriched = await enrichTefasYatFundsWithPrevDay(core.data);
    await saveTefasYatFundsCache(sanitizeTefasForStorage(enriched));
    return { data: enriched, error: null };
  }
  const cached = await loadTefasYatFundsCache();
  if (cached && cached.funds.length > 0) {
    const stale: TefasYatFundsResponse = {
      ...cached,
      servedFromLocalCache: true,
      cacheWarning:
        "TEFAS şu an yanıt vermiyor. Son başarıyla kaydedilmiş fon listesi gösteriliyor; fiyatlar güncel olmayabilir.",
    };
    return { data: await enrichTefasYatFundsWithPrevDay(stale), error: null };
  }
  return core;
}

export async function fetchTefasYatFunds(): Promise<{
  data: TefasYatFundsResponse | null;
  error: string | null;
}> {
  return finalizeTefasFetchResult(await fetchTefasYatFundsLive());
}
