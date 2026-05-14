/**
 * TradingView scanner (finansepeti.net / TV widget ile aynı ekosistem).
 * Gram TL: yalnızca `FX_IDC:XAUTRYG` / `FX_IDC:XAGTRYG` scanner satırı (embed ile aynı).
 * Eksikse `yahooFinance.fetchMarketSnapshot` içinde Yahoo `FX_IDC` / diğer yedekler doldurur.
 */
import type { EmtiaSlice } from "./emtiaQuotes";

export const TV_SCAN_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
};

type TvScanResponse = {
  totalCount?: number;
  data?: Array<{ s?: string; d?: unknown }>;
};

function normalizeTvRow(d: unknown): number[] | null {
  if (!Array.isArray(d) || d.length === 0) return null;
  const nums: number[] = [];
  for (const x of d) {
    if (x == null || x === "") {
      nums.push(NaN);
      continue;
    }
    if (typeof x === "number" && Number.isFinite(x)) {
      nums.push(x);
      continue;
    }
    if (typeof x === "string") {
      const n = Number(x.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) nums.push(NaN);
      else nums.push(n);
      continue;
    }
    nums.push(NaN);
  }
  return nums.length ? nums : null;
}

function rowToEmtia(arr: number[]): EmtiaSlice | null {
  const close = arr[0];
  if (!Number.isFinite(close)) return null;
  let changePct = Number.isFinite(arr[1]) ? arr[1] : undefined;
  const changeAbs = Number.isFinite(arr[2]) ? arr[2] : undefined;
  /** Gram FX satırlarında `change` (%) çoğu zaman boş; `change_abs` + kapanıştan günlük % türet. */
  if (
    (changePct === undefined || !Number.isFinite(changePct)) &&
    changeAbs !== undefined &&
    Number.isFinite(changeAbs) &&
    Math.abs(changeAbs) > 0
  ) {
    const prev = close - changeAbs;
    if (prev > 0 && Number.isFinite(prev)) changePct = (changeAbs / prev) * 100;
  }
  return {
    price: close,
    change: changeAbs,
    changePct,
  };
}

async function tvScan(
  market: string,
  tickers: string[],
  columns: string[]
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  try {
    const r = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: "POST",
      headers: TV_SCAN_HEADERS,
      body: JSON.stringify({ symbols: { tickers }, columns }),
      cache: "no-store",
    });
    if (!r.ok) return map;
    const j = (await r.json()) as TvScanResponse;
    for (const row of j.data ?? []) {
      if (!row.s) continue;
      const arr = normalizeTvRow(row.d);
      if (arr) map.set(row.s, arr);
    }
  } catch {
    /* boş */
  }
  return map;
}

/** Piyasalar Döviz sekmesi — kart ve `widgetembed` ile aynı `FX_IDC:*` sembolleri. */
export const TV_DOVIZ_EXTRA_TICKERS = [
  "FX_IDC:GBPTRY",
  "FX_IDC:CNYTRY",
  "FX_IDC:JPYTRY",
  "FX_IDC:KWDTRY",
  "FX_IDC:SARTRY",
  "FX_IDC:CADTRY",
] as const;

const FOREX_TICKERS_SNAPSHOT = [
  "FX_IDC:USDTRY",
  "FX_IDC:EURTRY",
  "FX_IDC:XAUTRYG",
  "FX_IDC:XAGTRYG",
  /** `FX_IDC` satırı gelmezse TV sayfasındaki ICE gram TRY ile aynı kaynak (scanner). */
  "ICE:XAUTRYG",
  "ICE:XAGTRYG",
  ...TV_DOVIZ_EXTRA_TICKERS,
] as const;

/**
 * `widgetembed` ile aynı OANDA CFD sembolleri (ör. Gümüş/Ons kartı = `OANDA:XAGUSD` kapanışı).
 * Satır yoksa çağıran Yahoo / vadeli yedeğe düşer.
 */
