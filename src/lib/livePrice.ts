import { fetchYahooQuote } from "./yahooFinance";
import { fetchTradingViewMarketSnapshot } from "./tradingViewScan";

/** Troy ons → gram (kıymetli metal TL/ons → TL/gram). */
const GRAMS_PER_TROY_OZ = 31.1034768;

export type ProductQuote = {
  displayName: string;
  symbol: string;
  price: number; // native quote currency
  quoteCurrency: "TRY" | "USD";
  usdBased: boolean;
};

function normalizeText(v: string): string {
  return v.trim().toLocaleUpperCase("tr");
}

async function fetchFirstValidPrice(symbols: string[]): Promise<number | null> {
  for (const s of symbols) {
    const q = await fetchYahooQuote(s);
    if (q?.price && Number.isFinite(q.price) && q.price > 0) return q.price;
  }
  return null;
}

let tvSnapshotCache: { at: number; snap: Awaited<ReturnType<typeof fetchTradingViewMarketSnapshot>> } | null = null;
/** Kısa TTL: portföy satırı ile ana sayfa fiyatı aynı session’da güncel kalsın. */
const TV_SNAPSHOT_TTL_MS = 1500;

async function getTradingViewSnapshotCached(): Promise<Awaited<ReturnType<typeof fetchTradingViewMarketSnapshot>>> {
  const now = Date.now();
  if (tvSnapshotCache && now - tvSnapshotCache.at < TV_SNAPSHOT_TTL_MS) return tvSnapshotCache.snap;
  const snap = await fetchTradingViewMarketSnapshot();
  tvSnapshotCache = { at: now, snap };
  return snap;
}

function tryPerGramFromTroyOzTry(tryPerOz: number): number {
  return tryPerOz / GRAMS_PER_TROY_OZ;
}

export function resolveProductQuery(input: string): { displayName: string; symbol: string; quoteCurrency: "TRY" | "USD" } | null {
  const q = normalizeText(input);
  if (!q) return null;

  if (q.includes("ALTIN")) return { displayName: "Altın/TL", symbol: "ICE:XAUTRYG", quoteCurrency: "TRY" };
  if (q.includes("GÜMÜŞ") || q.includes("GUMUS")) return { displayName: "Gümüş/TL", symbol: "ICE:XAGTRYG", quoteCurrency: "TRY" };

  if (q.startsWith("BIST:")) {
    const code = q.slice(5).replace(/[^A-Z0-9]/g, "");
    if (!code) return null;
    return { displayName: `BIST:${code}`, symbol: `${code}.IS`, quoteCurrency: "TRY" };
  }

  // Crypto aliases and popular names (USD quoted)
  const cryptoAlias: Record<string, string> = {
    BITCOIN: "BTC-USD",
    BTC: "BTC-USD",
    ETHERIUM: "ETH-USD",
    ETHEREUM: "ETH-USD",
    ETH: "ETH-USD",
    SOLANA: "SOL-USD",
    SOLANO: "SOL-USD",
    SOL: "SOL-USD",
  };
  if (cryptoAlias[q]) {
    return { displayName: input.trim(), symbol: cryptoAlias[q], quoteCurrency: "USD" };
  }

  // US stock aliases and tickers (USD quoted)
  const usStockAlias: Record<string, string> = {
    MICROSOFT: "MSFT",
    MSFT: "MSFT",
    TESLA: "TSLA",
    TSLA: "TSLA",
    NVIDIA: "NVDA",
    NVDIA: "NVDA",
    NVDA: "NVDA",
    APPLE: "AAPL",
    AAPL: "AAPL",
  };
  if (usStockAlias[q]) {
    return { displayName: input.trim(), symbol: usStockAlias[q], quoteCurrency: "USD" };
  }

  // "NASDAQ:MSFT" format
  if (q.startsWith("NASDAQ:")) {
    const code = q.slice(7).replace(/[^A-Z0-9]/g, "");
    if (!code) return null;
    return { displayName: `NASDAQ:${code}`, symbol: code, quoteCurrency: "USD" };
  }

  // SOLUSD, BTCUSD, NASDAQ benzeri USD quote kabul edilen kısayollar
  if (/^[A-Z0-9]+USD$/.test(q)) {
    const base = q.replace(/USD$/, "");
    return { displayName: q, symbol: `${base}-USD`, quoteCurrency: "USD" };
  }

  // THYAO gibi çıplak BIST sembolü
  if (/^[A-Z]{3,6}$/.test(q)) {
    return { displayName: `BIST:${q}`, symbol: `${q}.IS`, quoteCurrency: "TRY" };
  }

  // Fallback: kullanıcı doğrudan Yahoo sembolü girdiyse (AAPL, SOL-USD vs)
  return { displayName: input.trim(), symbol: input.trim(), quoteCurrency: q.includes("-USD") ? "USD" : "TRY" };
}

