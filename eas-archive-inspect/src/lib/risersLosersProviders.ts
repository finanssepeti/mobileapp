import {
  BIST100_SYMBOLS,
  COMMODITIES,
  CRYPTO100_BINANCE_BASES,
  NASDAQ100_SYMBOLS,
  type CommodityDef,
  type MarketCategory,
  type PeriodKey,
  type TrendMode,
} from "./marketUniverses";

/** Yahoo, mobil/app User-Agent ile çoğu zaman boş/hata döndürür; web istemcisi gibi davran. */
const YF_CHART_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
  Referer: "https://finance.yahoo.com/",
};

const BINANCE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

/** Borsa/Nasdaq/Kripto: ~100 sembol; daha yüksek = daha çabuk tamamlanır (Yahoo seyrek 429 yapabilir). */
const TREND_SYMBOL_CONCURRENCY = 64;
/** BIST: range= grafiği ile tolerans arttı; biraz daha paralel (retry sayısı düşük tutuldu). */
const BORSA_YAHOO_CONCURRENCY = 14;

/** Yahoo `interval=1d&period1&period2` uzun aralıkta BIST’te sık başarısız; `range=` daha stabil olabiliyor. */
function yahooChartRangeToken(period: PeriodKey): string | null {
  if (period === "1M") return "1mo";
  if (period === "3M") return "3mo";
  if (period === "6M") return "6mo";
  if (period === "1Y") return "1y";
  return null;
}