export async function fetchTradingViewCfdOandaUsdMetalSlices(
  tickers: readonly string[],
): Promise<Map<string, EmtiaSlice>> {
  const out = new Map<string, EmtiaSlice>();
  if (!tickers.length) return out;
  const raw = await tvScan("cfd", [...tickers], ["close", "change", "change_abs"]);
  for (const t of tickers) {
    const arr = raw.get(t);
    const slice = arr ? rowToEmtia(arr) : null;
    if (slice && slice.price > 0) out.set(t, slice);
  }
  return out;
}

export async function fetchTradingViewDovizExtras(): Promise<Map<string, EmtiaSlice>> {
  const out = new Map<string, EmtiaSlice>();
  const raw = await tvScan("forex", [...TV_DOVIZ_EXTRA_TICKERS], ["close", "change", "change_abs"]);
  for (const t of TV_DOVIZ_EXTRA_TICKERS) {
    const arr = raw.get(t);
    const slice = arr ? rowToEmtia(arr) : null;
    if (slice) out.set(t, slice);
  }
  return out;
}

export async function fetchTradingViewMarketSnapshot(): Promise<{
  goldGramTry: EmtiaSlice | null;
  silverGramTry: EmtiaSlice | null;
  /** `widgetembed` ile aynı sembol (FX_IDC öncelikli, yoksa ICE). */
  goldGramTvSymbol: string | null;
  silverGramTvSymbol: string | null;
  oilUsd: EmtiaSlice | null;
  usdTry: EmtiaSlice | null;
  eurTry: EmtiaSlice | null;
  bist100: EmtiaSlice | null;
  /** Döviz sekmesi ek pariteler — ana forex taramasıyla aynı istekte gelir. */
  dovizTvExtras: Map<string, EmtiaSlice>;
}> {
  const [forex, turkey, futuresTryOil, futuresBrent] = await Promise.all([
    tvScan("forex", [...FOREX_TICKERS_SNAPSHOT], ["close", "change", "change_abs"]),
    tvScan("turkey", ["BIST:XU100"], ["close", "change", "change_abs"]),
    tvScan("futures", ["TVC:UKOIL"], ["close", "change", "change_abs"]),
    tvScan("futures", ["NYMEX:BZ1!"], ["close", "change", "change_abs"]),
  ]);

  const usdArr = forex.get("FX_IDC:USDTRY");
  const eurArr = forex.get("FX_IDC:EURTRY");
  const bistArr = turkey.get("BIST:XU100");

  const goldFxArr = forex.get("FX_IDC:XAUTRYG") ?? forex.get("ICE:XAUTRYG");
  const silverFxArr = forex.get("FX_IDC:XAGTRYG") ?? forex.get("ICE:XAGTRYG");
  const ukoilArr = futuresTryOil.get("TVC:UKOIL");
  const brentArr = futuresBrent.get("NYMEX:BZ1!");

  /** Gram altın / gümüş: önce `FX_IDC:*`, yoksa TV’deki ICE gram TRY satırı. */
  const goldGramTry = goldFxArr ? rowToEmtia(goldFxArr) : null;
  const silverGramTry = silverFxArr ? rowToEmtia(silverFxArr) : null;

  const goldGramTvSymbol =
    goldGramTry != null ? (forex.get("FX_IDC:XAUTRYG") != null ? "FX_IDC:XAUTRYG" : "ICE:XAUTRYG") : null;
  const silverGramTvSymbol =
    silverGramTry != null ? (forex.get("FX_IDC:XAGTRYG") != null ? "FX_IDC:XAGTRYG" : "ICE:XAGTRYG") : null;

  const dovizTvExtras = new Map<string, EmtiaSlice>();
  for (const t of TV_DOVIZ_EXTRA_TICKERS) {
    const arr = forex.get(t);
    const slice = arr ? rowToEmtia(arr) : null;
    if (slice) dovizTvExtras.set(t, slice);
  }

  return {
    goldGramTry,
    silverGramTry,
    goldGramTvSymbol,
    silverGramTvSymbol,
    oilUsd: (ukoilArr ? rowToEmtia(ukoilArr) : null) ?? (brentArr ? rowToEmtia(brentArr) : null),
    usdTry: usdArr ? rowToEmtia(usdArr) : null,
    eurTry: eurArr ? rowToEmtia(eurArr) : null,
    bist100: bistArr ? rowToEmtia(bistArr) : null,
    dovizTvExtras,
  };
}
