/** Piyasalar → TEFAS sekmesi: liste kısaltma + arama sırası */
import {
  TEFAS_PRIORITY_CODES,
  type TefasFund,
  type TefasYatFundsResponse,
} from "../../lib/tefasFunds";
import { formatTry, type PiyasalarCardItem } from "./piyasalarShared";

/** Listede gösterilecek toplam YAT fon sayısı. */
export const TEFAS_MODAL_MAX_FUNDS = 100;
/** Birim fiyata göre öncelikli üst dilim. */
export const TEFAS_MODAL_TOP_BY_PRICE = 60;
/** BIST 30/100, para piyasası, emeklilik, kıymetli maden vb. çeşitlilik dilimi (üst 60’a girmeyenlerden). */
export const TEFAS_MODAL_FOCUS_EXTRA = 40;

function byUnitPriceDesc(a: TefasFund, b: TefasFund): number {
  const pa = a.price != null && Number.isFinite(a.price) ? a.price : Number.NEGATIVE_INFINITY;
  const pb = b.price != null && Number.isFinite(b.price) ? b.price : Number.NEGATIVE_INFINITY;
  if (pb !== pa) return pb - pa;
  return a.code.localeCompare(b.code, "tr", { sensitivity: "base" });
}

/** Ünvan/kodda BIST 30-100, para piyasası, emeklilik (BES), kıymetli maden / altın-gümüş vb. geçen YAT fonları. */
export function matchesTefasFocusGroup(fund: TefasFund): boolean {
  const hay = `${fund.code} ${fund.name ?? ""}`.toLocaleUpperCase("tr-TR");
  const keys = [
    "BIST 30",
    "BIST30",
    "BIST-30",
    "XUTUM",
    "BIST 100",
    "BIST100",
    "BIST-100",
    "XU100",
    "PARA PİYASASI",
    "PARAPIYASASI",
    "PARA PİYASA",
    "KISA VADELİ",
    "KISA VADELI",
    "EMEKLİLİK",
    "EMEKLILIK",
    " BES",
    "BES ",
    "(BES)",
    "BİREYSEL EM",
    "BIREYSEL EM",
    "KIYMETLİ MADEN",
    "KIYMETLI MADEN",
    "KYMETLİ MADEN",
    "KYMETLI MADEN",
    "DEĞERLİ METAL",
    "DEGERLI METAL",
    "ALTIN",
    "GÜMÜŞ",
    "GUMUS",
    "PLATIN",
    "PALADYUM",
    "MADEN FON",
  ];
  for (const k of keys) {
    if (hay.includes(k.toLocaleUpperCase("tr-TR"))) return true;
  }
  return false;
}

/**
 * En fazla `max` fon: önce birim fiyata göre üst `TEFAS_MODAL_TOP_BY_PRICE`, ardından aynı sıralamada
 * üst dilime girmeyenlerden odak gruplarına uyanlar (en fazla `TEFAS_MODAL_FOCUS_EXTRA`),
 * eksik kalırsa kalan kotayı yine birim fiyat sırasıyla doldurur.
 */
export function pickTopTefasFundsForModal(funds: TefasFund[], max: number): TefasFund[] {
  if (max <= 0) return [];

  const byCodeUpper = new Map(funds.map((f) => [f.code.toUpperCase(), f] as const));
  const pinned: TefasFund[] = [];
  const pinnedCodes = new Set<string>();
  for (const code of TEFAS_PRIORITY_CODES) {
    const f = byCodeUpper.get(code.toUpperCase());
    if (f && !pinnedCodes.has(f.code.toUpperCase())) {
      pinned.push(f);
      pinnedCodes.add(f.code.toUpperCase());
    }
  }

  const others = funds.filter((f) => !pinnedCodes.has(f.code.toUpperCase()));
  const sortedOthers = [...others].sort(byUnitPriceDesc);
  const roomAfterPinned = Math.max(0, max - pinned.length);

  const topN = Math.min(TEFAS_MODAL_TOP_BY_PRICE, roomAfterPinned);
  const topBucket = sortedOthers.slice(0, topN);
  const inPickCodes = new Set([
    ...pinned.map((p) => p.code.toUpperCase()),
    ...topBucket.map((t) => t.code.toUpperCase()),
  ]);

  if (pinned.length + topBucket.length >= max) {
    return [...pinned, ...topBucket].slice(0, max);
  }

  const rest = sortedOthers.filter((f) => !inPickCodes.has(f.code.toUpperCase()));
  const focusCap = Math.min(TEFAS_MODAL_FOCUS_EXTRA, max - pinned.length - topBucket.length);

  const focusHits = rest.filter(matchesTefasFocusGroup);
  const extra: TefasFund[] = [];
  const extraCodes = new Set<string>();
  for (const f of focusHits) {
    if (extra.length >= focusCap) break;
    extra.push(f);
    extraCodes.add(f.code.toUpperCase());
  }
  for (const f of rest) {
    if (extra.length >= focusCap) break;
    if (extraCodes.has(f.code.toUpperCase())) continue;
    extra.push(f);
    extraCodes.add(f.code.toUpperCase());
  }

  return [...pinned, ...topBucket, ...extra].slice(0, max);
}

/** TEFAS API cevabından modal kartları + önbellek alanları (ön yükleme / sekme ortak). */
export function buildTefasModalStateFromFunds(tefasData: TefasYatFundsResponse): {
  items: PiyasalarCardItem[];
  names: Record<string, string>;
} {
  const picked = pickTopTefasFundsForModal(tefasData.funds, TEFAS_MODAL_MAX_FUNDS);
  const names: Record<string, string> = {};
  const items: PiyasalarCardItem[] = picked.map((f) => {
    names[f.code] = f.name;
    return {
      title: f.code,
      subtitle: f.name && f.name !== f.code ? f.name : undefined,
      value: f.price != null && Number.isFinite(f.price) ? formatTry(f.price) : "—",
      pct: typeof f.changePct === "number" && Number.isFinite(f.changePct) ? f.changePct : 0,
    };
  });
  return { items, names };
}

/** Arama yokken sıra, `pickTopTefasFundsForModal` çıktısıyla aynı kalır. */
export function orderTefasCardsForSearch(
  items: PiyasalarCardItem[],
  names: Record<string, string>,
  query: string,
): PiyasalarCardItem[] {
  const q = query.trim().toUpperCase();
  if (!q) return items;
  const byCode = (a: PiyasalarCardItem, b: PiyasalarCardItem) =>
    a.title.localeCompare(b.title, "tr", { sensitivity: "base" });
  const sortedAll = [...items].sort(byCode);
  const matches = sortedAll.filter((c) => {
    const code = c.title.toUpperCase();
    const name = (names[c.title] ?? "").toUpperCase();
    return code.includes(q) || name.includes(q);
  });
  return matches.sort((a, b) => {
    const ac = a.title.toUpperCase();
    const bc = b.title.toUpperCase();
    const an = (names[a.title] ?? "").toUpperCase();
    const bn = (names[b.title] ?? "").toUpperCase();
    const aPref = ac.startsWith(q) || an.startsWith(q);
    const bPref = bc.startsWith(q) || bn.startsWith(q);
    if (aPref !== bPref) return aPref ? -1 : 1;
    return ac.localeCompare(bc, "tr", { sensitivity: "base" });
  });
}
