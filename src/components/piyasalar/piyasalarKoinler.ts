/**
 * Piyasalar → Koinler sekmesi: fiyat kaynakları ve sembol listesi.
 * Binance toplu `symbols=[...]` bazı kodlarda 400 verip tüm grubu düşürebiliyor; tek sembol + Yahoo yedeği daha güvenilir.
 */
import { fetchYahooQuote } from "../../lib/yahooFinance";
import type { PiyasalarCardItem } from "./piyasalarShared";
import { formatUsdPrecise, loadParallelChunks, yieldUi } from "./piyasalarShared";

export const CRYPTO_CODES = [
  "A","ADA","AAVE","AERO","AKT","ALGO","APE","APT","AR","ARB",
  "ATOM","AVAX","AXS","BCH","BEAM","BGB","BNB","BONK","BRETT","BTC",
  "BTT","CAKE","CC","CFX","CHZ","COMP","CORE","CRO","CRV","DAI",
  "DEXE","DOGE","DOGS","DOT","DYDX","ENA","ENS","EOS","EGLD","ETC","ETH",
  "FDUSD","FET","FIL","FLOKI","FLOW","FORM","FTN","GALA","GNO","GRT",
  "HBAR","HNT","HYPE","ICP","IMX","INJ","IOTA","IP","JASMY","JTO",
  "KAIA","KAS","KAVA","LDO","LEO","LINK","LRC","LTC","MANA","MKR",
  "MANTA","METIS","MNT","MOVE","NEAR","NEO","NEXO","OKB","ONDO","OP","PAXG","PEPE",
  "PENDLE","PENGU","PYTH","QNT","RAY","RENDER","RON","RSR","S","SAND",
  "SEI","SHIB","SNX","SOL","SPX","STRK","SUI","SUPER","TAO","TEL",
  "THETA","TIA","TKX","TON","TRX","UNI","USDC","USDE","USDT","VET",
  "WIF","WLD","XLM","XMR","XRP","XTZ","ZBU","ZEC",
].sort((a, b) => a.localeCompare(b, "tr"));

const CRYPTO_COINGECKO_IDS: Record<string, string> = {
  APE: "apecoin",
  ARB: "arbitrum",
  BEAM: "beam-2",
  BRETT: "based-brett",
  CORE: "coredaoorg",
  DAI: "dai",
  DYDX: "dydx-chain",
  DOGS: "dogs-2",
  EGLD: "multiversx",
  EOS: "eos",
  FIL: "filecoin",
  FLOKI: "floki",
  FLOW: "flow",
  FORM: "four",
  FTN: "fasttoken",
  ICP: "internet-computer",
  IMX: "immutable-x",
  INJ: "injective-protocol",
  IOTA: "iota",
  IP: "story-2",
  KAIA: "kaia",
  KAVA: "kava",
  LINK: "chainlink",
  MKR: "maker",
  RON: "ronin",
  SEI: "sei-network",
  SHIB: "shiba-inu",
  SNX: "synthetix-network-token",
  SUI: "sui",
  SUPER: "superverse",
  TIA: "celestia",
  UNI: "uniswap",
  WIF: "dogwifcoin",
  ZBU: "zircuit-bridged-usdc-bison",
};

type CoinGeckoMarket = {
  id?: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number | null;
};

/**
 * Binance spot’ta USDT çifti bazen kodla birebir değil (1000* sözleşmeleri).
 * Önce listedeki alternatif, sonra ham kod denenir.
 */
const BINANCE_USDT_BASE_ALTS: Record<string, readonly string[]> = {
  PEPE: ["1000PEPE", "PEPE"],
  SHIB: ["1000SHIB", "SHIB"],
  BONK: ["1000BONK", "BONK"],
  FLOKI: ["1000FLOKI", "FLOKI"],
  LUNC: ["1000LUNC", "LUNC"],
  XEC: ["1000XEC", "XEC"],
  SATS: ["1000SATS", "SATS"],
  DOGS: ["1000DOGS", "DOGS"],
};

type BinanceTickerRow = { symbol: string; lastPrice: string; priceChangePercent: string };

/** Bazı CDN’ler boş User-Agent’ı keser; mobilde Binance/Coingecko yanıtı gelmeyebilir. */
const JSON_FETCH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

