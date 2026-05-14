export type PricePoint = { isoDate: string; price: number };

export type AssetKey =
  | "gold_try"
  | "silver_try"
  | "usd_try"
  | "eur_try"
  | "bist100"
  | "ppf"
  | "vadeli"
  | "enflasyon"
  | "btc_try";

export type AssetDef = {
  key: AssetKey;
  label: string;
};

export const KIYASLA_ASSETS: AssetDef[] = [
  { key: "gold_try", label: "Altın" },
  { key: "silver_try", label: "Gümüş" },
  { key: "usd_try", label: "Dolar" },
  { key: "eur_try", label: "EURO" },
  { key: "bist100", label: "BIST 100" },
  { key: "ppf", label: "Para Piyasası Fonu" },
  { key: "vadeli", label: "Vadeli" },
  { key: "enflasyon", label: "Enflasyon" },
  { key: "btc_try", label: "Bitcoin (TL)" },
];

const ALPHA_KEY = (process.env.EXPO_PUBLIC_ALPHA_VANTAGE_API_KEY || "").trim();
const METALPRICE_KEY = (process.env.EXPO_PUBLIC_METALPRICE_API_KEY || "").trim();
const DOVIZ_API_KEY = (process.env.EXPO_PUBLIC_DOVIZ_API_KEY || "").trim();
const DOVIZ_API_BASE = (process.env.EXPO_PUBLIC_DOVIZ_API_BASE || "https://www.doviz.com/api/v1").trim();
const KIYASLA_WEB_API_URL = (process.env.EXPO_PUBLIC_KIYASLA_API_URL || "https://finanssepeti.net/api-kiyasla-data.php").trim();
const KIYASLA_PPF_ANNUAL = Number(process.env.EXPO_PUBLIC_KIYASLA_PPF_ANNUAL_RATE || 0.43);
const KIYASLA_VADELI_ANNUAL = Number(process.env.EXPO_PUBLIC_KIYASLA_VADELI_ANNUAL_RATE || 0.47);
const KIYASLA_ENFLASYON_ANNUAL = Number(process.env.EXPO_PUBLIC_KIYASLA_ENFLASYON_ANNUAL_RATE || 0.39);

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

