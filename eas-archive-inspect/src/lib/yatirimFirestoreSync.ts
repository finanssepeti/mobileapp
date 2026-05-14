import { doc, getDoc, setDoc } from "firebase/firestore";
import type { StoredYatirim } from "./yatirimStorage";
import { ensureAnonymousFirebaseUser, getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";
import { getSessionUserKey } from "./authSession";

const DOC_ID = "yatirimlarSite";

export type RemoteYatirimPayload = {
  items: StoredYatirim[];
  updatedAtMs: number;
};

function walletDocRef(userKey: string) {
  return doc(getFirebaseFirestore(), "walletByKey", userKey, "wallet", DOC_ID);
}

function normalizeItems(raw: unknown): StoredYatirim[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is StoredYatirim =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as StoredYatirim).id === "string" &&
      typeof (x as StoredYatirim).tarih === "string",
  );
}

function normalizeRemote(data: Record<string, unknown> | undefined): RemoteYatirimPayload | null {
  if (!data) return null;
  const updatedAtMs = typeof data.updatedAtMs === "number" && Number.isFinite(data.updatedAtMs) ? data.updatedAtMs : 0;
  const items = normalizeItems(data.items);
  return { items, updatedAtMs };
}

export async function pullYatirimlarFromFirestore(): Promise<RemoteYatirimPayload | null> {
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

export async function pushYatirimlarToFirestore(items: StoredYatirim[], updatedAtMs: number): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await ensureAnonymousFirebaseUser();
    const userKey = await getSessionUserKey();
    await setDoc(
      walletDocRef(userKey),
      {
        items,
        updatedAtMs,
      },
      { merge: true },
    );
  } catch {
    /* ağ / kurallar */
  }
}
