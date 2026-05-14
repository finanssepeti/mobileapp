import type { YatirimPrefill } from "../YatirimEkleModal";

export type PiyasalarCardItem = {
  title: string;
  value: string;
  pct: number;
  subtitle?: string;
  tvChartSymbol?: string;
  actions?: {
    chartSymbol: string | null;
    prefill: YatirimPrefill;
  };
};

export function yieldUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function loadParallelChunks<T, R>(
  items: readonly T[],
  chunkSize: number,
  parallelChunks: number,
  mapFn: (item: T) => Promise<R>,
): Promise<R[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize) as T[]);
  }
  const out: R[] = [];
  for (let i = 0; i < chunks.length; i += parallelChunks) {
    if (i > 0) await yieldUi();
    const slice = chunks.slice(i, i + parallelChunks);
    const parts = await Promise.all(slice.map((ch) => Promise.all(ch.map(mapFn))));
    out.push(...parts.flat());
  }
  return out;
}

export function formatTry(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsdPrecise(n: number) {
  const abs = Math.abs(n);
  let digits = 2;
  if (abs < 0.1) digits = 3;
  if (abs < 0.01) digits = 4;
  if (abs < 0.001) digits = 5;
  if (abs < 0.0001) digits = 6;
  if (abs < 0.00001) digits = 7;
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatPct(change?: number | null, pct?: number | null) {
  const v = pct ?? 0;
  const sign = v >= 0 ? "+" : "";
  return `${sign}%${Math.abs(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseDisplayNumber(value: string): number | null {
  if (!value || value === "—") return null;
  const t = value.replace(/[₺$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function numToBirimInput(n: number, isUsd: boolean): string {
  if (!Number.isFinite(n)) return "";
  const d = isUsd ? (Math.abs(n) >= 1 ? 2 : 6) : 2;
  return n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
