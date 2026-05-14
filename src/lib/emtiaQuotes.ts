/**
 * Beklenen JSON örneği (endpoint sizde nasılsa alan adlarını `parseEmtiaQuotes` içine ekleyebilirsiniz):
 * {
 *   "goldGramTry": { "price": 4021.84, "change": 12.34, "changePct": 0.31 },
 *   "silverGramTry": { "price": 44.27, "change": 0.18, "changePct": 0.41 },
 *   "oilUsd": { "price": 83.91, "change": 0.76, "changePct": 0.91 }
 * }
 */

export type EmtiaSlice = {
  price: number;
  change?: number;
  changePct?: number;
};

export type EmtiaQuotes = {
  goldGramTry?: EmtiaSlice;
  silverGramTry?: EmtiaSlice;
  oilUsd?: EmtiaSlice;
};

function pickNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim().replace(/\s/g, "");
    const trLike = /^[\d.]+,\d+$/.test(s);
    const normalized = trLike ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeSlice(raw: Record<string, unknown> | undefined): EmtiaSlice | undefined {
  if (!raw) return undefined;
  const price =
    pickNum(raw.price) ??
    pickNum(raw.fiyat) ??
    pickNum(raw.value) ??
    pickNum(raw.last) ??
    pickNum(raw.close);
  if (price === undefined) return undefined;
  const change = pickNum(raw.change) ?? pickNum(raw.degisim);
  const changePct = pickNum(raw.changePct) ?? pickNum(raw.changePercent) ?? pickNum(raw.yuzde);
  return { price, change, changePct };
}

/** Sitenizin döndürdüğü JSON şekline göre esnek eşleme (wp / api / özelleştirilmiş endpoint). */
export function parseEmtiaQuotes(json: unknown): EmtiaQuotes | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;

  const gold =
    normalizeSlice(o.goldGramTry as Record<string, unknown>) ??
    normalizeSlice(o.altinGramTl as Record<string, unknown>) ??
    normalizeSlice(o.altin_tl_gram as Record<string, unknown>) ??
    normalizeSlice((o.altin as Record<string, unknown>)?.gramTry as Record<string, unknown>);

  const silver =
    normalizeSlice(o.silverGramTry as Record<string, unknown>) ??
    normalizeSlice(o.gumusGramTl as Record<string, unknown>) ??
    normalizeSlice(o.gumus_tl_gram as Record<string, unknown>) ??
    normalizeSlice((o.gumus as Record<string, unknown>)?.gramTry as Record<string, unknown>);

  const oil =
    normalizeSlice(o.oilUsd as Record<string, unknown>) ??
    normalizeSlice(o.petrolUsd as Record<string, unknown>) ??
    normalizeSlice(o.petrol_usd as Record<string, unknown>) ??
    normalizeSlice(o.brentUsd as Record<string, unknown>);

  if (!gold && !silver && !oil) return null;
  return { goldGramTry: gold, silverGramTry: silver, oilUsd: oil };
}

export function formatTryCompact(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsdCompact(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

export function formatDelta(change?: number, changePct?: number) {
  if (change === undefined && changePct === undefined) return "—";
  const parts: string[] = [];
  if (change !== undefined) {
    const sign = change > 0 ? "+" : "";
    parts.push(`${sign}${change.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`);
  }
  if (changePct !== undefined) {
    const sign = changePct > 0 ? "+" : "";
    parts.push(`${sign}${changePct.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}%`);
  }
  return parts.join("  ");
}
