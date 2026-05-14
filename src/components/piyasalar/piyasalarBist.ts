/** Piyasalar → Borsa İstanbul sekmesi */
import { fetchYahooQuote } from "../../lib/yahooFinance";
import type { PiyasalarCardItem } from "./piyasalarShared";
import { formatTry, loadParallelChunks } from "./piyasalarShared";

export const BIST100_CODES = [
  "AEFES","AGHOL","AGROT","AHGAZ","AKBNK","AKSA","AKSEN","ALARK","ALFAS","ALTNY",
  "ANHYT","ANSGR","ARCLK","ARDYZ","ASELS","ASTOR","AVPGY","BERA","BIMAS","BRSAN",
  "BRYAT","BSOKE","BTCIM","CANTE","CCOLA","CLEBI","CIMSA","CWENE","DOAS","DOHOL",
  "ECILC","EFORC","EGEEN","EKGYO","ENERY","ENJSA","ENKAI","EREGL","EUPWR","FROTO",
  "GARAN","GESAN","GOLTS","GRTHO","GSRAY","GUBRF","HALKB","HEKTS","IEYHO","ISMEN",
  "ISCTR","KARSN","KCAER","KCHOL","KONTR","KONYA","KOZAA","KOZAL","KRDMD","KTLEV",
  "LMKDC","MAGEN","MAVI","MGROS","MIATK","MPARK","OBAMS","ODAS","OTKAR","OYAKC",
  "PASEU","PETKM","PGSUS","RALYH","REEDR","RYGYO","SAHOL","SASA","SELEC","SISE","SKBNK",
  "SMRTG","SOKM","TABGD","TAVHL","TCELL","THYAO","TKFEN","TOASO","TSKB","TTKOM",
  "TTRAK","TUPRS","TURSG","ULKER","VAKBN","VESTL","YEOTK","YKBNK","ZOREN",
].sort((a, b) => a.localeCompare(b, "tr"));

const BIST_YAHOO_SYMBOLS: Record<string, string[]> = {
  KOZAA: ["KOZAA.IS", "KOZAA"],
  KOZAL: ["KOZAL.IS", "KOZAL"],
};

const TV_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
};

async function fetchTradingViewQuote(market: string, symbol: string): Promise<{ price: number; changePct?: number } | null> {
  try {
    const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: "POST",
      headers: TV_HEADERS,
      body: JSON.stringify({
        symbols: { tickers: [symbol] },
        columns: ["close", "change"],
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: Array<{ d?: unknown[] }> };
    const row = j.data?.[0]?.d;
    if (!Array.isArray(row)) return null;
    const price = Number(row[0]);
    const changePct = row[1] == null ? undefined : Number(row[1]);
    if (!Number.isFinite(price)) return null;
    return { price, changePct: Number.isFinite(changePct ?? NaN) ? changePct : undefined };
  } catch {
    return null;
  }
}

async function fetchBistCardItem(code: string): Promise<PiyasalarCardItem> {
  const symbols = BIST_YAHOO_SYMBOLS[code] ?? [`${code}.IS`];
  const quotes = await Promise.all(symbols.map((s) => fetchYahooQuote(s)));
  let quote = quotes.find((q) => q?.price && Number.isFinite(q.price)) ?? null;
  if ((!quote?.price || !Number.isFinite(quote.price)) && (code === "KOZAA" || code === "KOZAL")) {
    const tv = await fetchTradingViewQuote("turkey", `BIST:${code}`);
    if (tv?.price && Number.isFinite(tv.price)) {
      quote = { price: tv.price, changePct: tv.changePct ?? 0 };
    }
  }
  return {
    title: code,
    value: quote?.price && Number.isFinite(quote.price) ? formatTry(quote.price) : "—",
    pct: quote?.changePct ?? 0,
  };
}

export async function loadBistAllCards(): Promise<PiyasalarCardItem[]> {
  return loadParallelChunks(BIST100_CODES, 10, 5, (code) => fetchBistCardItem(code));
}
