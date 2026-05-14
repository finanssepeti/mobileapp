/**
 * Piyasalar modalı: emtia / döviz kartları için TradingView sembolü ve yatırım ön dolumu.
 */
import type { PiyasalarCardItem } from "./piyasalarShared";
import { numToBirimInput, parseDisplayNumber } from "./piyasalarShared";

/** Kart + grafik: embed ile aynı `FX_IDC` gram TL sembolleri. */
export const PIYASALAR_GRAM_TL_YAHOO = {
  gold: "FX_IDC:XAUTRYG",
  silver: "FX_IDC:XAGTRYG",
} as const;

const EMTIA_TV: Record<string, string> = {
  "Altın / TL": "FX_IDC:XAUTRYG",
  "Gümüş / TL": "FX_IDC:XAGTRYG",
  "Petrol / USD": "TVC:UKOIL",
  "Altın / Ons": "OANDA:XAUUSD",
  "Gümüş / Ons": "OANDA:XAGUSD",
  "Bakır / USD": "OANDA:XCUUSD",
  /** FX_IDC:XPTTRYG bazı TV embed ortamlarda açılamıyor; çalışır CFD grafiğine yönlendir. */
  "Platin / TL": "OANDA:XPTUSD",
  "Platin / Ons": "OANDA:XPTUSD",
  /** FX_IDC:XPDTRYG bazı TV embed ortamlarda açılamıyor; çalışır CFD grafiğine yönlendir. */
  "Paladyum / TL": "OANDA:XPDUSD",
  "Paladyum / Ons": "OANDA:XPDUSD",
};

/** Kart fiyatı TV `cfd` taramasından alınsın diye — `EMTIA_TV` ile aynı OANDA sembolleri. */
export function listOandaUsdEmtiaChartPairs(): ReadonlyArray<{ title: string; ticker: string }> {
  return (
    [
      "Altın / Ons",
      "Gümüş / Ons",
      "Bakır / USD",
      "Platin / Ons",
      "Paladyum / Ons",
    ] as const
  ).map((title) => ({ title, ticker: EMTIA_TV[title]! }));
}

const EMTIA_PREFILL: Record<string, { arama: string; urun: string; usd: boolean }> = {
  "Altın / TL": { arama: "Altın", urun: "Altın/TL", usd: false },
  "Gümüş / TL": { arama: "Gümüş", urun: "Gümüş/TL", usd: false },
  "Petrol / USD": { arama: "Petrol", urun: "Petrol/USD", usd: true },
  "Altın / Ons": { arama: "Altın", urun: "Altın/Ons", usd: true },
  "Gümüş / Ons": { arama: "Gümüş", urun: "Gümüş/Ons", usd: true },
  "Bakır / USD": { arama: "Bakır", urun: "Bakır/USD", usd: true },
  "Platin / TL": { arama: "XPTTRYG", urun: "Platin/TL", usd: false },
  "Platin / Ons": { arama: "Platin", urun: "Platin/Ons", usd: true },
  "Paladyum / TL": { arama: "XPDTRYG", urun: "Paladyum/TL", usd: false },
  "Paladyum / Ons": { arama: "Paladyum", urun: "Paladyum/Ons", usd: true },
};

const FX_TV: Record<string, string> = {
  "🇺🇸 USD / TL": "FX_IDC:USDTRY",
  "🇪🇺 EUR / TL": "FX_IDC:EURTRY",
  "🇬🇧 İngiliz Sterlini / TL": "FX_IDC:GBPTRY",
  "🇨🇳 Çin Yuanı / TL": "FX_IDC:CNYTRY",
  "🇯🇵 Japon Yeni / TL": "FX_IDC:JPYTRY",
  /** FX_IDC:KWDTRY/SARTRY embed'de sık "symbol doesn't exist" veriyor. */
  "🇰🇼 Kuveyt Dinarı / TL": "FX:KWDTRY",
  "🇸🇦 Suudi Riyali / TL": "FX:SARTRY",
  "🇨🇦 Kanada Doları / TL": "FX_IDC:CADTRY",
};

const FX_PREFILL: Record<string, { arama: string; urun: string }> = {
  "🇺🇸 USD / TL": { arama: "USDTRY=X", urun: "USD/TL" },
  "🇪🇺 EUR / TL": { arama: "EURTRY=X", urun: "EUR/TL" },
  "🇬🇧 İngiliz Sterlini / TL": { arama: "GBPTRY=X", urun: "GBP/TL" },
  "🇨🇳 Çin Yuanı / TL": { arama: "CNYTRY=X", urun: "CNY/TL" },
  "🇯🇵 Japon Yeni / TL": { arama: "JPYTRY=X", urun: "JPY/TL" },
  "🇰🇼 Kuveyt Dinarı / TL": { arama: "KWDTRY=X", urun: "KWD/TL" },
  "🇸🇦 Suudi Riyali / TL": { arama: "SARTRY=X", urun: "SAR/TL" },
  "🇨🇦 Kanada Doları / TL": { arama: "CADTRY=X", urun: "CAD/TL" },
};

/** Embed sorunları nedeniyle grafik düğmesi gösterilmeyen döviz kartları (+ kalır). */
const FX_HIDE_CHART_TITLE = new Set<string>(["🇰🇼 Kuveyt Dinarı / TL", "🇸🇦 Suudi Riyali / TL"]);

export function emtiaActions(
  title: string,
  value: string,
  chartSymbolOverride?: string,
): PiyasalarCardItem["actions"] | undefined {
  const meta = EMTIA_PREFILL[title];
  if (!meta) return undefined;
  const base = EMTIA_TV[title];
  /** Gram TL: `chartSymbolOverride` = `emtiaTvChart` ile TV widget’taki sembol (FX_IDC / ICE) kartla aynı. */
  const chart = chartSymbolOverride ?? base;
  if (!chart) return undefined;
  const n = parseDisplayNumber(value);
  const birim = n == null ? "" : numToBirimInput(n, meta.usd);
  return {
    chartSymbol: chart,
    prefill: {
      urun: meta.urun,
      urunArama: meta.arama,
      birimFiyat: birim,
      quoteCurrency: (meta.usd ? "USD" : "TRY") as "TRY" | "USD",
    },
  };
}

export function fxActions(title: string, value: string): PiyasalarCardItem["actions"] | undefined {
  const chart = FX_TV[title];
  const meta = FX_PREFILL[title];
  if (!chart || !meta) return undefined;
  const n = parseDisplayNumber(value);
  const birim = n == null ? "" : numToBirimInput(n, false);
  const hideChart = FX_HIDE_CHART_TITLE.has(title);
  return {
    chartSymbol: hideChart ? null : chart,
    prefill: {
      urun: meta.urun,
      urunArama: meta.arama,
      birimFiyat: birim,
      quoteCurrency: "TRY" as const,
    },
  };
}
