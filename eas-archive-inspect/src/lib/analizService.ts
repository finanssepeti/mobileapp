import { TV_SCAN_HEADERS } from "./tradingViewScan";

export type TvTimeframe = "1m" | "1h" | "2h" | "4h" | "1d" | "1W" | "1M";

export type TvSymbolSearchItem = {
  symbol: string;
  exchange: string;
  type: string;
  description: string;
  full: string;
  market: string;
};

const SYMBOL_SEARCH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.tradingview.com/",
};

function resolveMarket(full: string): string {
  const p = full.split(":")[0]?.toUpperCase() ?? "";
  if (p === "BIST") return "turkey";
  if (p.startsWith("FX_") || p === "FOREXCOM" || p === "OANDA") return "forex";
  if (p === "BINANCE" || p === "BITSTAMP" || p === "COINBASE") return "crypto";
  if (p === "NASDAQ" || p === "NYSE" || p === "AMEX") return "america";
  if (p === "TVC" || p === "NYMEX" || p === "COMEX") return "futures";
  return "cfd";
}

/** Türkçe klavyede küçük i → İ olmasın; kripto kodları Latin A–Z ile eşleşsin (ethusd → ETHUSD). */
export function normalizeTickerInput(raw: string): string {
  return raw
    .trim()
    .replace(/\u0131/g, "i")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toLocaleUpperCase("en-US");
}

function pickTvPrefix(row: { prefix?: string; exchange?: string }): string {
  const p = row.prefix?.trim();
  if (p) return p;
  const e = row.exchange?.trim();
  if (e && e !== "-") return e;
  return "";
}

function mapTvSymbolSearchJson(
  j: Array<{
    symbol?: string;
    exchange?: string;
    type?: string;
    description?: string;
    prefix?: string;
  }> | null,
): TvSymbolSearchItem[] {
  return (j ?? [])
    .map((x) => {
      let symbolPart = (x.symbol ?? "").trim();
      if (!symbolPart) return null;
      if (symbolPart.includes(":")) {
        const bits = symbolPart.split(":");
        const prefixFromSym = bits[0]?.trim();
        symbolPart = bits.slice(1).join(":").trim() || symbolPart;
        const prefix = pickTvPrefix(x) || prefixFromSym || "";
        if (!prefix) return null;
        const full = `${prefix}:${symbolPart}`;
        return {
          symbol: symbolPart,
          exchange: x.exchange?.trim() || prefix,
          type: x.type ?? "-",
          description: x.description ?? "",
          full,
          market: resolveMarket(full),
        };
      }
      const prefix = pickTvPrefix(x);
      if (!prefix) return null;
      const full = `${prefix}:${symbolPart}`;
      return {
        symbol: symbolPart,
        exchange: x.exchange?.trim() || prefix,
        type: x.type ?? "-",
        description: x.description ?? "",
        full,
        market: resolveMarket(full),
      };
    })
    .filter((x): x is TvSymbolSearchItem => x !== null);
}

async function fetchTradingViewSymbolSearchBatch(
  text: string,
  exchange: string,
  lang: string,
): Promise<TvSymbolSearchItem[]> {
  const q = text.trim();
  if (!q) return [];
  try {
    const ex = exchange.trim();
    const url = `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(q)}&hl=1&exchange=${encodeURIComponent(ex)}&lang=${encodeURIComponent(lang)}&type=&domain=production`;
    const r = await fetch(url, { headers: SYMBOL_SEARCH_HEADERS });
    if (!r.ok) return [];
    const j = (await r.json()) as Array<{
      symbol?: string;
      exchange?: string;
      type?: string;
      description?: string;
      prefix?: string;
    }>;
    return mapTvSymbolSearchJson(j).slice(0, 24);
  } catch {
    return [];
  }
}

/** Genel arama + NASDAQ borsası (ABD hisseleri) birleşik sonuç. */
export async function searchTradingViewSymbols(text: string): Promise<TvSymbolSearchItem[]> {
  const q = text.trim();
  if (!q) return [];
  const [general, nasdaq] = await Promise.all([
    fetchTradingViewSymbolSearchBatch(q, "", "tr"),
    fetchTradingViewSymbolSearchBatch(q, "NASDAQ", "en"),
  ]);
  const seen = new Set<string>();
  const out: TvSymbolSearchItem[] = [];
  for (const row of [...nasdaq, ...general]) {
    const k = row.full.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
    if (out.length >= 20) break;
  }
  return out;
}

/** TradingView araması boş dönerse Binance USDT/USD çiftini dene (mobilde TV bazen 403/boş). */
export async function tryResolveBinanceUsdtPair(queryRaw: string): Promise<TvSymbolSearchItem | null> {
  let base = normalizeTickerInput(queryRaw).replace(/[^A-Z0-9]/g, "");
  if (base.length < 2) return null;
  /** SOLUSD / ETHUSDT gibi tam yazımlarda kotayı iki kez ekleme */
  if (base.endsWith("USDT")) base = base.slice(0, -4);
  else if (base.endsWith("USD")) base = base.slice(0, -3);
  if (base.length < 2 || base.length > 14) return null;
  const candidates = [`${base}USDT`, `${base}USD`];
  for (const sym of candidates) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=1h&limit=1`);
      if (!r.ok) continue;
      const arr = (await r.json()) as unknown;
      if (!Array.isArray(arr) || !arr.length) continue;
      return {
        symbol: sym,
        exchange: "BINANCE",
        type: "crypto",
        description: sym,
        full: `BINANCE:${sym}`,
        market: "crypto",
      };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function tfSuffix(tf: TvTimeframe): string {
  if (tf === "1d") return "";
  return `|${tf === "1m" ? "1" : tf === "1h" ? "60" : tf === "2h" ? "120" : tf === "4h" ? "240" : tf}`;
}

export async function fetchTradingViewSignal(
  fullTicker: string,
  market: string,
  timeframe: TvTimeframe
): Promise<{ recommendation: number; close?: number }> {
  const suffix = tfSuffix(timeframe);
  const recCol = `Recommend.All${suffix}`;
  const closeCol = `close${suffix}`;
  const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: TV_SCAN_HEADERS,
    body: JSON.stringify({
      symbols: { tickers: [fullTicker] },
      columns: [recCol, closeCol],
    }),
  });
  if (!r.ok) throw new Error("Sinyal verisi alınamadı.");
  const j = (await r.json()) as { data?: Array<{ d?: unknown[] }> };
  const d = j?.data?.[0]?.d;
  if (!Array.isArray(d) || typeof d[0] !== "number") throw new Error("Sinyal verisi boş.");
  return { recommendation: d[0], close: typeof d[1] === "number" ? d[1] : undefined };
}

export function recommendationToText(v: number): { label: string; color: "buy" | "sell" | "neutral" } {
  if (v >= 0.5) return { label: "GÜÇLÜ AL", color: "buy" };
  if (v > 0.1) return { label: "AL", color: "buy" };
  if (v <= -0.5) return { label: "GÜÇLÜ SAT", color: "sell" };
  if (v < -0.1) return { label: "SAT", color: "sell" };
  return { label: "NÖTR", color: "neutral" };
}