export async function fetchUsdTry(): Promise<number | null> {
  const q = await fetchYahooQuote("USDTRY=X");
  if (!q?.price || !Number.isFinite(q.price)) return null;
  return q.price;
}

export async function fetchProductQuote(input: string): Promise<ProductQuote | null> {
  const uq = normalizeText(input);

  // Emtia özel akışı: TL parite önce, yoksa USD emtia * USDTRY
  const emtiaMap: Array<{ keys: string[]; displayName: string; trySymbols: string[]; usdSymbols: string[] }> = [
    {
      keys: ["ALTIN", "GOLD", "XAU"],
      displayName: "Altın/TL",
      trySymbols: ["ICE:XAUTRYG", "XAUTRYG"],
      usdSymbols: ["GC=F", "XAUUSD=X"],
    },
    {
      keys: ["GÜMÜŞ", "GUMUS", "SILVER", "XAG"],
      displayName: "Gümüş/TL",
      trySymbols: ["ICE:XAGTRYG", "XAGTRYG"],
      usdSymbols: ["SI=F", "XAGUSD=X"],
    },
    {
      keys: ["PLATIN", "PLATINUM", "XPT"],
      displayName: "Platin/TL",
      trySymbols: ["XPTTRYG"],
      usdSymbols: ["PL=F", "XPTUSD=X"],
    },
    {
      keys: ["PALADYUM", "PALLADIUM", "XPD"],
      displayName: "Paladyum/TL",
      trySymbols: ["XPDTRYG"],
      usdSymbols: ["PA=F", "XPDUSD=X"],
    },
    {
      keys: ["BAKIR", "COPPER"],
      displayName: "Bakır/TL",
      trySymbols: [],
      usdSymbols: ["HG=F"],
    },
    {
      keys: ["PETROL", "OIL", "BRENT"],
      displayName: "Petrol/TL",
      trySymbols: [],
      usdSymbols: ["BZ=F", "CL=F", "TVC:UKOIL"],
    },
  ];

  const emtia = emtiaMap.find((x) => x.keys.some((k) => uq.includes(k)));
  if (emtia) {
    /** Ana sayfa ile aynı kaynak: TV `FX_IDC` gram TL + Yahoo yedek. */
    if (emtia.displayName === "Altın/TL" || emtia.displayName === "Gümüş/TL") {
      const yahooTryFirst =
        emtia.displayName === "Altın/TL"
          ? await fetchFirstValidPrice(["ICE:XAUTRYG", "FX_IDC:XAUTRYG", "XAUTRYG"])
          : await fetchFirstValidPrice(["ICE:XAGTRYG", "FX_IDC:XAGTRYG", "XAGTRYG"]);
      if (yahooTryFirst && Number.isFinite(yahooTryFirst)) {
        let price = yahooTryFirst;
        if (emtia.displayName === "Altın/TL" && yahooTryFirst > 20000) price = tryPerGramFromTroyOzTry(yahooTryFirst);
        if (emtia.displayName === "Gümüş/TL" && yahooTryFirst > 2500) price = tryPerGramFromTroyOzTry(yahooTryFirst);
        return {
          displayName: emtia.displayName,
          symbol: emtia.displayName === "Altın/TL" ? "ICE:XAUTRYG" : "ICE:XAGTRYG",
          price,
          quoteCurrency: "TRY",
          usdBased: false,
        };
      }
      const tv = await getTradingViewSnapshotCached();
      if (emtia.displayName === "Altın/TL") {
        const p = tv.goldGramTry?.price;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) {
          return {
            displayName: emtia.displayName,
            symbol: "FX_IDC:XAUTRYG",
            price: p,
            quoteCurrency: "TRY",
            usdBased: false,
          };
        }
      } else {
        const p = tv.silverGramTry?.price;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) {
          return {
            displayName: emtia.displayName,
            symbol: "FX_IDC:XAGTRYG",
            price: p,
            quoteCurrency: "TRY",
            usdBased: false,
          };
        }
      }
      const tvStyleFirst =
        emtia.displayName === "Altın/TL"
          ? ["FX_IDC:XAUTRYG", "ICE:XAUTRYG", "XAUTRYG"]
          : ["FX_IDC:XAGTRYG", "ICE:XAGTRYG", "XAGTRYG"];
      const tryDirect = await fetchFirstValidPrice(tvStyleFirst);
      if (tryDirect) {
        let price = tryDirect;
        if (emtia.displayName === "Altın/TL" && tryDirect > 20000) price = tryPerGramFromTroyOzTry(tryDirect);
        if (emtia.displayName === "Gümüş/TL" && tryDirect > 2500) price = tryPerGramFromTroyOzTry(tryDirect);
        return {
          displayName: emtia.displayName,
          symbol: emtia.displayName === "Altın/TL" ? "FX_IDC:XAUTRYG" : "FX_IDC:XAGTRYG",
          price,
          quoteCurrency: "TRY",
          usdBased: false,
        };
      }
      const usdPrice = await fetchFirstValidPrice(emtia.usdSymbols);
      const usdTry = await fetchUsdTry();
      if (usdPrice && usdTry && usdTry > 0) {
        return {
          displayName: emtia.displayName,
          symbol: emtia.displayName === "Altın/TL" ? "FX_IDC:XAUTRYG" : "FX_IDC:XAGTRYG",
          price: tryPerGramFromTroyOzTry(usdPrice * usdTry),
          quoteCurrency: "TRY",
          usdBased: false,
        };
      }
      return null;
    }

    /** Yahoo XPTTRYG / XPDTRYG: TL troy ons → TL/gram. */
    if (emtia.displayName === "Platin/TL" || emtia.displayName === "Paladyum/TL") {
      const tryOz = await fetchFirstValidPrice(emtia.trySymbols);
      if (tryOz) {
        return {
          displayName: emtia.displayName,
          symbol: emtia.trySymbols[0] || emtia.usdSymbols[0],
          price: tryPerGramFromTroyOzTry(tryOz),
          quoteCurrency: "TRY",
          usdBased: false,
        };
      }
      const usdPrice = await fetchFirstValidPrice(emtia.usdSymbols);
      const usdTry = await fetchUsdTry();
      if (usdPrice && usdTry && usdTry > 0) {
        return {
          displayName: emtia.displayName,
          symbol: emtia.usdSymbols[0],
          price: tryPerGramFromTroyOzTry(usdPrice * usdTry),
          quoteCurrency: "TRY",
          usdBased: false,
        };
      }
      return null;
    }

    const tryDirect = await fetchFirstValidPrice(emtia.trySymbols);
    if (tryDirect) {
      return {
        displayName: emtia.displayName,
        symbol: emtia.trySymbols[0] || emtia.usdSymbols[0],
        price: tryDirect,
        quoteCurrency: "TRY",
        usdBased: false,
      };
    }
    const usdPrice = await fetchFirstValidPrice(emtia.usdSymbols);
    const usdTry = await fetchUsdTry();
    if (usdPrice && usdTry && usdTry > 0) {
      return {
        displayName: emtia.displayName,
        symbol: emtia.usdSymbols[0],
        price: usdPrice * usdTry,
        quoteCurrency: "TRY",
        usdBased: false,
      };
    }
    return null;
  }

  const r = resolveProductQuery(input);
  if (!r) return null;
  const q = await fetchYahooQuote(r.symbol);
  if (!q?.price || !Number.isFinite(q.price)) return null;
  return {
    displayName: r.displayName,
    symbol: r.symbol,
    price: q.price,
    quoteCurrency: r.quoteCurrency,
    usdBased: r.quoteCurrency === "USD",
  };
}

