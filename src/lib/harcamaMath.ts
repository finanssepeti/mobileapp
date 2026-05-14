import type { HarcamaKayit } from "./harcamaStorage";

export type AylikOzet = { ayEtiket: string; ayKey: string; gelir: number; gider: number; net: number };

export type KategoriPayi = { kategori: string; tutar: number; payYuzde: number };

function ayKeyFromIso(tarih: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(tarih.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export function toplamGelir(rows: HarcamaKayit[]): number {
  return rows.filter((r) => r.tur === "gelir").reduce((a, r) => a + Math.max(0, r.tutar), 0);
}

export function toplamGider(rows: HarcamaKayit[]): number {
  return rows.filter((r) => r.tur === "gider").reduce((a, r) => a + Math.max(0, r.tutar), 0);
}

export function netNakitAkisi(rows: HarcamaKayit[]): number {
  return toplamGelir(rows) - toplamGider(rows);
}

/** Gider / gelir; gelir 0 ise 0 */
export function harcamaOraniGelire(rows: HarcamaKayit[]): number {
  const g = toplamGelir(rows);
  if (g <= 0) return 0;
  return (toplamGider(rows) / g) * 100;
}

export function sonNAyOzet(rows: HarcamaKayit[], n: number): AylikOzet[] {
  const keys = new Set<string>();
  for (const r of rows) {
    const k = ayKeyFromIso(r.tarih);
    if (k) keys.add(k);
  }
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const last = sorted.slice(-Math.max(1, n));

  return last.map((key) => {
    const [y, m] = key.split("-");
    const ayEtiket = `${m}.${y}`;
    let gelir = 0;
    let gider = 0;
    for (const r of rows) {
      if (ayKeyFromIso(r.tarih) !== key) continue;
      if (r.tur === "gelir") gelir += Math.max(0, r.tutar);
      else gider += Math.max(0, r.tutar);
    }
    return { ayEtiket, ayKey: key, gelir, gider, net: gelir - gider };
  });
}

export function giderKategoriDagilimi(rows: HarcamaKayit[]): KategoriPayi[] {
  const giderler = rows.filter((r) => r.tur === "gider");
  const toplam = giderler.reduce((a, r) => a + Math.max(0, r.tutar), 0);
  const map = new Map<string, number>();
  for (const r of giderler) {
    const k = r.kategori.trim() || "Diğer";
    map.set(k, (map.get(k) ?? 0) + Math.max(0, r.tutar));
  }
  const list = [...map.entries()]
    .map(([kategori, tutar]) => ({
      kategori,
      tutar,
      payYuzde: toplam > 0 ? (tutar / toplam) * 100 : 0,
    }))
    .sort((a, b) => b.tutar - a.tutar);
  return list;
}

export function harcamalariCsv(rows: HarcamaKayit[]): string {
  const header = "Tarih;Tür;Kategori;Tutar;Açıklama";
  const lines = rows
    .slice()
    .sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0))
    .map((r) => {
      const tutar = r.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const ac = (r.aciklama ?? "").split(";").join(" ");
      return `${r.tarih};${r.tur};${r.kategori};${tutar};${ac}`;
    });
  return [header, ...lines].join("\n");
}
