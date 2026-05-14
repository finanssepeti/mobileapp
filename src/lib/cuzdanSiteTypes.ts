export type GelirKalem = "maas" | "temettu" | "ikramiye" | "prim" | "diger";

export type GiderAlt = "fatura" | "genel" | "kredi" | "kredi_karti";

export type GelirKayit = {
  id: string;
  /** YYYY-MM-DD */
  tarih: string;
  kalem: GelirKalem;
  tutar: number;
};

export type GiderKayit = {
  id: string;
  tarih: string;
  alt: GiderAlt;
  tutar: number;
  aciklama?: string;
};

export type CuzdanSiteState = {
  gelirler: GelirKayit[];
  giderler: GiderKayit[];
  /** Tik işaretli = dahil; tik yok = grafik ve toplamlarda Yok */
  gelirKalemAktif: Record<GelirKalem, boolean>;
};

export const GELIR_KALEMLERI: { key: GelirKalem; label: string }[] = [
  { key: "maas", label: "Maaş" },
  { key: "temettu", label: "Temettü" },
  { key: "ikramiye", label: "İkramiye" },
  { key: "prim", label: "Prim" },
  { key: "diger", label: "Diğer gelirler" },
];

export const GIDER_ALTLARI: { key: GiderAlt; label: string }[] = [
  { key: "fatura", label: "Faturalarım" },
  { key: "genel", label: "Genel giderler" },
  { key: "kredi", label: "Krediler" },
  { key: "kredi_karti", label: "Kredi kartları" },
];

export function varsayilanCuzdanState(): CuzdanSiteState {
  const gelirKalemAktif = {} as Record<GelirKalem, boolean>;
  for (const { key } of GELIR_KALEMLERI) gelirKalemAktif[key] = true;
  return { gelirler: [], giderler: [], gelirKalemAktif };
}
