/** Piyasalar → Döviz sekmesi (TV `FX_IDC:*` = grafik; Yahoo / er-api yedek). */
import type { EmtiaSlice } from "../../lib/emtiaQuotes";
import { fetchTradingViewDovizExtras } from "../../lib/tradingViewScan";
import { fetchYahooQuote } from "../../lib/yahooFinance";
import type { PiyasalarCardItem } from "./piyasalarShared";
import { formatTry } from "./piyasalarShared";

type FxRequest = {
  title: string;
  symbols: string[];
  base?: string;
  quote?: string;
};

/** `piyasalarModalCharts` FX_TV ile aynı — kart fiyatı = embed. */
const TITLE_TO_TV_FX: Record<string, string> = {
  "🇬🇧 İngiliz Sterlini / TL": "FX_IDC:GBPTRY",
  "🇨🇳 Çin Yuanı / TL": "FX_IDC:CNYTRY",
  "🇯🇵 Japon Yeni / TL": "FX_IDC:JPYTRY",
  "🇰🇼 Kuveyt Dinarı / TL": "FX_IDC:KWDTRY",
  "🇸🇦 Suudi Riyali / TL": "FX_IDC:SARTRY",
  "🇨🇦 Kanada Doları / TL": "FX_IDC:CADTRY",
};

const DOVIZ_FX_REQUESTS: FxRequest[] = [
  { title: "🇬🇧 İngiliz Sterlini / TL", symbols: ["GBPTRY=X"] },
  { title: "🇨🇳 Çin Yuanı / TL", symbols: ["CNYTRY=X", "TRYCNY=X"], base: "CNY", quote: "TRY" },
  { title: "🇯🇵 Japon Yeni / TL", symbols: ["JPYTRY=X", "TRYJPY=X"] },
  { title: "🇰🇼 Kuveyt Dinarı / TL", symbols: ["KWDTRY=X"], base: "KWD", quote: "TRY" },
  { title: "🇸🇦 Suudi Riyali / TL", symbols: ["SARTRY=X"], base: "SAR", quote: "TRY" },
  { title: "🇨🇦 Kanada Doları / TL", symbols: ["CADTRY=X"] },
];

async function fetchFxRateFallback(base: string, quote: string): Promise<number | null> {
  try {
    const urls = [
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`,
    ];
    for (const url of urls) {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = (await r.json()) as { rates?: Record<string, number> };
      const rate = j.rates?.[quote];
      if (typeof rate === "number" && Number.isFinite(rate)) return rate;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadDovizFxCards(
  prefetchedTvExtras?: ReadonlyMap<string, EmtiaSlice> | null,
): Promise<PiyasalarCardItem[]> {
  const tvMap =
    prefetchedTvExtras && prefetchedTvExtras.size > 0
      ? new Map(prefetchedTvExtras)
      : await fetchTradingViewDovizExtras();
  return Promise.all(
    DOVIZ_FX_REQUESTS.map(async (item) => {
      const tvSym = TITLE_TO_TV_FX[item.title];
      if (tvSym) {
        const tvSlice = tvMap.get(tvSym);
        if (tvSlice && Number.isFinite(tvSlice.price)) {
          return {
            title: item.title,
            value: formatTry(tvSlice.price),
            pct: tvSlice.changePct ?? 0,
          } satisfies PiyasalarCardItem;
        }
      }
      const yahooRows = await Promise.all(item.symbols.map((s) => fetchYahooQuote(s)));
      let quote: Awaited<ReturnType<typeof fetchYahooQuote>> = null;
      let usedSymbol = "";
      for (let i = 0; i < item.symbols.length; i++) {
        const q = yahooRows[i];
        if (q?.price && Number.isFinite(q.price)) {
          quote = q;
          usedSymbol = item.symbols[i]!;
          break;
        }
      }
      if (!quote?.price || !Number.isFinite(quote.price)) {
        if (item.base && item.quote) {
          const fallback = await fetchFxRateFallback(item.base, item.quote);
          if (fallback && Number.isFinite(fallback)) {
            return {
              title: item.title,
              value: formatTry(fallback),
              pct: 0,
            } satisfies PiyasalarCardItem;
          }
        }
        return { title: item.title, value: "—", pct: 0 } satisfies PiyasalarCardItem;
      }
      const price =
        usedSymbol.startsWith("TRY") && quote.price > 0 ? 1 / quote.price : quote.price;
      return {
        title: item.title,
        value: Number.isFinite(price) && price > 0 ? formatTry(price) : "—",
        pct: quote.changePct ?? 0,
      } satisfies PiyasalarCardItem;
    }),
  );
}
