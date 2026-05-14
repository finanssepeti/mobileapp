import type { CuzdanSiteState, GelirKalem, GiderAlt } from "./cuzdanSiteTypes";
import { GELIR_KALEMLERI, GIDER_ALTLARI } from "./cuzdanSiteTypes";

export function tarihAyAnahtari(tarih: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(tarih).trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export function ayIcinde(tarih: string, ayKey: string): boolean {
  const k = tarihAyAnahtari(tarih);
  return k === ayKey;
}

/** Tikli kalemler için ay içi gelir toplamı */
export function gelirToplamAy(state: CuzdanSiteState, ayKey: string): number {
  let t = 0;
  for (const r of state.gelirler) {
    if (!ayIcinde(r.tarih, ayKey)) continue;
    if (!state.gelirKalemAktif[r.kalem]) continue;
    t += Math.max(0, r.tutar);
  }
  return t;
}

export function gelirKalemAyToplam(state: CuzdanSiteState, ayKey: string, kalem: GelirKalem): number {
  if (!state.gelirKalemAktif[kalem]) return 0;
  let t = 0;
  for (const r of state.gelirler) {
    if (!ayIcinde(r.tarih, ayKey) || r.kalem !== kalem) continue;
    t += Math.max(0, r.tutar);
  }
  return t;
}

export function giderAltAyToplam(state: CuzdanSiteState, ayKey: string, alt: GiderAlt): number {
  let t = 0;
  for (const r of state.giderler) {
    if (!ayIcinde(r.tarih, ayKey) || r.alt !== alt) continue;
    t += Math.max(0, r.tutar);
  }
  return t;
}

export function giderToplamAy(state: CuzdanSiteState, ayKey: string): number {
  return GIDER_ALTLARI.reduce((a, { key }) => a + giderAltAyToplam(state, ayKey, key), 0);
}

/** EBITDA tablosu: gelir (tikli) − fatura − genel; finansman satırları ayrı */
export type TabloSatir = { kod: string; aciklama: string; tutar: number; vurgu?: "toplam" | "ara" | "finans" };

export function ebitdaTablosu(state: CuzdanSiteState, ayKey: string): TabloSatir[] {
  const gelir = gelirToplamAy(state, ayKey);
  const fat = giderAltAyToplam(state, ayKey, "fatura");
  const gen = giderAltAyToplam(state, ayKey, "genel");
  const kre = giderAltAyToplam(state, ayKey, "kredi");
  const kk = giderAltAyToplam(state, ayKey, "kredi_karti");
  const ebitda = gelir - fat - gen;
  const son = ebitda - kre - kk;
  return [
    { kod: "G1", aciklama: "Toplam gelir (tikli kalemler)", tutar: gelir, vurgu: "ara" },
    { kod: "G2", aciklama: "(-) Faturalarım", tutar: -fat, vurgu: "ara" },
    { kod: "G3", aciklama: "(-) Genel giderler", tutar: -gen, vurgu: "ara" },
    { kod: "EB", aciklama: "= EBITDA (gelir − fatura − genel)", tutar: ebitda, vurgu: "toplam" },
    { kod: "F1", aciklama: "(-) Kredi giderleri (Giderlerim → Krediler)", tutar: -kre, vurgu: "finans" },
    { kod: "F2", aciklama: "(-) Kredi kartı (Giderlerim → Kredi kartları)", tutar: -kk, vurgu: "finans" },
    { kod: "NS", aciklama: "= Nakit etkisi (EBITDA − kredi − KK)", tutar: son, vurgu: "toplam" },
  ];
}

export function nakitTablosu(
  state: CuzdanSiteState,
  ayKey: string,
  /** Önceki ayın kapanış nakdi; veri yoksa 0 */
  donemBasi: number,
): TabloSatir[] {
  const gelir = gelirToplamAy(state, ayKey);
  const fat = giderAltAyToplam(state, ayKey, "fatura");
  const gen = giderAltAyToplam(state, ayKey, "genel");
  const kre = giderAltAyToplam(state, ayKey, "kredi");
  const kk = giderAltAyToplam(state, ayKey, "kredi_karti");
  const cikis = fat + gen + kre + kk;
  const kapanis = donemBasi + gelir - cikis;
  return [
    { kod: "N0", aciklama: "Dönem başı nakit (önceki ay kapanışı)", tutar: donemBasi, vurgu: "ara" },
    { kod: "N1", aciklama: "(+) Gelirler (tikli kalemler, bu ay)", tutar: gelir, vurgu: "ara" },
    { kod: "N2", aciklama: "(-) Faturalarım", tutar: -fat, vurgu: "ara" },
    { kod: "N3", aciklama: "(-) Genel giderler", tutar: -gen, vurgu: "ara" },
    { kod: "N4", aciklama: "(-) Krediler", tutar: -kre, vurgu: "finans" },
    { kod: "N5", aciklama: "(-) Kredi kartları", tutar: -kk, vurgu: "finans" },
    { kod: "NK", aciklama: "= Dönem sonu nakit", tutar: kapanis, vurgu: "toplam" },
  ];
}

/** Ay anahtarlarını sırala (YYYY-MM) */
export function tumAyAnahtarlari(state: CuzdanSiteState): string[] {
  const set = new Set<string>();
  for (const r of state.gelirler) {
    const k = tarihAyAnahtari(r.tarih);
    if (k) set.add(k);
  }
  for (const r of state.giderler) {
    const k = tarihAyAnahtari(r.tarih);
    if (k) set.add(k);
  }
  return [...set].sort();
}

/** Seçili aydan önceki tüm aylar için kapanış nakdini zincirle hesaplar */
export function donemBasiNakit(state: CuzdanSiteState, ayKey: string): number {
  const aylar = tumAyAnahtarlari(state);
  if (aylar.length === 0) return 0;
  const sorted = [...aylar].sort();
  let bakiye = 0;
  for (const ay of sorted) {
    if (ay >= ayKey) break;
    const t = nakitTablosu(state, ay, bakiye);
    const kapanis = t.find((r) => r.kod === "NK")?.tutar ?? bakiye;
    bakiye = kapanis;
  }
  return bakiye;
}

export function cuzdanCsvAy(state: CuzdanSiteState, ayKey: string): string {
  const lines: string[] = [`FinansSepeti;Cüzdan;${ayKey}`, "Tip;Kalem;Tarih;Tutar;Açıklama"];
  for (const r of state.gelirler) {
    if (!ayIcinde(r.tarih, ayKey)) continue;
    lines.push(`Gelir;${r.kalem};${r.tarih};${r.tutar.toFixed(2)};`);
  }
  for (const r of state.giderler) {
    if (!ayIcinde(r.tarih, ayKey)) continue;
    const ac = (r.aciklama ?? "").split(";").join(" ");
    lines.push(`Gider;${r.alt};${r.tarih};${r.tutar.toFixed(2)};${ac}`);
  }
  for (const row of ebitdaTablosu(state, ayKey)) {
    lines.push(`EBITDA;${row.kod};${ayKey};${row.tutar.toFixed(2)};${row.aciklama}`);
  }
  const db = donemBasiNakit(state, ayKey);
  for (const row of nakitTablosu(state, ayKey, db)) {
    lines.push(`Nakit;${row.kod};${ayKey};${row.tutar.toFixed(2)};${row.aciklama}`);
  }
  return lines.join("\n");
}
