/** Piyasalar → NASDAQ sekmesi */
import { NASDAQ_100_SYMBOLS } from "../../data/nasdaq100Symbols";
import { fetchYahooQuote } from "../../lib/yahooFinance";
import type { PiyasalarCardItem } from "./piyasalarShared";
import { formatUsdPrecise, loadParallelChunks } from "./piyasalarShared";

async function fetchNasdaqCardItem(ticker: string): Promise<PiyasalarCardItem> {
  const quote = await fetchYahooQuote(ticker);
  return {
    title: ticker,
    value: quote?.price && Number.isFinite(quote.price) ? formatUsdPrecise(quote.price) : "—",
    pct: quote?.changePct ?? 0,
  };
}

export async function loadNasdaqAllCards(): Promise<PiyasalarCardItem[]> {
  return loadParallelChunks(NASDAQ_100_SYMBOLS, 10, 5, (t) => fetchNasdaqCardItem(t));
}
