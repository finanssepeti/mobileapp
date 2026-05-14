/** Piyasalar → Emtialar sekmesi: ek kartlar (ons, platin, paladyum vb.) */
import { fetchTradingViewCfdOandaUsdMetalSlices } from "../../lib/tradingViewScan";
import { fetchUsdTry } from "../../lib/livePrice";
import { fetchYahooQuote } from "../../lib/yahooFinance";
import { listOandaUsdEmtiaChartPairs } from "./piyasalarModalCharts";
import type { PiyasalarCardItem } from "./piyasalarShared";
import { formatTry, formatUsd } from "./piyasalarShared";

export type QuoteRequest = {
  title: string;
  symbols: string[];
  currency: "TRY" | "USD";
};

const GRAMS_PER_TROY_OZ = 31.1034768;

function tryPerGramFromTroyOzTry(tryPerOz: number): number {
  return tryPerOz / GRAMS_PER_TROY_OZ;
}

/** Grafikteki OANDA CFD ile aynı kapanış (Yahoo `GC=F` / `SI=F` vb. ile uyuşmaz). */
export async function fetchOandaUsdEmtiaCardsFromTv(): Promise<Map<string, PiyasalarCardItem>> {
  const pairs = listOandaUsdEmtiaChartPairs();
  const tickers = pairs.map((p) => p.ticker);
  const slices = await fetchTradingViewCfdOandaUsdMetalSlices(tickers);
  const out = new Map<string, PiyasalarCardItem>();
  for (const { title, ticker } of pairs) {
    const slice = slices.get(ticker);
    if (!slice || slice.price <= 0) continue;
    out.set(title, {
      title,
      value: formatUsd(slice.price),
      pct: slice.changePct ?? 0,
      tvChartSymbol: ticker,
    });
  }
  return out;
}

export async function fetchCardItem(item: QuoteRequest, usdTry: number): Promise<PiyasalarCardItem | null> {
  const quotes = await Promise.all(item.symbols.map((s) => fetchYahooQuote(s)));
  const quote = quotes.find((q) => q != null && Number.isFinite(q.price) && q.price > 0) ?? null;
  if (!quote?.price || !Number.isFinite(quote.price)) return null;

  const needsTryConversion = item.currency === "TRY" && !item.symbols.some((symbol) => symbol.includes("TRY"));
  const price = needsTryConversion ? quote.price * usdTry : quote.price;
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    title: item.title,
    value: item.currency === "USD" ? formatUsd(price) : formatTry(price),
    pct: quote.changePct ?? 0,
  };
}

export async function fetchPlatinTlGramFromYahoo(usdTry: number): Promise<PiyasalarCardItem | null> {
  const chartSymbol = "OANDA:XPTUSD";
  const tryOzSymbols = ["XPTTRYG", "ICE:XPTTRYG"];
  for (const sym of tryOzSymbols) {
    const q = await fetchYahooQuote(sym);
    if (q?.price && Number.isFinite(q.price) && q.price > 0) {
      const gram = tryPerGramFromTroyOzTry(q.price);
      if (!Number.isFinite(gram) || gram <= 0) continue;
      return { title: "Platin / TL", value: formatTry(gram), pct: q.changePct ?? 0, tvChartSymbol: chartSymbol };
    }
  }
  const usdOzSymbols = ["PL=F", "XPTUSD=X"];
  for (const sym of usdOzSymbols) {
    const q = await fetchYahooQuote(sym);
    if (q?.price && Number.isFinite(q.price) && q.price > 0 && usdTry > 0) {
      const tryOz = q.price * usdTry;
      const gram = tryPerGramFromTroyOzTry(tryOz);
      if (!Number.isFinite(gram) || gram <= 0) continue;
      return { title: "Platin / TL", value: formatTry(gram), pct: q.changePct ?? 0, tvChartSymbol: chartSymbol };
    }
  }
  return null;
}

