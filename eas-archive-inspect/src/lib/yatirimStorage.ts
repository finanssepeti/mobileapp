import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@finansepeti_yatirimlar_v1";
const META_KEY = "@finansepeti_yatirimlar_meta_v1";

export type StoredYatirim = {
  id: string;
  tarih: string; // YYYY-MM-DD
  urun: string;
  symbol?: string;
  quoteCurrency?: "TRY" | "USD";
  usdTryAtBuy?: number;
  miktar: number;
  birimFiyat: number;
  toplamTutar: number;
};

async function loadYatirimLocalMeta(): Promise<{ updatedAtMs: number }> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return { updatedAtMs: 0 };
    const j = JSON.parse(raw) as { updatedAtMs?: number };
    return { updatedAtMs: typeof j.updatedAtMs === "number" ? j.updatedAtMs : 0 };
  } catch {
    return { updatedAtMs: 0 };
  }
}

async function saveYatirimLocalMeta(m: { updatedAtMs: number }): Promise<void> {
  await AsyncStorage.setItem(META_KEY, JSON.stringify(m));
}

/** Yerel AsyncStorage — Firestore birleştirmesi yok. */
export async function loadYatirimlar(): Promise<StoredYatirim[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredYatirim[]) : [];
  } catch {
    return [];
  }
}

/**
 * Firestore ile birleştirir: `updatedAtMs` daha yeni olan taraf kazanır (cüzdan ile aynı mantık).
 * Web ile aynı `walletByKey/.../wallet/yatirimlarSite` belgesini kullanır.
 */
export async function loadYatirimlarMerged(): Promise<StoredYatirim[]> {
  const local = await loadYatirimlar();
  const localMeta = await loadYatirimLocalMeta();

  try {
    const { isFirebaseConfigured } = await import("./firebaseClient");
    const { pullYatirimlarFromFirestore } = await import("./yatirimFirestoreSync");
    if (!isFirebaseConfigured()) return local;

    const remote = await pullYatirimlarFromFirestore();
    if (!remote) return local;

    if (remote.updatedAtMs > localMeta.updatedAtMs) {
      await AsyncStorage.setItem(KEY, JSON.stringify(remote.items));
      await saveYatirimLocalMeta({ updatedAtMs: remote.updatedAtMs });
      return remote.items;
    }
  } catch {
    /* Firestore yok veya izin yok */
  }

  return local;
}

export async function saveYatirimlar(items: StoredYatirim[]): Promise<void> {
  const updatedAtMs = Date.now();
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  await saveYatirimLocalMeta({ updatedAtMs });
  try {
    const { isFirebaseConfigured } = await import("./firebaseClient");
    const { pushYatirimlarToFirestore } = await import("./yatirimFirestoreSync");
    if (isFirebaseConfigured()) {
      await pushYatirimlarToFirestore(items, updatedAtMs);
    }
  } catch {
    /* uzak yazılamadı */
  }
}
