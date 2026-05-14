import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@finansepeti_harcamalar_v1";

export type HarcamaKayit = {
  id: string;
  tur: "gelir" | "gider";
  /** YYYY-MM-DD */
  tarih: string;
  tutar: number;
  kategori: string;
  aciklama?: string;
};

export async function loadHarcamalar(): Promise<HarcamaKayit[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKayit);
  } catch {
    return [];
  }
}

export async function saveHarcamalar(rows: HarcamaKayit[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(rows));
}

function isKayit(x: unknown): x is HarcamaKayit {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.tur === "gelir" || o.tur === "gider") &&
    typeof o.tarih === "string" &&
    typeof o.tutar === "number" &&
    Number.isFinite(o.tutar) &&
    typeof o.kategori === "string"
  );
}
