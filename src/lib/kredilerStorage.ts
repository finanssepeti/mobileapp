import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@finansepeti_krediler_v1";

export type StoredKredi = {
  id: string;
  banka: string;
  krediTuru: string;
  krediTutari: number;
  vadeAy: number;
  faizYillikYuzde: number;
  aylikTaksit: number;
  baslangic: string;
};

export async function loadKrediler(): Promise<StoredKredi[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j as StoredKredi[];
  } catch {
    return [];
  }
}

export async function saveKrediler(items: StoredKredi[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}
