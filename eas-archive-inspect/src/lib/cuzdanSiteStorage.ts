import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CuzdanSiteState, GelirKayit, GiderKayit } from "./cuzdanSiteTypes";
import { GELIR_KALEMLERI, varsayilanCuzdanState } from "./cuzdanSiteTypes";

const KEY = "@finansepeti_cuzdan_site_v1";
const KEY_META = "@finansepeti_cuzdan_site_meta_v1";

export type CuzdanLocalMeta = { updatedAtMs: number };

function isGelir(x: unknown): x is GelirKayit {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const k = o.kalem;
  return (
    typeof o.id === "string" &&
    typeof o.tarih === "string" &&
    typeof o.tutar === "number" &&
    Number.isFinite(o.tutar) &&
    (k === "maas" || k === "temettu" || k === "ikramiye" || k === "prim" || k === "diger")
  );
}

function isGider(x: unknown): x is GiderKayit {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const a = o.alt;
  return (
    typeof o.id === "string" &&
    typeof o.tarih === "string" &&
    typeof o.tutar === "number" &&
    Number.isFinite(o.tutar) &&
    (a === "fatura" || a === "genel" || a === "kredi" || a === "kredi_karti")
  );
}

/** Firestore / API gövdesinden güvenli cüzdan durumu */
export function parseCuzdanFirestoreFields(j: Record<string, unknown> | null | undefined): CuzdanSiteState {
  const base = varsayilanCuzdanState();
  if (!j) return base;
  const gelirler = Array.isArray(j.gelirler) ? j.gelirler.filter(isGelir) : [];
  const giderler = Array.isArray(j.giderler) ? j.giderler.filter(isGider) : [];
  const aktifRaw =
    typeof j.gelirKalemAktif === "object" && j.gelirKalemAktif !== null
      ? (j.gelirKalemAktif as Record<string, unknown>)
      : {};
  const gelirKalemAktif = { ...base.gelirKalemAktif };
  for (const { key } of GELIR_KALEMLERI) {
    const v = aktifRaw[key];
    if (typeof v === "boolean") gelirKalemAktif[key] = v;
  }
  return { gelirler, giderler, gelirKalemAktif };
}

export async function loadCuzdanLocalMeta(): Promise<CuzdanLocalMeta> {
  try {
    const raw = await AsyncStorage.getItem(KEY_META);
    if (!raw) return { updatedAtMs: 0 };
    const j = JSON.parse(raw) as { updatedAtMs?: unknown };
    const n = Number(j?.updatedAtMs);
    return { updatedAtMs: Number.isFinite(n) ? n : 0 };
  } catch {
    return { updatedAtMs: 0 };
  }
}

async function saveCuzdanLocalMeta(meta: CuzdanLocalMeta): Promise<void> {
  await AsyncStorage.setItem(KEY_META, JSON.stringify(meta));
}

export async function loadCuzdanSiteState(): Promise<CuzdanSiteState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return varsayilanCuzdanState();
    const j = JSON.parse(raw) as Record<string, unknown>;
    return parseCuzdanFirestoreFields(j);
  } catch {
    return varsayilanCuzdanState();
  }
}

/** Firestore ile birleştirir: updatedAtMs daha yeni olan kazanır. */
export async function loadCuzdanSiteStateMerged(): Promise<CuzdanSiteState> {
  const local = await loadCuzdanSiteState();
  const localMeta = await loadCuzdanLocalMeta();

  try {
    const { isFirebaseConfigured } = await import("./firebaseClient");
    const { pullCuzdanFromFirestore } = await import("./cuzdanFirestoreSync");
    if (!isFirebaseConfigured()) return local;

    const remote = await pullCuzdanFromFirestore();
    if (!remote) return local;

    const remoteBody = parseCuzdanFirestoreFields({
      gelirler: remote.gelirler,
      giderler: remote.giderler,
      gelirKalemAktif: remote.gelirKalemAktif,
    } as Record<string, unknown>);

    if (remote.updatedAtMs > localMeta.updatedAtMs) {
      await AsyncStorage.setItem(KEY, JSON.stringify(remoteBody));
      await saveCuzdanLocalMeta({ updatedAtMs: remote.updatedAtMs });
      return remoteBody;
    }
  } catch {
    /* Firestore yok veya izin yok */
  }

  return local;
}

export async function saveCuzdanSiteState(s: CuzdanSiteState): Promise<void> {
  const updatedAtMs = Date.now();
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
  await saveCuzdanLocalMeta({ updatedAtMs });
  try {
    const { isFirebaseConfigured } = await import("./firebaseClient");
    const { pushCuzdanToFirestore } = await import("./cuzdanFirestoreSync");
    if (isFirebaseConfigured()) {
      await pushCuzdanToFirestore(s, updatedAtMs);
    }
  } catch {
    /* uzak yazılamadı */
  }
}