async function fetchCoinGeckoMarketsPage(page: number): Promise<CoinGeckoMarket[]> {
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`;
    const r = await fetch(url, { headers: JSON_FETCH_HEADERS });
    if (!r.ok) return [];
    const rows = (await r.json()) as CoinGeckoMarket[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function fetchCryptoMarketMap(): Promise<Map<string, CoinGeckoMarket>> {
  const map = new Map<string, CoinGeckoMarket>();
  const p1 = await fetchCoinGeckoMarketsPage(1);
  await yieldUi();
  const p2 = await fetchCoinGeckoMarketsPage(2);
  for (const row of [...p1, ...p2]) {
    const code = row.symbol?.trim().toUpperCase();
    if (!code || map.has(code)) continue;
    map.set(code, row);
  }
  return map;
}

async function fetchCoinGeckoOverrides(): Promise<Map<string, CoinGeckoMarket>> {
  const entries = Object.entries(CRYPTO_COINGECKO_IDS);
  if (!entries.length) return new Map();
  try {
    const ids = entries.map(([, id]) => id).join(",");
    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    const r = await fetch(url, { headers: JSON_FETCH_HEADERS });
    if (!r.ok) return new Map();
    const rows = (await r.json()) as CoinGeckoMarket[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const map = new Map<string, CoinGeckoMarket>();
    for (const [code, id] of entries) {
      const row = byId.get(id);
      if (row) map.set(code, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * CryptoCompare: tek istekte çok sayıda sembol (mobilde Binance/Coingecko boş kalabiliyor).
 * RAW anahtarları büyük harf ticker ile eşleşir.
 */
async function fetchCryptoCompareBatch(codes: readonly string[]): Promise<Map<string, { price: number; pct: number }>> {
  const map = new Map<string, { price: number; pct: number }>();
  const chunk = 32;
  for (let i = 0; i < codes.length; i += chunk) {
    if (i > 0) await yieldUi();
    const part = codes.slice(i, i + chunk);
    const fsyms = part.map((c) => c.toUpperCase()).join(",");
    try {
      const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(fsyms)}&tsyms=USD`;
      const r = await fetch(url, { headers: JSON_FETCH_HEADERS });
      if (!r.ok) continue;
      const j = (await r.json()) as {
        RAW?: Record<string, { USD?: { PRICE?: number; CHANGEPCT24HOUR?: number } }>;
      };
      const raw = j.RAW ?? {};
      for (const code of part) {
        const u = code.toUpperCase();
        const row = raw[u]?.USD;
        const price = row?.PRICE;
        if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
        const pct = row?.CHANGEPCT24HOUR;
        map.set(code, {
          price,
          pct: typeof pct === "number" && Number.isFinite(pct) ? pct : 0,
        });
      }
    } catch {
      /* sonraki parça */
    }
  }
  return map;
}

async function fetchBinance24hForCode(code: string): Promise<{ price: number; pct: number } | null> {
  const alts = BINANCE_USDT_BASE_ALTS[code] ?? [code];
  const bases = [...new Set(alts.map((b) => b.toUpperCase()))];
  for (const base of bases) {
    const symbol = `${base}USDT`;
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, {
        headers: JSON_FETCH_HEADERS,
      });
      if (!r.ok) continue;
      const row = (await r.json()) as BinanceTickerRow;
      if (!row?.symbol) continue;
      const price = Number(row.lastPrice);
      const pct = Number(row.priceChangePercent);
      if (!Number.isFinite(price) || price <= 0) continue;
      return { price, pct: Number.isFinite(pct) ? pct : 0 };
    } catch {
      /* sonraki aday */
    }
  }
  return null;
}

async function fetchYahooUsdForCode(code: string): Promise<{ price: number; pct: number } | null> {
  for (const sym of [`${code}-USD`, `${code}-USDT`]) {
    const q = await fetchYahooQuote(sym);
    if (q?.price != null && Number.isFinite(q.price) && q.price > 0) {
      return { price: q.price, pct: q.changePct ?? 0 };
    }
  }
  return null;
}

export async function loadKoinlerAllCards(): Promise<PiyasalarCardItem[]> {
  const [marketMap, overrideMap, ccMap] = await Promise.all([
    fetchCryptoMarketMap(),
    fetchCoinGeckoOverrides(),
    fetchCryptoCompareBatch(CRYPTO_CODES),
  ]);

  const binanceSlots = await loadParallelChunks(CRYPTO_CODES, 6, 5, fetchBinance24hForCode);

  const rows: PiyasalarCardItem[] = CRYPTO_CODES.map((code, i) => {
    const b = binanceSlots[i];
    if (b && Number.isFinite(b.price) && b.price > 0) {
      return {
        title: code,
        value: formatUsdPrecise(b.price),
        pct: b.pct,
      };
    }
    const ov = overrideMap.get(code);
    if (ov?.current_price != null && Number.isFinite(ov.current_price) && ov.current_price > 0) {
      return {
        title: code,
        value: formatUsdPrecise(ov.current_price),
        pct: ov.price_change_percentage_24h ?? 0,
      };
    }
    const cc = ccMap.get(code);
    if (cc && Number.isFinite(cc.price) && cc.price > 0) {
      return {
        title: code,
        value: formatUsdPrecise(cc.price),
        pct: cc.pct,
      };
    }
    const row = marketMap.get(code);
    if (row?.current_price != null && Number.isFinite(row.current_price) && row.current_price > 0) {
      return {
        title: code,
        value: formatUsdPrecise(row.current_price),
        pct: row.price_change_percentage_24h ?? 0,
      };
    }
    return { title: code, value: "—", pct: 0 };
  });

  const missingIdx: number[] = [];
  rows.forEach((row, i) => {
    if (row.value === "—") missingIdx.push(i);
  });
  if (!missingIdx.length) return rows;

  const missingCodes = missingIdx.map((i) => CRYPTO_CODES[i]!);
  const yahooSlots = await loadParallelChunks(missingCodes, 6, 5, fetchYahooUsdForCode);
  for (let j = 0; j < missingIdx.length; j++) {
    const idx = missingIdx[j]!;
    const y = yahooSlots[j];
    if (y && y.price > 0) {
      rows[idx] = {
        title: rows[idx]!.title,
        value: formatUsdPrecise(y.price),
        pct: y.pct,
      };
    }
  }

  return rows;
}

/** TradingView mini grafik: Binance’deki gerçek USDT bazını kullan (1000PEPE vb.). */
export function koinTradingViewSymbol(code: string): string {
  const alts = BINANCE_USDT_BASE_ALTS[code];
  const base = (alts?.[0] ?? code).toUpperCase();
  return `BINANCE:${base}USDT`;
}
