import type { StoredYatirim } from "./yatirimStorage";

/** Boşluk / büyük-küçük farklarını yok say. */
function normUrun(urun: string): string {
  return urun.trim().replace(/\s+/g, "").toLocaleUpperCase("tr");
}

/**
 * `toLocaleUpperCase("tr")` sonrası `ALTİN` ile ASCII `ALTIN` eşleşmez; ürün adı eşlemesi için İ/I ve benzeri harfleri sadeleştirir.
 */
function foldTrAscii(upperTr: string): string {
  return upperTr
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C");
}

function isUsdRow(r: StoredYatirim): boolean {
  const raw = (r.symbol ?? r.urun).trim().toUpperCase();
  return (
    r.quoteCurrency === "USD" || raw.includes("-USD") || r.urun.toUpperCase().includes("USD")
  );
}

export type CanonicalPortfolio = {
  /** `PortfoyumModal` gruplama anahtarı */
  groupKey: string;
  /** Kart başlığı (Piyasalar + ile aynı görünüm) */
  displayLabel: string;
  /** `fetchProductQuote` / anlık fiyat önbelleği tek anahtar */
  quoteKey: string;
};

/**
 * Aynı ekonomik pozisyonu farklı Yahoo/TV sembolleriyle kaydeden satırları tek kartta birleştirir
 * (örn. Piyasalar "+" → `Altın/TL`, Yatırım Ekle araması → `GC=F` yedeği).
 */
