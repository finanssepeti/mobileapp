import { doc, getDoc, setDoc } from "firebase/firestore";
import type { CuzdanSiteState } from "./cuzdanSiteTypes";
import { parseCuzdanFirestoreFields } from "./cuzdanSiteStorage";
import { ensureAnonymousFirebaseUser, getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";
import { getSessionUserKey } from "./authSession";

const DOC_ID = "harcamalarSite";

export type RemoteCuzdanPayload = {
  gelirler: CuzdanSiteState["gelirler"];
  giderler: CuzdanSiteState["giderler"];
  gelirKalemAktif: CuzdanSiteState["gelirKalemAktif"];
  updatedAtMs: number;
};

function walletDocRef(userKey: string) {
  return doc(getFirebaseFirestore(), "walletByKey", userKey, "wallet", DOC_ID);
}

function normalizeRemote(data: Record<string, unknown> | undefined): RemoteCuzdanPayload | null {
  if (!data) return null;
  const updatedAtMs = typeof data.updatedAtMs === "number" && Number.isFinite(data.updatedAtMs) ? data.updatedAtMs : 0;
  const body = parseCuzdanFirestoreFields(data);
  return { ...body, updatedAtMs };
}

export async function pullCuzdanFromFirestore(): Promise<RemoteCuzdanPayload | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    await ensureAnonymousFirebaseUser();
    const userKey = await getSessionUserKey();
    const snap = await getDoc(walletDocRef(userKey));
    if (!snap.exists()) return null;
    return normalizeRemote(snap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function pushCuzdanToFirestore(state: CuzdanSiteState, updatedAtMs: number): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await ensureAnonymousFirebaseUser();
    const userKey = await getSessionUserKey();
    await setDoc(
      walletDocRef(userKey),
      {
        gelirler: state.gelirler,
        giderler: state.giderler,
        gelirKalemAktif: state.gelirKalemAktif,
        updatedAtMs,
      },
      { merge: true },
    );
  } catch {
    /* ağ / kurallar hatası: yerel kayıt yine de geçerli */
  }
}