export async function fetchPaladyumTlGramFromYahoo(usdTry: number): Promise<PiyasalarCardItem | null> {
  const chartSymbol = "OANDA:XPDUSD";
  const tryOzSymbols = ["XPDTRYG", "ICE:XPDTRYG"];
  for (const sym of tryOzSymbols) {
    const q = await fetchYahooQuote(sym);
    if (q?.price && Number.isFinite(q.price) && q.price > 0) {
      const gram = tryPerGramFromTroyOzTry(q.price);
      if (!Number.isFinite(gram) || gram <= 0) continue;
      return { title: "Paladyum / TL", value: formatTry(gram), pct: q.changePct ?? 0, tvChartSymbol: chartSymbol };
    }
  }
  const usdOzSymbols = ["PA=F", "XPDUSD=X"];
  for (const sym of usdOzSymbols) {
    const q = await fetchYahooQuote(sym);
    if (q?.price && Number.isFinite(q.price) && q.price > 0 && usdTry > 0) {
      const tryOz = q.price * usdTry;
      const gram = tryPerGramFromTroyOzTry(tryOz);
      if (!Number.isFinite(gram) || gram <= 0) continue;
      return { title: "Paladyum / TL", value: formatTry(gram), pct: q.changePct ?? 0, tvChartSymbol: chartSymbol };
    }
  }
  return null;
}

/** TV taraması ile Yahoo isteklerini aynı anda çalıştırır (Piyasalar açılışında gecikmeyi kısaltır). */
export async function loadExtraEmtiaCardsParallel(): Promise<PiyasalarCardItem[]> {
  const usdTry = (await fetchUsdTry()) ?? 0;
  const requests: QuoteRequest[] = [
    { title: "Altın / Ons", symbols: ["XAUUSD=X", "GC=F"], currency: "USD" },
    { title: "Gümüş / Ons", symbols: ["XAGUSD=X", "SI=F"], currency: "USD" },
    { title: "Bakır / USD", symbols: ["HG=F"], currency: "USD" },
    { title: "Platin / Ons", symbols: ["XPTUSD=X", "PL=F"], currency: "USD" },
    { title: "Paladyum / Ons", symbols: ["XPDUSD=X", "PA=F"], currency: "USD" },
  ];
  const [tvOandaOns, yahooList, platinTlGram, paladyumTlGram] = await Promise.all([
    fetchOandaUsdEmtiaCardsFromTv(),
    Promise.all(requests.map((item) => fetchCardItem(item, usdTry))),
    fetchPlatinTlGramFromYahoo(usdTry),
    fetchPaladyumTlGramFromYahoo(usdTry),
  ]);
  const extrasByTitle = new Map<string, PiyasalarCardItem>();
  for (const y of yahooList) {
    if (y) extrasByTitle.set(y.title, y);
  }
  if (platinTlGram) extrasByTitle.set("Platin / TL", platinTlGram);
  if (paladyumTlGram) extrasByTitle.set("Paladyum / TL", paladyumTlGram);
  for (const [, tvCard] of tvOandaOns) {
    if (tvCard?.value && tvCard.value !== "—") extrasByTitle.set(tvCard.title, tvCard);
  }
  return Array.from(extrasByTitle.values());
}

const EXTRA_EMTIA_CACHE_TTL_MS = 15 * 60 * 1000;
let extraEmtiaCache: { at: number; cards: PiyasalarCardItem[] } | null = null;
let extraEmtiaInflight: Promise<PiyasalarCardItem[]> | null = null;

/** Ana sayfa açılışında çağrılır; Piyasalar açılmadan önce emtia ek kartları hazırlanır. */
export function prefetchExtraEmtiaCards(): void {
  void getExtraEmtiaCardsDeduped(false);
}

/**
 * @param force true: önbelleği yok sayıp ağdan yenile (modal periyodik güncelleme).
 */
export async function getExtraEmtiaCardsDeduped(force = false): Promise<PiyasalarCardItem[]> {
  if (!force && extraEmtiaCache && Date.now() - extraEmtiaCache.at < EXTRA_EMTIA_CACHE_TTL_MS) {
    return extraEmtiaCache.cards;
  }
  if (force) {
    extraEmtiaCache = null;
    extraEmtiaInflight = null;
  }
  if (extraEmtiaInflight) return extraEmtiaInflight;
  extraEmtiaInflight = loadExtraEmtiaCardsParallel()
    .then((cards) => {
      extraEmtiaCache = { at: Date.now(), cards };
      extraEmtiaInflight = null;
      return cards;
    })
    .catch((e) => {
      extraEmtiaInflight = null;
      throw e;
    });
  return extraEmtiaInflight;
}