type PricePoint = { isoDate: string; price: number };
export type TrendRow = {
  key: string;
  name: string;
  startPrice: number;
  endPrice: number;
  changePct: number;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftPeriod(baseIso: string, period: PeriodKey): string {
  const d = parseYmd(baseIso);
  if (period === "1W") d.setDate(d.getDate() - 7);
  if (period === "1M") d.setMonth(d.getMonth() - 1);
  if (period === "3M") d.setMonth(d.getMonth() - 3);
  if (period === "6M") d.setMonth(d.getMonth() - 6);
  if (period === "1Y") d.setFullYear(d.getFullYear() - 1);
  return ymd(d);
}

function nearestOnOrBefore(points: PricePoint[], iso: string): PricePoint | null {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = points[mid]!.isoDate;
    if (v === iso) return points[mid]!;
    if (v < iso) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? points[hi]! : null;
}

function sortedUnique(points: PricePoint[]): PricePoint[] {
  const m = new Map<string, number>();
  for (const p of points) {
    if (Number.isFinite(p.price) && p.price > 0) m.set(p.isoDate, p.price);
  }
  return [...m.entries()].map(([isoDate, price]) => ({ isoDate, price })).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function pointsFromYahooChartJson(json: unknown): PricePoint[] {
  const obj = json as {
    chart?: {
      error?: { description?: string };
      result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }>;
    };
  };
  if (obj.chart?.error) return [];
  const r = obj.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const out: PricePoint[] = [];
  const n = Math.min(ts.length, close.length);
  for (let i = 0; i < n; i += 1) {
    const c = close[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const d = new Date(ts[i]! * 1000);
    out.push({ isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price: c });
  }
  return sortedUnique(out);
}

async function fetchYahooSeriesFromCsv(symbol: string, startIso: string, endIso: string): Promise<PricePoint[]> {
  const p1 = Math.floor(parseYmd(startIso).getTime() / 1000);
  const p2 = Math.floor((parseYmd(endIso).getTime() + 24 * 3600 * 1000) / 1000);
  const qs = `?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true&_=${Date.now()}`;
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"] as const;
  const settled = await Promise.allSettled(
    hosts.map(async (host) => {
      const url = `${host}/v7/finance/download/${encodeURIComponent(symbol)}${qs}`;
      const res = await fetch(url, {
        headers: { ...YF_CHART_HEADERS, Accept: "text/csv,*/*" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return [];
      const out: PricePoint[] = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i]!.split(",");
        const isoDate = cols[0]?.trim();
        const closeRaw = cols[4]?.trim();
        if (!isoDate || !closeRaw || closeRaw === "null") continue;
        const price = Number(closeRaw);
        if (!Number.isFinite(price) || price <= 0) continue;
        out.push({ isoDate, price });
      }
      return sortedUnique(out);
    }),
  );
  let best: PricePoint[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    if (r.value.length > best.length) best = r.value;
  }
  return best;
}

async function fetchYahooChartFromHost(symbol: string, p1: number, p2: number, origin: string): Promise<PricePoint[]> {
  const bust = `&_=${Date.now()}`;
  const url = `${origin}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}${bust}`;
  try {
    const res = await fetch(url, { headers: YF_CHART_HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return pointsFromYahooChartJson(json);
  } catch {
    return [];
  }
}

async function fetchYahooChartRangeFromHost(symbol: string, range: string, origin: string): Promise<PricePoint[]> {
  const bust = `&_=${Date.now()}`;
  const url = `${origin}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}${bust}`;
  try {
    const res = await fetch(url, { headers: YF_CHART_HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return pointsFromYahooChartJson(json);
  } catch {
    return [];
  }
}

/** Uzun pencerelerde (özellikle 1Y) `period1`/`period2` emtia/BIST’te sık boş; `range=` genelde dolu gelir. */
async function fetchYahooPeriodOrCsv(symbol: string, startIso: string, endIso: string): Promise<PricePoint[]> {
  const p1 = Math.floor(parseYmd(startIso).getTime() / 1000);
  const p2 = Math.floor((parseYmd(endIso).getTime() + 24 * 3600 * 1000) / 1000);
  const chartParsed = await firstSeriesReady([
    fetchYahooChartFromHost(symbol, p1, p2, "https://query1.finance.yahoo.com"),
    fetchYahooChartFromHost(symbol, p1, p2, "https://query2.finance.yahoo.com"),
  ]);
  if (chartParsed.length >= 2) return chartParsed;
  const csvPts = await fetchYahooSeriesFromCsv(symbol, startIso, endIso);
  if (csvPts.length >= 2) return csvPts;
  return csvPts.length ? csvPts : chartParsed;
}

/**
 * İsteğe bağlı `period`: 1M–1Y için önce Yahoo `range=1mo|…|1y` (BIST/emtia/Nasdaq için kritik).
 */
async function fetchYahooSeries(symbol: string, startIso: string, endIso: string, period?: PeriodKey): Promise<PricePoint[]> {
  const range = period ? yahooChartRangeToken(period) : null;
  if (range) {
    const rangePts = await firstSeriesReady([
      fetchYahooChartRangeFromHost(symbol, range, "https://query1.finance.yahoo.com"),
      fetchYahooChartRangeFromHost(symbol, range, "https://query2.finance.yahoo.com"),
    ]);
    if (rangePts.length >= 2) return rangePts;
  }
  return fetchYahooPeriodOrCsv(symbol, startIso, endIso);
}

/** BIST: kota/boş yanıtta kısa bir yeniden deneme. */
async function fetchYahooSeriesForBist(symbol: string, startIso: string, endIso: string, period: PeriodKey): Promise<PricePoint[]> {
  let pts = await fetchYahooSeries(symbol, startIso, endIso, period);
  if (pts.length >= 2) return pts;
  await new Promise((resolve) => setTimeout(resolve, 160));
  return fetchYahooSeries(symbol, startIso, endIso, period);
}

function parseBinanceKlines(rows: unknown): PricePoint[] {
  if (!Array.isArray(rows)) return [];
  const out: PricePoint[] = [];
  for (const r of rows as Array<[number, string, string, string, string]>) {
    const ts = r?.[0];
    const close = Number(r?.[4]);
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
    const d = new Date(ts);
    out.push({ isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price: close });
  }
  return sortedUnique(out);
}

/**
 * Bazı bölgelerde `api.binance.com` bloklu; iki host'u aynı anda dene (bekleme süresi yarıya iner).
 */
async function fetchBinanceSeries(symbol: string, startIso: string, endIso: string): Promise<PricePoint[]> {
  const startMs = parseYmd(startIso).getTime();
  const endMs = parseYmd(endIso).getTime() + 24 * 3600 * 1000 - 1;
  const qs = `symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  const urls = [`https://api.binance.com/api/v3/klines?${qs}`, `https://data-api.binance.vision/api/v3/klines?${qs}`];
  return firstSeriesReady(
    urls.map(async (url) => {
      const res = await fetch(url, { headers: BINANCE_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      return parseBinanceKlines(j);
    }),
  );
}

const YAHOO_CRYPTO_EXTRA_SYMBOLS: Record<string, readonly string[]> = {
  MATIC: ["POL-USD", "POL-USDT"],
};

/** Hangi promise önce ≥2 günlük mum döndürürse biter — ikisini beklemek gerekmez (hız için). */
function firstSeriesReady(promises: Array<Promise<PricePoint[]>>): Promise<PricePoint[]> {
  return new Promise((resolve) => {
    if (!promises.length) {
      resolve([]);
      return;
    }
    let solved = false;
    let pending = promises.length;
    const doneEmpty = () => {
      pending -= 1;
      if (!solved && pending <= 0) resolve([]);
    };
    for (const pr of promises) {
      void pr
        .then((pts) => {
          if (solved) return;
          if (pts.length >= 2) {
            solved = true;
            resolve(pts);
            return;
          }
          doneEmpty();
        })
        .catch(doneEmpty);
    }
  });
}

/** `-USD` + Binance ilk turda kullanılmıştır; kalan Yahoo adayları. */
async function fetchCryptoYahooRemainder(
  base: string,
  startIso: string,
  endIso: string,
  period?: PeriodKey,
): Promise<PricePoint[]> {
  const extra = YAHOO_CRYPTO_EXTRA_SYMBOLS[base] ?? [];
  const candidatesRaw = [`${base}-USDT`, ...extra];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidatesRaw) {
    const u = c.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }
  return firstSeriesReady(unique.map((sym) => fetchYahooSeries(sym, startIso, endIso, period)));
}

/**
 * Yahoo `BASE-USD` ile Binance `BASEUSDT` yarışır (ilk kullanılabilir seri — beklemeden süre kısalır).
 * Ikisi yetmezse kalan Yahoo eşleri paralel taranır.
 */
async function fetchCryptoHybridSeries(
  base: string,
  startIso: string,
  endIso: string,
  period?: PeriodKey,
): Promise<PricePoint[]> {
  const usdtPair = `${base}USDT`;
  const prim = await firstSeriesReady([
    fetchYahooSeries(`${base}-USD`, startIso, endIso, period),
    fetchBinanceSeries(usdtPair, startIso, endIso),
  ]);
  if (prim.length >= 2) return prim;
  const yRest = await fetchCryptoYahooRemainder(base, startIso, endIso, period);
  return yRest.length >= 2 ? yRest : prim;
}

/** Çok paralel Yahoo isteği kota engeline takılabilir; sınırlı havuz kullan. */
async function mapPool<T, R>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let ptr = 0;
  async function worker() {
    for (;;) {
      const i = ptr++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function toTrendRow(name: string, start: number, end: number): TrendRow | null {
  if (!(start > 0) || !(end > 0)) return null;
  const changePct = ((end - start) / start) * 100;
  return { key: name, name, startPrice: start, endPrice: end, changePct };
}

async function buildRowsForSymbols(
  names: string[],
  resolver: (name: string, startIso: string, endIso: string) => Promise<PricePoint[]>,
  startIso: string,
  endIso: string,
  concurrency = TREND_SYMBOL_CONCURRENCY,
  opts?: { anchorOldestWhenStartMissing?: boolean },
): Promise<TrendRow[]> {
  const rows = await mapPool(names, concurrency, async (name) => {
    const s = await resolver(name, startIso, endIso);
    let p0 = nearestOnOrBefore(s, startIso);
    if (!p0 && opts?.anchorOldestWhenStartMissing && s.length >= 2) {
      p0 = s[0]!;
    }
    const p1 = nearestOnOrBefore(s, endIso) ?? (s.length ? s[s.length - 1]! : null);
    if (!p0 || !p1) return null;
    return toTrendRow(name, p0.price, p1.price);
  });
  return rows.filter((r): r is TrendRow => !!r);
}

const COMMODITY_YAHOO_FALLBACKS: Record<string, string[]> = {
  gold: ["XAUUSD=X", "GC=F"],
  silver: ["XAGUSD=X", "SI=F"],
  oil: ["CL=F", "BZ=F"],
  palladium: ["PA=F"],
  platinum: ["PL=F"],
  copper: ["HG=F"],
};

/** Yahoo/Comex kıymetli madenler USD/troy ons; TL kolonunda gram fiyat = TL/ons ÷ bu sabit. */
const GRAMS_PER_TROY_OZ = 31.1034768;

function tlAsGramForPreciousMetal(id: CommodityDef["id"]): boolean {
  return id === "gold" || id === "silver" || id === "platinum" || id === "palladium";
}

/** Öncelik sırasına göre ilk yeterli seri; tüm adayları beklemez (daha hızlı). */
async function fetchYahooPrioritySeries(
  symbols: string[],
  startIso: string,
  endIso: string,
  period?: PeriodKey,
): Promise<PricePoint[]> {
  let bestShort: PricePoint[] = [];
  for (const sym of symbols) {
    const pts = await fetchYahooSeries(sym, startIso, endIso, period);
    if (pts.length >= 2) return pts;
    if (pts.length > bestShort.length) bestShort = pts;
  }
  return bestShort;
}

async function buildCommodityRows(startIso: string, endIso: string, period: PeriodKey): Promise<TrendRow[]> {
  const usdTryPromise = fetchYahooSeries("USDTRY=X", startIso, endIso, period);

  const perCommodity = await Promise.all(
    COMMODITIES.map(async (c) => {
      const yahooCandidates = COMMODITY_YAHOO_FALLBACKS[c.id] ?? [c.yahooSymbol];
      const series = await fetchYahooPrioritySeries(yahooCandidates, startIso, endIso, period);
      let s0 = nearestOnOrBefore(series, startIso);
      if (!s0 && series.length >= 2) {
        s0 = series[0]!;
      }
      const s1 = nearestOnOrBefore(series, endIso) ?? (series.length ? series[series.length - 1]! : null);
      return { c, s0, s1 };
    }),
  );

  const usdTry = await usdTryPromise;
  const rows: TrendRow[] = [];
  for (const { c, s0, s1 } of perCommodity) {
    if (!s0 || !s1) continue;
    const usdRow = toTrendRow(`${c.label} (USD/ons)`, s0.price, s1.price);
    if (usdRow) rows.push({ ...usdRow, key: `${c.id}_usd` });
    const fx0 = nearestOnOrBefore(usdTry, s0.isoDate);
    const fx1 = nearestOnOrBefore(usdTry, s1.isoDate);
    if (fx0 && fx1 && fx0.price > 0 && fx1.price > 0) {
      const tlPerOz0 = s0.price * fx0.price;
      const tlPerOz1 = s1.price * fx1.price;
      const gram = tlAsGramForPreciousMetal(c.id);
      const tlLabel = gram ? `${c.label} (gram TL)` : `${c.label} (TL)`;
      const startTl = gram ? tlPerOz0 / GRAMS_PER_TROY_OZ : tlPerOz0;
      const endTl = gram ? tlPerOz1 / GRAMS_PER_TROY_OZ : tlPerOz1;
      const tlRow = toTrendRow(tlLabel, startTl, endTl);
      if (tlRow) rows.push({ ...tlRow, key: `${c.id}_tl` });
    }
  }
  return rows;
}

function dedupeTrendRowsByKey(rows: TrendRow[]): TrendRow[] {
  const seen = new Set<string>();
  const out: TrendRow[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

function pickTop(rows: TrendRow[], mode: TrendMode, limit: number): TrendRow[] {
  const sorted = [...rows].sort((a, b) => (mode === "risers" ? b.changePct - a.changePct : a.changePct - b.changePct));
  return sorted.slice(0, limit);
}

export async function fetchRisersLosers(params: {
  mode: TrendMode;
  period: PeriodKey;
  category: MarketCategory;
  asOfIso?: string;
}): Promise<TrendRow[]> {
  const endIso = params.asOfIso ?? ymd(new Date());
  const startIso = shiftPeriod(endIso, params.period);

  if (params.category === "emtia") {
    const rows = await buildCommodityRows(startIso, endIso, params.period);
    return pickTop(rows, params.mode, 20);
  }

  if (params.category === "borsa") {
    const period = params.period;
    const rows = await buildRowsForSymbols(
      BIST100_SYMBOLS,
      (s, a, b) => fetchYahooSeriesForBist(s, a, b, period),
      startIso,
      endIso,
      BORSA_YAHOO_CONCURRENCY,
      { anchorOldestWhenStartMissing: true },
    );
    const labeled = dedupeTrendRowsByKey(
      rows.map((r) => {
        const short = r.name.replace(/\.IS$/i, "");
        return { ...r, name: short, key: r.key.replace(/\.IS$/i, "") };
      }),
    );
    return pickTop(labeled, params.mode, 8);
  }

  if (params.category === "nasdaq") {
    const p = params.period;
    const rows = await buildRowsForSymbols(NASDAQ100_SYMBOLS, (s, a, b) => fetchYahooSeries(s, a, b, p), startIso, endIso);
    return pickTop(rows, params.mode, 8);
  }

  const p = params.period;
  const rawCrypto = await buildRowsForSymbols(
    CRYPTO100_BINANCE_BASES,
    (base, a, b) => fetchCryptoHybridSeries(base, a, b, p),
    startIso,
    endIso,
  );
  const cryptoRows = rawCrypto.map((r) => ({
    ...r,
    name: `${r.key}/USDT`,
    key: r.key,
  }));
  return pickTop(cryptoRows, params.mode, 8);
}

