export type PeriodKey = "1W" | "1M" | "3M" | "6M" | "1Y";
export type MarketCategory = "emtia" | "borsa" | "nasdaq" | "kripto";
export type TrendMode = "risers" | "fallers";

export type CommodityDef = {
  id: "gold" | "silver" | "oil" | "palladium" | "platinum" | "copper";
  label: string;
  yahooSymbol: string;
};

export const COMMODITIES: CommodityDef[] = [
  { id: "gold", label: "Altın", yahooSymbol: "XAUUSD=X" },
  { id: "silver", label: "Gümüş", yahooSymbol: "XAGUSD=X" },
  { id: "oil", label: "Petrol", yahooSymbol: "CL=F" },
  { id: "palladium", label: "Paladyum", yahooSymbol: "PA=F" },
  { id: "platinum", label: "Platin", yahooSymbol: "PL=F" },
  { id: "copper", label: "Bakır", yahooSymbol: "HG=F" },
];

export const BIST100_SYMBOLS: string[] = [
  "AEFES.IS","AGHOL.IS","AHGAZ.IS","AKBNK.IS","AKCNS.IS","AKFGY.IS","AKFYE.IS","AKSA.IS","AKSEN.IS","ALARK.IS",
  "ALFAS.IS","ARCLK.IS","ARDYZ.IS","ASELS.IS","ASTOR.IS","BERA.IS","BIMAS.IS","BIOEN.IS","BOBET.IS","BRSAN.IS",
  "BRYAT.IS","BTCIM.IS","CANTE.IS","CCOLA.IS","CEMTS.IS","CIMSA.IS","DOAS.IS","DOHOL.IS","ECILC.IS","ECZYT.IS",
  "EGEEN.IS","EKGYO.IS","ENERY.IS","ENJSA.IS","ENKAI.IS","EREGL.IS","EUPWR.IS","FROTO.IS","GARAN.IS","GESAN.IS",
  "GOLTS.IS","GUBRF.IS","GWIND.IS","HALKB.IS","HEKTS.IS","ISCTR.IS","ISMEN.IS","KARSN.IS","KAYSE.IS","KCAER.IS",
  "KCHOL.IS","KLSER.IS","KONTR.IS","KONYA.IS","KOZAA.IS","KOZAL.IS","KRDMD.IS","MAVI.IS","MGROS.IS","MIATK.IS",
  "ODAS.IS","OTKAR.IS","OYAKC.IS","PETKM.IS","PGSUS.IS","QUAGR.IS","REEDR.IS","SASA.IS","SAYAS.IS","SELEC.IS",
  "SISE.IS","SKBNK.IS","SMRTG.IS","SOKM.IS","TABGD.IS","TAVHL.IS","TCELL.IS","THYAO.IS","TKFEN.IS","TKNSA.IS",
  "TOASO.IS","TSKB.IS","TTKOM.IS","TTRAK.IS","TUPRS.IS","TURSG.IS","ULKER.IS","VAKBN.IS","VESBE.IS","VESTL.IS",
  "YEOTK.IS","YKBNK.IS","YYLGD.IS","ZOREN.IS","ANSGR.IS","ANHYT.IS","ALBRK.IS",
];

export const NASDAQ100_SYMBOLS: string[] = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","COST",
  "NFLX","AMD","ADBE","PEP","CSCO","TMUS","INTC","QCOM","TXN","AMGN",
  "INTU","CMCSA","AMAT","HON","BKNG","GILD","VRTX","ADP","MDLZ","ADI",
  "PANW","SBUX","PYPL","LRCX","MU","REGN","MELI","KLAC","SNPS","CDNS",
  "ASML","CRWD","ABNB","DASH","PDD","MAR","MNST","ORLY","CTAS","CSX",
  "AEP","ROST","KDP","NXPI","DXCM","ODFL","FTNT","MRVL","PAYX","PCAR",
  "WDAY","IDXX","FAST","EXC","FANG","EA","TEAM","CPRT","VRSK","BKR",
  "CCEP","XEL","DLTR","AZN","GEHC","KHC","MCHP","ANSS","DDOG","ON",
  "ZS","LULU","CHTR","EBAY","WBD","BIIB","GFS","TTWO","ILMN","SPLK",
  "RIVN","TTD","ARM","SMCI","MDB","APP","CSGP","CEG","ACGL","LIN",
];

export const CRYPTO100_BINANCE_BASES: string[] = [
  "BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","TON","AVAX",
  "SHIB","DOT","LINK","MATIC","BCH","UNI","LTC","NEAR","APT","ATOM",
  "FIL","ARB","OP","ETC","AAVE","XLM","ALGO","SUI","SEI","INJ",
  "MKR","RUNE","GRT","PEPE","WIF","BONK","FET","RNDR","TIA","PYTH",
  "JUP","ENA","JTO","DYDX","LDO","GMX","SNX","CRV","COMP","1INCH",
  "SUSHI","YFI","ZEC","DASH","NEO","IOTA","KSM","FLOW","EGLD","HBAR",
  "XTZ","AXS","SAND","MANA","CHZ","FTM","KAVA","ROSE","CELO","MINA",
  "CFX","BLUR","WLD","AR","BOME","ORDI","STX","IMX","GALA","ENS",
  "ANKR","API3","BAND","AUDIO","ZIL","WOO","COTI","SKL","SXP","HOT",
  "ONE","QTUM","ICX","ONT","RVN","SC","DCR","NEXO","OMG","TRB",
];