export function canonicalPortfolioFromStored(r: StoredYatirim): CanonicalPortfolio {
  const sym = (r.symbol ?? "").trim().toUpperCase();
  const ur = normUrun(r.urun);
  const urF = foldTrAscii(ur);
  const usd = isUsdRow(r);

  const tryGold =
    !usd &&
    ((urF.includes("ALTIN") && (urF.includes("/TL") || urF.endsWith("TL"))) ||
      ["GC=F", "XAUUSD=X", "XAUUSD", "XAUTRY=X", "ICE:XAUTRYG", "FX_IDC:XAUTRYG", "XAUTRYG"].includes(sym));
  if (tryGold) {
    return {
      groupKey: "try:altin-tl",
      displayLabel: "Altın/TL",
      quoteKey: "Altın",
    };
  }

  const trySilver =
    (!usd && (urF.includes("GUMUS") || urF.includes("SILVER")) && (urF.includes("/TL") || urF.endsWith("TL"))) ||
    (!usd &&
      ["SI=F", "XAGUSD=X", "XAGUSD", "ICE:XAGTRYG", "FX_IDC:XAGTRYG", "XAGTRYG"].includes(sym));
  if (trySilver) {
    return {
      groupKey: "try:gumus-tl",
      displayLabel: "Gümüş/TL",
      quoteKey: "Gümüş",
    };
  }

  const tryPlatin =
    (!usd && urF.includes("PLATIN") && (urF.includes("/TL") || urF.endsWith("TL"))) ||
    (!usd && ["XPTTRYG", "ICE:XPTTRYG", "PL=F", "XPTUSD=X", "OANDA:XPTUSD"].includes(sym));
  if (tryPlatin) {
    return {
      groupKey: "try:platin-tl",
      displayLabel: "Platin/TL",
      quoteKey: "Platin",
    };
  }

  const tryPaladyum =
    (!usd && urF.includes("PALADYUM") && (urF.includes("/TL") || urF.endsWith("TL"))) ||
    (!usd && ["XPDTRYG", "ICE:XPDTRYG", "PA=F", "XPDUSD=X", "OANDA:XPDUSD"].includes(sym));
  if (tryPaladyum) {
    return {
      groupKey: "try:paladyum-tl",
      displayLabel: "Paladyum/TL",
      quoteKey: "Paladyum",
    };
  }

  const tryBakir =
    (!usd && (urF.includes("BAKIR") || urF.includes("COPPER")) && (urF.includes("/TL") || urF.endsWith("TL"))) ||
    (!usd && ["HG=F", "OANDA:XCUUSD"].includes(sym));
  if (tryBakir) {
    return {
      groupKey: "try:bakir-tl",
      displayLabel: "Bakır/TL",
      quoteKey: "Bakır",
    };
  }

  const tryPetrol =
    (!usd &&
      (urF.includes("PETROL") || urF.includes("OIL") || urF.includes("BRENT")) &&
      (urF.includes("/TL") || urF.endsWith("TL"))) ||
    (!usd && (sym === "BZ=F" || sym === "CL=F" || sym.includes("UKOIL")));
  if (tryPetrol) {
    return {
      groupKey: "try:petrol-tl",
      displayLabel: "Petrol/TL",
      quoteKey: "Petrol",
    };
  }

  const tryPetrolUsd =
    usd &&
    ((urF.includes("PETROL") && (urF.includes("/USD") || urF.endsWith("USD"))) ||
      sym === "BZ=F" ||
      sym === "CL=F" ||
      sym.includes("UKOIL"));
  if (tryPetrolUsd) {
    return {
      groupKey: "usd:petrol-usd",
      displayLabel: "Petrol/USD",
      quoteKey: "Petrol",
    };
  }

  /** Döviz / TL: Piyasalar `FX_IDC:*` ile `USDTRY=X` / `USD/TL` aynı kart. */
  if (!usd) {
    const fxTry: ReadonlyArray<{ groupKey: string; displayLabel: string; quoteKey: string; tail: string }> = [
      { groupKey: "try:fx-usd", displayLabel: "USD/TL", quoteKey: "USDTRY=X", tail: "USDTRY" },
      { groupKey: "try:fx-eur", displayLabel: "EUR/TL", quoteKey: "EURTRY=X", tail: "EURTRY" },
      { groupKey: "try:fx-gbp", displayLabel: "GBP/TL", quoteKey: "GBPTRY=X", tail: "GBPTRY" },
      { groupKey: "try:fx-cny", displayLabel: "CNY/TL", quoteKey: "CNYTRY=X", tail: "CNYTRY" },
      { groupKey: "try:fx-jpy", displayLabel: "JPY/TL", quoteKey: "JPYTRY=X", tail: "JPYTRY" },
      { groupKey: "try:fx-kwd", displayLabel: "KWD/TL", quoteKey: "KWDTRY=X", tail: "KWDTRY" },
      { groupKey: "try:fx-sar", displayLabel: "SAR/TL", quoteKey: "SARTRY=X", tail: "SARTRY" },
      { groupKey: "try:fx-cad", displayLabel: "CAD/TL", quoteKey: "CADTRY=X", tail: "CADTRY" },
    ];
    for (const fx of fxTry) {
      const urOk = ur === normUrun(fx.displayLabel);
      const symOk = sym.includes(fx.tail);
      if (urOk || symOk) {
        return {
          groupKey: fx.groupKey,
          displayLabel: fx.displayLabel,
          quoteKey: fx.quoteKey,
        };
      }
    }
  }

  const raw = (r.symbol ?? r.urun).trim().toUpperCase();
  let base = raw.replace(/\.IS$/i, "").replace(/\.E$/i, "").replace(/-USD$/i, "");
  const usd2 = r.quoteCurrency === "USD" || raw.includes("-USD") || r.urun.toUpperCase().includes("USD");
  if (usd2 && base.startsWith("NASDAQ:")) base = base.slice(8);
  if (!usd2 && base.startsWith("BIST:")) base = base.slice(5);
  return {
    groupKey: `${base}|${usd2 ? "usd" : "try"}`,
    displayLabel: (r.symbol ?? r.urun).trim().replace(/\.IS$/i, "").replace(/\.E$/i, ""),
    quoteKey: (r.symbol ?? r.urun).trim(),
  };
}
