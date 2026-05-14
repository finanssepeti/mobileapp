/** Piyasalar → NASDAQ kart sırası (arama) */
import type { PiyasalarCardItem } from "./piyasalarShared";

export function orderNasdaqCardsForSearch(items: PiyasalarCardItem[], query: string): PiyasalarCardItem[] {
  const q = query.trim().toUpperCase();
  const byTitle = (a: PiyasalarCardItem, b: PiyasalarCardItem) =>
    a.title.localeCompare(b.title, "tr", { sensitivity: "base" });
  const sortedAll = [...items].sort(byTitle);
  if (!q) return sortedAll;
  const matches = sortedAll.filter((c) => c.title.toUpperCase().includes(q));
  return matches.sort((a, b) => {
    const au = a.title.toUpperCase();
    const bu = b.title.toUpperCase();
    const aPref = au.startsWith(q);
    const bPref = bu.startsWith(q);
    if (aPref !== bPref) return aPref ? -1 : 1;
    return au.localeCompare(bu, "tr", { sensitivity: "base" });
  });
}
