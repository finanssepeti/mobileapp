/**
 * Yahoo Finance chart API (yfinance ile aynı veri kaynağı; mobilde Python yerine HTTP).
 * Semboller: BIST100.IS, ICE:XAUTRYG, ICE:XAGTRYG, TVC:UKOIL, USDTRY=X, EURTRY=X
 */
import type { EmtiaSlice } from "./emtiaQuotes";
import { getMarketGatewayBase } from "./marketGateway";
import { fetchTradingViewMarketSnapshot } from "./tradingViewScan";

const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export const YAHOO_SYMBOLS = {
  goldGramIce: "ICE:XAUTRYG",
  silverGramIce: "ICE:XAGTRYG",
  oilTvc: "TVC:UKOIL",
  usdTry: "USDTRY=X",
  eurTry: "EURTRY=X",
  bist100: "BIST100.IS",
} as const;

export async function fetchYahooQuote(symbol: string): Promise<EmtiaSlice | null> {
  const gw = getMarketGatewayBase();
  if (gw) {
    try {
      const enc = encodeURIComponent(symbol);
      const r = await fetch(`${gw}/v1/yahoo/chart?symbol=${enc}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as {
          price?: unknown;
          change?: unknown;
          changePct?: unknown;
        };
        if (typeof j.price === "number" && Number.isFinite(j.price)) {
          return {
            price: j.price,
            change: typeof j.change === "number" ? j.change : undefined,
            changePct: typeof j.changePct === "number" ? j.changePct : undefined,
          };
        }
      }
    } catch {
      /* ağ geçidi yoksa veya hata: doğrudan Yahoo */
    }
  }
  try {
    const enc = encodeURIComponent(symbol);
    /** Ara CDN/tarayıcı önbelleği için; aksi halde gün boyu aynı JSON dönebiliyor. */
    const bust = `&_=${Date.now()}`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d${bust}`;
    const r = await fetch(url, { headers: YF_HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, number | undefined> }> };
    };
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
  } catch {
    return null;
  }
}

function isPositiveQuote(q: EmtiaSlice | null | undefined): q is EmtiaSlice {
  return q != null && Number.isFinite(q.price) && q.price > 0;
}

const GRAMS_PER_TROY_OZ = 31.1034768;

/** Comex ons (USD) × USD/TRY → TL/gram — ICE/FX gram kotasyonu gelmezse kart yedeği. */
export async function fetchGramTryFromComexFallback(): Promise<{
  goldTryPerGram: EmtiaSlice | null;
  silverTryPerGram: EmtiaSlice | null;
}> {
  const [usd, gc, si] = await Promise.all([
    fetchYahooQuote(YAHOO_SYMBOLS.usdTry),
    fetchYahooQuote("GC=F"),
    fetchYahooQuote("SI=F"),
  ]);
  if (!usd?.price || !gc?.price || !Number.isFinite(usd.price) || !Number.isFinite(gc.price)) {
    return { goldTryPerGram: null, silverTryPerGram: null };
  }
  const gTry = (gc.price * usd.price) / GRAMS_PER_TROY_OZ;
  const goldTryPerGram: EmtiaSlice = {
    price: gTry,
    changePct: gc.changePct,
    change: typeof gc.change === "number" && Number.isFinite(gc.change) ? (gc.change * usd.price) / GRAMS_PER_TROY_OZ : undefined,
  };
  let silverTryPerGram: EmtiaSlice | null = null;
  if (si?.price && Number.isFinite(si.price) && si.price > 0) {
    silverTryPerGram = {
      price: (si.price * usd.price) / GRAMS_PER_TROY_OZ,
      changePct: si.changePct,
      change:
        typeof si.change === "number" && Number.isFinite(si.change)
          ? (si.change * usd.price) / GRAMS_PER_TROY_OZ
          : undefined,
    };
  }
  return { goldTryPerGram, silverTryPerGram };
}

export type YahooLinePoint = { time: string; value: number };

/** Yahoo chart v8 günlük kapanış serisi (gram TL sembolleri için). */
export async function fetchYahooDailyLineSeries(symbol: string): Promise<YahooLinePoint[] | null> {
  const gw = getMarketGatewayBase();
  if (gw) {
    try {
      const enc = encodeURIComponent(symbol);
      const r = await fetch(`${gw}/v1/yahoo/chart?symbol=${enc}&interval=1d&range=2y`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { points?: YahooLinePoint[] };
        if (Array.isArray(j.points) && j.points.length > 2) return j.points;
      }
    } catch {
      /* gateway yok / seri yok */
    }
  }
  try {
    const enc = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=2y&_=${Date.now()}`;
    const r = await fetch(url, { headers: YF_HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };
    const result = j.chart?.result?.[0];
    const ts = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!ts?.length || !closes?.length) return null;
    const out: YahooLinePoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue;
      const d = new Date(ts[i]! * 1000);
      out.push({ time: d.toISOString().slice(0, 10), value: c });
    }
    return out.length > 2 ? out : null;
  } catch {
    return null;
  }
}

/** TV’de açılan gram sembolüne uygun Yahoo adaylarıyla günlük seri. */
export async function fetchYahooLineSeriesForGramChart(tvSymbol: string): Promise<YahooLinePoint[] | null> {
  const u = tvSymbol.toUpperCase();
  const candidates =
    u.includes("XAUTRYG") || u.includes("XAGTRYG")
      ? u.includes("XAUTRYG")
        ? ["ICE:XAUTRYG", "FX_IDC:XAUTRYG", "XAUTRYG=X", "XAUTRYG"]
        : ["ICE:XAGTRYG", "FX_IDC:XAGTRYG", "XAGTRYG=X", "XAGTRYG"]
      : [];
  for (const s of candidates) {
    const rows = await fetchYahooDailyLineSeries(s);
    if (rows && rows.length > 2) return rows;
  }
  if (u.includes("XPTUSD") || u.includes("XPDUSD")) {
    const metalCandidates = u.includes("XPTUSD") ? ["XPTUSD=X", "PL=F"] : ["XPDUSD=X", "PA=F"];
    let metal: YahooLinePoint[] | null = null;
    for (const s of metalCandidates) {
      const rows = await fetchYahooDailyLineSeries(s);
      if (rows && rows.length > 2) {
        metal = rows;
        break;
      }
    }
    const usdTry = await fetchYahooDailyLineSeries("USDTRY=X");
    if (!metal || !usdTry || usdTry.length < 2) return null;

    const out: YahooLinePoint[] = [];
    let j = 0;
    for (let i = 0; i < metal.length; i += 1) {
      const m = metal[i]!;
      while (j + 1 < usdTry.length && usdTry[j + 1]!.time <= m.time) j += 1;
      const fx = usdTry[j];
      if (!fx || fx.time > m.time) continue;
      const v = (m.value * fx.value) / GRAMS_PER_TROY_OZ;
      if (!Number.isFinite(v) || v <= 0) continue;
      out.push({ time: m.time, value: v });
    }
    return out.length > 2 ? out : null;
  }
  return null;
}

/**
 * TV scanner gram satırında kapanış gelirken `change` / günlük % çoğu zaman boş (NaN) kalıyor;
 * fiyat TV’den seçilip Yahoo’dan tamamlanan % ile kartta “%0” görünmesi engellenir.
 */
function mergeGramTryTvYahoo(tv: EmtiaSlice | null, yh: EmtiaSlice | null): EmtiaSlice | null {
  const tvPrice = tv != null && Number.isFinite(tv.price) && tv.price > 0 ? tv.price : 0;
  const yhPrice = yh != null && Number.isFinite(yh.price) && yh.price > 0 ? yh.price : 0;
  /** TV bazen 0/boş döner; Yahoo geçerli fiyat veriyorsa kartta Yahoo kapanışı kullanılır. */
  const price = tvPrice || yhPrice;
  if (!(price > 0)) return null;

  const preferTv = tvPrice > 0;
  const tvPctOk =
    preferTv && tv != null && typeof tv.changePct === "number" && Number.isFinite(tv.changePct);
  const yhPctOk = yh != null && typeof yh.changePct === "number" && Number.isFinite(yh.changePct);
  const changePct = tvPctOk ? tv!.changePct! : yhPctOk ? yh!.changePct! : undefined;

  const tvChOk = preferTv && tv != null && typeof tv.change === "number" && Number.isFinite(tv.change);
  const yhChOk = yh != null && typeof yh.change === "number" && Number.isFinite(yh.change);
  const change = tvChOk ? tv!.change : yhChOk ? yh!.change : undefined;

  return { price, changePct, change };
}

async function fetchFirstSymbol(symbols: string[]): Promise<EmtiaSlice | null> {
  const quotes = await Promise.all(symbols.map((s) => fetchYahooQuote(s)));
  return quotes.find(isPositiveQuote) ?? null;
}

/** Karttaki fiyatla aynı Yahoo sembolü — TV embed sembolü ayrıca `emtiaTvChart` ile sabitlenir. */
async function fetchFirstSymbolWithSource(
  symbols: string[],
): Promise<{ slice: EmtiaSlice; symbol: string } | null> {
  const quotes = await Promise.all(symbols.map((s) => fetchYahooQuote(s)));
  const i = quotes.findIndex(isPositiveQuote);
  if (i < 0) return null;
  const slice = quotes[i]!;
  return { slice, symbol: symbols[i]! };
}

/** Yahoo ham sembolü → TradingView widget sembolü (petrol). */
function yahooOilSymbolToTvChart(yahooSym: string): string {
  if (yahooSym === "BZ=F") return "NYMEX:BZ1!";
  if (yahooSym === "UKOIL" || yahooSym === YAHOO_SYMBOLS.oilTvc) return "TVC:UKOIL";
  return "TVC:UKOIL";
}

export type EmtiaTvChartHint = {
  /** Piyasalar kartı başlığı ile eşleşen TV sembolleri (Yahoo ile aynı kaynak). */
  altinTl?: string;
  gumusTl?: string;
  petrolUsd?: string;
};

export async function fetchMarketSnapshot(): Promise<{
  goldGramTry: EmtiaSlice | null;
  silverGramTry: EmtiaSlice | null;
  oilUsd: EmtiaSlice | null;
  usdTry: EmtiaSlice | null;
  eurTry: EmtiaSlice | null;
  bist100: EmtiaSlice | null;
  emtiaTvChart?: EmtiaTvChartHint;
  /** TV `FX_IDC:*` — Piyasalar Döviz ek satırları (snapshot ile aynı tarama). */
  dovizTvExtras: Map<string, EmtiaSlice>;
}> {
  const [tv, yGoldSrc, ySilverSrc, yOilSrc, yUsd, yEur, yBist] = await Promise.all([
    fetchTradingViewMarketSnapshot(),
    /** Yahoo’da `FX_IDC:*` çoğu zaman boş; gram TL için önce ICE (çalışan seri), sonra yedekler. */
    /** TV embed `FX_IDC:*`; Yahoo’da önce aynı sembol, sonra ICE / kısa kod. */
    fetchFirstSymbolWithSource([
      YAHOO_SYMBOLS.goldGramIce,
      "FX_IDC:XAUTRYG",
      "XAUTRYG",
      "XAUTRYG=X",
    ]),
    fetchFirstSymbolWithSource([
      YAHOO_SYMBOLS.silverGramIce,
      "FX_IDC:XAGTRYG",
      "XAGTRYG",
      "XAGTRYG=X",
    ]),
    fetchFirstSymbolWithSource([YAHOO_SYMBOLS.oilTvc, "UKOIL", "BZ=F"]),
    fetchYahooQuote(YAHOO_SYMBOLS.usdTry),
    fetchYahooQuote(YAHOO_SYMBOLS.eurTry),
    fetchFirstSymbol([YAHOO_SYMBOLS.bist100, "XU100.IS", "^XU100"]),
  ]);

  const yGold = yGoldSrc?.slice ?? null;
  const ySilver = ySilverSrc?.slice ?? null;
  const yOil = yOilSrc?.slice ?? null;

  const goldFromTv =
    tv.goldGramTry && tv.goldGramTry.price > 0 ? tv.goldGramTry : null;
  /**
   * Gram altın: TV forex `FX_IDC:XAUTRYG` (scanner); yoksa Yahoo (ICE / yedek).
   * Gümüş: `FX_IDC:XAGTRYG` + Yahoo yedek.
   */
  const silverFromTv =
    tv.silverGramTry && tv.silverGramTry.price > 0 ? tv.silverGramTry : null;
  let goldGramTry = mergeGramTryTvYahoo(goldFromTv, yGold);
  let silverGramTry = mergeGramTryTvYahoo(silverFromTv, ySilver);
  if (!goldGramTry || !silverGramTry) {
    const oz = await fetchGramTryFromComexFallback();
    if (!goldGramTry) goldGramTry = mergeGramTryTvYahoo(null, oz.goldTryPerGram);
    if (!silverGramTry) silverGramTry = mergeGramTryTvYahoo(null, oz.silverTryPerGram);
  }
  const oilUsd = tv.oilUsd ?? yOil;

  const emtiaTvChart: EmtiaTvChartHint = {};
  if (goldGramTry) {
    emtiaTvChart.altinTl = tv.goldGramTvSymbol ?? yGoldSrc?.symbol ?? "FX_IDC:XAUTRYG";
  }
  if (silverGramTry) {
    emtiaTvChart.gumusTl = tv.silverGramTvSymbol ?? ySilverSrc?.symbol ?? "FX_IDC:XAGTRYG";
  } else if (ySilverSrc?.symbol) {
    emtiaTvChart.gumusTl = ySilverSrc.symbol;
  }
  const oilTv = yOilSrc ? yahooOilSymbolToTvChart(yOilSrc.symbol) : oilUsd && !yOilSrc ? "TVC:UKOIL" : undefined;
  if (oilTv) emtiaTvChart.petrolUsd = oilTv;

  /** Gram TL / petrol / döviz / BIST: TV scanner öncelikli; Yahoo yedek. */
  return {
    goldGramTry,
    silverGramTry,
    oilUsd,
    usdTry: tv.usdTry ?? yUsd,
    eurTry: tv.eurTry ?? yEur,
    bist100: tv.bist100 ?? yBist,
    dovizTvExtras: tv.dovizTvExtras,
    ...(Object.keys(emtiaTvChart).length > 0 ? { emtiaTvChart } : {}),
  };
}
