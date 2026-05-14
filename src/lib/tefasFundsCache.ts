import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TefasFund, TefasYatFundsResponse } from "./tefasFunds";

const KEY = "@finansepeti_tefas_yat_snapshot_v1";

type StoredTefasSnapshot = {
  savedAtMs: number;
  payload: TefasYatFundsResponse;
};

function cacheMaxAgeMs(): number {
  const raw = process.env.EXPO_PUBLIC_TEFAS_LOCAL_CACHE_DAYS?.trim();
  const n = raw ? parseFloat(raw) : NaN;
  const days = Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 14;
  return days * 86_400_000;
}

function isFundRow(x: unknown): x is TefasFund {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.name === "string";
}

/** ephemeral alanları at — AsyncStorage’a yazmak için */
export function sanitizeTefasForStorage(d: TefasYatFundsResponse): TefasYatFundsResponse {
  const { servedFromLocalCache, cacheWarning, ...rest } = d;
  void servedFromLocalCache;
  void cacheWarning;
  return rest;
}

export async function loadTefasYatFundsCache(): Promise<TefasYatFundsResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as StoredTefasSnapshot;
    if (!j || typeof j.savedAtMs !== "number" || !j.payload) return null;
    if (Date.now() - j.savedAtMs > cacheMaxAgeMs()) return null;
    const p = j.payload;
    if (!p || typeof p.asOf !== "string" || !Array.isArray(p.funds)) return null;
    const funds = p.funds.filter(isFundRow);
    if (funds.length === 0) return null;
    return {
      asOf: p.asOf,
      count: typeof p.count === "number" ? p.count : funds.length,
      funds,
      dayChangeResolved: !!p.dayChangeResolved,
    };
  } catch {
    return null;
  }
}

export async function saveTefasYatFundsCache(data: TefasYatFundsResponse): Promise<void> {
  try {
    const payload = sanitizeTefasForStorage(data);
    if (!payload.funds.length) return;
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ savedAtMs: Date.now(), payload } satisfies StoredTefasSnapshot),
    );
  } catch {
    /* yazılamadı */
  }
}