function addDays(iso: string, n: number): string {
  const d = parseYmd(iso);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function buildMonthlySchedule(firstIso: string, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  const out: string[] = [];
  let cur = parseYmd(firstIso);
  for (let i = 0; i < n; i += 1) {
    out.push(ymd(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
  }
  return out;
}

function clampPositive(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nearestByDate(points: PricePoint[], iso: string): PricePoint | null {
  if (!points.length) return null;
  // points assumed sorted asc by isoDate
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = points[mid]!.isoDate;
    if (v === iso) return points[mid]!;
    if (v < iso) lo = mid + 1;
    else hi = mid - 1;
  }
  // fallback: nearest previous; else first
  const idx = Math.max(0, Math.min(points.length - 1, hi));
  return points[idx] ?? null;
}

function sortedUnique(points: PricePoint[]): PricePoint[] {
  const map = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    map.set(p.isoDate, p.price);
  }
  return [...map.entries()]
    .map(([isoDate, price]) => ({ isoDate, price }))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function genMonthlySyntheticSeries(fromIso: string, toIso: string, annualRate: number): PricePoint[] {
  const out: PricePoint[] = [];
  const from = parseYmd(fromIso);
  const to = parseYmd(toIso);
  const monthly = Math.pow(1 + Math.max(0, annualRate), 1 / 12) - 1;
  let cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let value = 1;
  while (cur <= to) {
    out.push({ isoDate: ymd(cur), price: value });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    value *= 1 + monthly;
  }
  if (!out.length) out.push({ isoDate: fromIso, price: 1 });
  return out;
}

async function fetchAlphaFxDaily(fromSymbol: string, toSymbol: string, fromIso: string, toIso: string): Promise<PricePoint[]> {
  if (!ALPHA_KEY) return [];
  const url =
    "https://www.alphavantage.co/query" +
    `?function=FX_DAILY&from_symbol=${encodeURIComponent(fromSymbol)}&to_symbol=${encodeURIComponent(toSymbol)}&outputsize=full&apikey=${encodeURIComponent(ALPHA_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { [k: string]: unknown };
  const ts = (json["Time Series FX (Daily)"] || {}) as Record<string, { [k: string]: string }>;
  const out: PricePoint[] = [];
  for (const [isoDate, row] of Object.entries(ts)) {
    if (isoDate < fromIso || isoDate > toIso) continue;
    const n = Number(row["4. close"]);
    if (Number.isFinite(n) && n > 0) out.push({ isoDate, price: n });
  }
  return sortedUnique(out);
}

async function fetchYahooChartSeries(symbol: string, fromIso: string, toIso: string): Promise<PricePoint[]> {
  const period1 = Math.floor(parseYmd(fromIso).getTime() / 1000);
  const period2 = Math.floor(parseYmd(addDays(toIso, 1)).getTime() / 1000);
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    `${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const out: PricePoint[] = [];
  const len = Math.min(ts.length, close.length);
  for (let i = 0; i < len; i += 1) {
    const c = close[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const d = new Date(ts[i]! * 1000);
    out.push({ isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price: c });
  }
  return sortedUnique(out);
}

/**
 * Yahoo CSV download fallback (python/yfinance benzeri historical format).
 */
async function fetchYahooCsvSeries(symbol: string, fromIso: string, toIso: string): Promise<PricePoint[]> {
  const period1 = Math.floor(parseYmd(fromIso).getTime() / 1000);
  const period2 = Math.floor(parseYmd(addDays(toIso, 1)).getTime() / 1000);
  const url =
    "https://query1.finance.yahoo.com/v7/finance/download/" +
    `${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  const res = await fetch(url);
  if (!res.ok) return [];
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
}

async function fetchDovizSeries(pathVariants: string[], fromIso: string, toIso: string): Promise<PricePoint[]> {
  const endpoints = pathVariants.flatMap((p) => [
    `${DOVIZ_API_BASE}/${p}/historical?start=${fromIso}&end=${toIso}`,
    `${DOVIZ_API_BASE}/${p}/archive?start=${fromIso}&end=${toIso}`,
    `${DOVIZ_API_BASE}/${p}`,
    `${DOVIZ_API_BASE}/${p}/latest`,
  ]);
  for (const endpoint of endpoints) {
    try {
      const url = DOVIZ_API_KEY ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(DOVIZ_API_KEY)}` : endpoint;
      const res = await fetch(url, {
        headers: DOVIZ_API_KEY
          ? {
              "x-api-key": DOVIZ_API_KEY,
              authorization: `Bearer ${DOVIZ_API_KEY}`,
            }
          : undefined,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as
        | { error?: boolean; data?: unknown; items?: unknown[]; prices?: unknown[]; value?: unknown; selling?: unknown; buying?: unknown }
        | unknown[];
      if (Array.isArray(json)) {
        const raw = json as Array<Record<string, unknown>>;
        const points: PricePoint[] = raw
          .map((row) => {
            const isoDate = String(row.date || row.tarih || row.timestamp || "");
            const price = toNum(row.close ?? row.selling ?? row.buying ?? row.value ?? row.price);
            if (!isoDate || !price || !(price > 0)) return null;
            const d = new Date(isoDate);
            if (Number.isNaN(d.getTime())) return null;
            return { isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price };
          })
          .filter((x): x is PricePoint => !!x);
        const s = sortedUnique(points);
        if (s.length) return s;
        continue;
      }
      if ((json as { error?: boolean }).error) continue;
      const container = (json as { data?: unknown; items?: unknown[]; prices?: unknown[] }).data ?? (json as { items?: unknown[] }).items ?? (json as { prices?: unknown[] }).prices;
      if (Array.isArray(container)) {
        const points: PricePoint[] = (container as Array<Record<string, unknown>>)
          .map((row) => {
            const isoDate = String(row.date || row.tarih || row.timestamp || "");
            const price = toNum(row.close ?? row.selling ?? row.buying ?? row.value ?? row.price);
            if (!isoDate || !price || !(price > 0)) return null;
            const d = new Date(isoDate);
            if (Number.isNaN(d.getTime())) return null;
            return { isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price };
          })
          .filter((x): x is PricePoint => !!x);
        const s = sortedUnique(points);
        if (s.length) return s;
      } else {
        const v = toNum((json as { selling?: unknown; buying?: unknown; value?: unknown }).selling ?? (json as { buying?: unknown }).buying ?? (json as { value?: unknown }).value);
        if (v && v > 0) return [{ isoDate: toIso, price: v }];
      }
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * Coingecko BTC/USD günlük seri (yedek amaçlı).
 */
async function fetchBtcUsdFromCoingecko(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const from = Math.floor(parseYmd(fromIso).getTime() / 1000);
  const to = Math.floor(new Date(parseYmd(toIso).getTime() + 24 * 3600 * 1000).getTime() / 1000);
  const url =
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range" +
    `?vs_currency=usd&from=${from}&to=${to}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { prices?: [number, number][] };
  const prices = Array.isArray(json.prices) ? json.prices : [];
  const out: PricePoint[] = [];
  for (const [ts, price] of prices) {
    const d = new Date(ts);
    out.push({ isoDate: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate())), price });
  }
  return sortedUnique(out);
}

/**
 * İstenen kural: BTC değeri USD cinsinden alınır ve aynı gün USDTRY ile çarpılarak TL'ye çevrilir.
 */
export async function fetchBtcTrySeries(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const [btcUsdYahoo, usdTry] = await Promise.all([
    fetchYahooChartSeries("BTC-USD", fromIso, toIso),
    fetchUsdTrySeries(fromIso, toIso),
  ]);
  const srcBtcUsd = btcUsdYahoo.length ? btcUsdYahoo : await fetchBtcUsdFromCoingecko(fromIso, toIso);
  const out: PricePoint[] = [];
  for (const p of srcBtcUsd) {
    const fx = nearestByDate(usdTry, p.isoDate);
    if (!fx || !(fx.price > 0)) continue;
    out.push({ isoDate: p.isoDate, price: p.price * fx.price });
  }
  return sortedUnique(out);
}

async function fetchTruncgilToday(): Promise<{ usdTry?: number; eurTry?: number; goldTry?: number; silverTry?: number }> {
  const url = "https://finans.truncgil.com/today.json";
  const res = await fetch(url);
  if (!res.ok) return {};
  const json = (await res.json()) as Record<string, Record<string, string>>;
  const pick = (keys: string[]): Record<string, string> | undefined => {
    for (const k of keys) {
      const exact = json[k];
      if (exact) return exact;
      const found = Object.entries(json).find(([kk]) => kk.toLowerCase() === k.toLowerCase())?.[1];
      if (found) return found;
    }
    return undefined;
  };
  const parse = (v?: string) => {
    if (!v) return undefined;
    const n = Number(String(v).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  };
  const usd = pick(["USD"]);
  const eur = pick(["EUR"]);
  const gram = pick(["gram-altin", "gram_altin", "GRAM ALTIN"]);
  const silver = pick(["gumus", "gümüş", "GUMUS"]);
  return {
    usdTry: parse(usd?.Alis ?? usd?.Satis),
    eurTry: parse(eur?.Alis ?? eur?.Satis),
    goldTry: parse(gram?.Alis ?? gram?.Satis),
    silverTry: parse(silver?.Alis ?? silver?.Satis),
  };
}

async function fetchUsdTrySeries(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const doviz = await fetchDovizSeries(["currencies/USD", "usd"], fromIso, toIso);
  if (doviz.length) return doviz;
  const yahoo = await fetchYahooChartSeries("USDTRY=X", fromIso, toIso);
  if (yahoo.length) return yahoo;
  const yahooCsv = await fetchYahooCsvSeries("USDTRY=X", fromIso, toIso);
  if (yahooCsv.length) return yahooCsv;
  const alpha = await fetchAlphaFxDaily("USD", "TRY", fromIso, toIso);
  if (alpha.length) return alpha;
  const trunc = await fetchTruncgilToday();
  return trunc.usdTry ? [{ isoDate: toIso, price: trunc.usdTry }] : [];
}

async function fetchEurTrySeries(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const doviz = await fetchDovizSeries(["currencies/EUR", "eur"], fromIso, toIso);
  if (doviz.length) return doviz;
  const yahoo = await fetchYahooChartSeries("EURTRY=X", fromIso, toIso);
  if (yahoo.length) return yahoo;
  const yahooCsv = await fetchYahooCsvSeries("EURTRY=X", fromIso, toIso);
  if (yahooCsv.length) return yahooCsv;
  const alpha = await fetchAlphaFxDaily("EUR", "TRY", fromIso, toIso);
  if (alpha.length) return alpha;
  const trunc = await fetchTruncgilToday();
  return trunc.eurTry ? [{ isoDate: toIso, price: trunc.eurTry }] : [];
}

async function fetchBist100Series(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const s1 = await fetchYahooChartSeries("XU100.IS", fromIso, toIso);
  if (s1.length) return s1;
  return await fetchYahooChartSeries("^XU100", fromIso, toIso);
}

async function fetchGoldTrySeries(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const doviz = await fetchDovizSeries(["golds/gram-altin", "golds/gram-altin-tl", "gram-altin"], fromIso, toIso);
  if (doviz.length) return doviz;
  // 1) metalpriceapi (key varsa)
  if (METALPRICE_KEY) {
    const url = `https://api.metalpriceapi.com/v1/timeframe?api_key=${encodeURIComponent(METALPRICE_KEY)}&start_date=${fromIso}&end_date=${toIso}&base=USD&currencies=XAU,TRY`;
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as {
        rates?: Record<string, { XAU?: number; TRY?: number }>;
      };
      const out: PricePoint[] = [];
      for (const [isoDate, r] of Object.entries(json.rates || {})) {
        if (!r.XAU || !r.TRY) continue;
        // USD bazında verilen oranlardan 1 XAU'nun TRY fiyatı
        const xauTry = r.TRY / r.XAU;
        if (Number.isFinite(xauTry) && xauTry > 0) out.push({ isoDate, price: xauTry });
      }
      const s = sortedUnique(out);
      if (s.length) return s;
    }
  }
  // 2) Yahoo ons altın * USDTRY
  const [xauUsdA, xauUsdB, xauUsdCsv, usdTry] = await Promise.all([
    fetchYahooChartSeries("XAUUSD=X", fromIso, toIso),
    fetchYahooChartSeries("GC=F", fromIso, toIso),
    fetchYahooCsvSeries("XAUUSD=X", fromIso, toIso),
    fetchUsdTrySeries(fromIso, toIso),
  ]);
  const xauUsd = xauUsdA.length ? xauUsdA : xauUsdB.length ? xauUsdB : xauUsdCsv;
  const out: PricePoint[] = [];
  for (const p of xauUsd) {
    const fx = nearestByDate(usdTry, p.isoDate);
    if (!fx) continue;
    out.push({ isoDate: p.isoDate, price: p.price * fx.price });
  }
  const s = sortedUnique(out);
  if (s.length) return s;
  const trunc = await fetchTruncgilToday();
  return trunc.goldTry ? [{ isoDate: toIso, price: trunc.goldTry }] : [];
}

async function fetchSilverTrySeries(fromIso: string, toIso: string): Promise<PricePoint[]> {
  const doviz = await fetchDovizSeries(["golds/gumus", "golds/gumus-tl", "gumus"], fromIso, toIso);
  if (doviz.length) return doviz;
  const [xagUsdA, xagUsdB, xagUsdCsv, usdTry] = await Promise.all([
    fetchYahooChartSeries("XAGUSD=X", fromIso, toIso),
    fetchYahooChartSeries("SI=F", fromIso, toIso),
    fetchYahooCsvSeries("XAGUSD=X", fromIso, toIso),
    fetchUsdTrySeries(fromIso, toIso),
  ]);
  const xagUsd = xagUsdA.length ? xagUsdA : xagUsdB.length ? xagUsdB : xagUsdCsv;
  const out: PricePoint[] = [];
  for (const p of xagUsd) {
    const fx = nearestByDate(usdTry, p.isoDate);
    if (!fx) continue;
    out.push({ isoDate: p.isoDate, price: p.price * fx.price });
  }
  const s = sortedUnique(out);
  if (s.length) return s;
  const trunc = await fetchTruncgilToday();
  return trunc.silverTry ? [{ isoDate: toIso, price: trunc.silverTry }] : [];
}

export async function fetchAssetSeries(asset: AssetKey, fromIso: string, toIso: string): Promise<PricePoint[]> {
  if (asset === "btc_try") return await fetchBtcTrySeries(fromIso, toIso);
  if (asset === "usd_try") return await fetchUsdTrySeries(fromIso, toIso);
  if (asset === "eur_try") return await fetchEurTrySeries(fromIso, toIso);
  if (asset === "bist100") return await fetchBist100Series(fromIso, toIso);
  if (asset === "gold_try") return await fetchGoldTrySeries(fromIso, toIso);
  if (asset === "silver_try") return await fetchSilverTrySeries(fromIso, toIso);
  if (asset === "ppf") return genMonthlySyntheticSeries(fromIso, toIso, KIYASLA_PPF_ANNUAL);
  if (asset === "vadeli") return genMonthlySyntheticSeries(fromIso, toIso, KIYASLA_VADELI_ANNUAL);
  if (asset === "enflasyon") return genMonthlySyntheticSeries(fromIso, toIso, KIYASLA_ENFLASYON_ANNUAL);
  return [];
}

export type KiyaslaComputeInput = {
  pesinatIso: string;
  kiyasIso: string;
  pesinatTutarTry: number;
  krediYok: boolean;
  aylikTaksitTry: number;
  ilkTaksitIso: string;
  taksitSayisi: number;
};

export type KiyaslaRow = {
  asset: AssetDef;
  pesinatGetirisi: number | null;
  krediGetirisi: number | null;
  toplamTutar: number | null;
  error?: string;
};

async function fetchRowsFromWebKiyaslaApi(input: KiyaslaComputeInput): Promise<KiyaslaRow[] | null> {
  const start = [input.pesinatIso, input.krediYok ? input.pesinatIso : input.ilkTaksitIso].sort()[0]!;
  const params = new URLSearchParams({
    start,
    end: input.kiyasIso,
    pesinat_tutar: String(clampPositive(input.pesinatTutarTry)),
    pesinat_tarih: input.pesinatIso,
    kredi_tutar: String(input.krediYok ? 0 : clampPositive(input.aylikTaksitTry)),
    kredi_tarih: input.ilkTaksitIso,
    taksit_sayisi: String(input.krediYok ? 0 : Math.max(0, Math.floor(input.taksitSayisi))),
    kiyas_tarih: input.kiyasIso,
  });
  const url = `${KIYASLA_WEB_API_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    rows?: Array<{ key?: string; pesinatGetirisi?: number | null; krediGetirisi?: number | null; toplam?: number | null }>;
    error?: string;
    errors?: Record<string, string>;
  };
  if (!Array.isArray(json.rows) || !json.rows.length) return null;

  const webKeyMap: Record<string, AssetKey> = {
    altin: "gold_try",
    gumus: "silver_try",
    dolar: "usd_try",
    euro: "eur_try",
    bist100: "bist100",
    para_piyasasi: "ppf",
    vadeli: "vadeli",
    enflasyon: "enflasyon",
    bitcoin_tl: "btc_try",
  };
  const byAsset = new Map<AssetKey, KiyaslaRow>();
  for (const wr of json.rows) {
    const mapped = wr.key ? webKeyMap[wr.key] : undefined;
    if (!mapped) continue;
    const asset = KIYASLA_ASSETS.find((a) => a.key === mapped);
    if (!asset) continue;
    byAsset.set(mapped, {
      asset,
      pesinatGetirisi: typeof wr.pesinatGetirisi === "number" ? round2(wr.pesinatGetirisi) : null,
      krediGetirisi: typeof wr.krediGetirisi === "number" ? round2(wr.krediGetirisi) : null,
      toplamTutar: typeof wr.toplam === "number" ? round2(wr.toplam) : null,
      error: wr.key && json.errors?.[wr.key] ? json.errors[wr.key] : undefined,
    });
  }
  const rows = KIYASLA_ASSETS.map(
    (a) => byAsset.get(a.key) ?? { asset: a, pesinatGetirisi: null, krediGetirisi: null, toplamTutar: null, error: "Veri yok" },
  );
  return rows;
}

function kiyaslaRowsServerUnreachable(): KiyaslaRow[] {
  const msg = "Kıyasla sunucuya ulaşılamadı. İnternet ve api adresini kontrol edin.";
  return KIYASLA_ASSETS.map((asset) => ({
    asset,
    pesinatGetirisi: null,
    krediGetirisi: null,
    toplamTutar: null,
    error: msg,
  }));
}

export async function computeKiyaslaRows(input: KiyaslaComputeInput): Promise<KiyaslaRow[]> {
  // Üretim: yalnızca sunucudaki api-kiyasla-data.php (formüller ve anahtarlar istemcide kopyalanmasın).
  const webRows = await fetchRowsFromWebKiyaslaApi(input).catch(() => null);
  if (webRows && webRows.length) return webRows;

  if (!__DEV__) {
    return kiyaslaRowsServerUnreachable();
  }

  // Geliştirme: API yoksa yerel geri yükleme (Expo Go / offline).
  const pesinat = clampPositive(input.pesinatTutarTry);
  const taksit = clampPositive(input.aylikTaksitTry);
  const n = Math.max(0, Math.floor(input.taksitSayisi));
  const schedule =
    input.krediYok
      ? []
      : buildMonthlySchedule(input.ilkTaksitIso, n).filter((iso) => iso <= input.kiyasIso);
  const fromIso = [input.pesinatIso, input.ilkTaksitIso]
    .filter((iso) => iso <= input.kiyasIso)
    .sort()[0] ?? input.kiyasIso;

  const rows: KiyaslaRow[] = [];
  for (const asset of KIYASLA_ASSETS) {
    try {
      const series = await fetchAssetSeries(asset.key, fromIso, input.kiyasIso);
      if (!series.length) {
        rows.push({ asset, pesinatGetirisi: null, krediGetirisi: null, toplamTutar: null, error: "Veri yok" });
        continue;
      }
      const pPesinat = nearestByDate(series, input.pesinatIso);
      const pNow = nearestByDate(series, input.kiyasIso) ?? series[series.length - 1]!;
      if (!pPesinat || !Number.isFinite(pPesinat.price) || pPesinat.price <= 0) {
        rows.push({ asset, pesinatGetirisi: null, krediGetirisi: null, toplamTutar: null, error: "Fiyat bulunamadı" });
        continue;
      }
      const priceNow = pNow.price;

      const unitsPesinat = pesinat > 0 ? pesinat / pPesinat.price : 0;
      const pesinatValue = unitsPesinat * priceNow;

      let unitsKredi = 0;
      for (const iso of schedule) {
        const p = nearestByDate(series, iso);
        if (!p || !(p.price > 0)) continue;
        unitsKredi += taksit / p.price;
      }
      const krediValue = unitsKredi * priceNow;

      const pes = totalValueSafe(pesinatValue);
      const kre = input.krediYok ? 0 : totalValueSafe(krediValue);
      const toplam = totalValueSafe(pes + (input.krediYok ? 0 : kre));

      rows.push({
        asset,
        pesinatGetirisi: round2(pes),
        krediGetirisi: input.krediYok ? null : round2(kre),
        toplamTutar: round2(toplam),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ asset, pesinatGetirisi: null, krediGetirisi: null, toplamTutar: null, error: msg });
    }
  }
  return rows;
}

function totalValueSafe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

