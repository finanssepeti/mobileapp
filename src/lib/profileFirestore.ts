import { doc, getDoc, setDoc } from "firebase/firestore";
import type { StoredProfile } from "./profileStorage";
import { getFirebaseFirestore, isFirebaseConfigured, resolveFirestoreActorKey } from "./firebaseClient";
import { buildSiteMirroredWritePayload, normalizeDocAccountSettings } from "./profileSiteFieldMap";

function profileRef(uid: string) {
  return doc(getFirebaseFirestore(), "profilesByUid", uid);
}

const READ_COLLECTIONS = ["userProfiles", "profiles", "profilesByUid"] as const;

/**
 * Sitedeki üç profil koleksiyonunu sırayla okur; son kaynak (profilesByUid) önceki alanların üzerine yazar.
 * Gizlilik / dil / tema için web anahtarları (language, siteTheme vb.) normalize edilir.
 */
export async function pullProfileFromFirestore(): Promise<Partial<StoredProfile> | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const uid = await resolveFirestoreActorKey();
    const db = getFirebaseFirestore();
    let merged: Partial<StoredProfile> = {};

    for (const col of READ_COLLECTIONS) {
      const snap = await getDoc(doc(db, col, uid)).catch(() => null);
      if (!snap?.exists()) continue;
      const data = snap.data() as Record<string, unknown>;
      merged = {
        ...merged,
        ...(data as Partial<StoredProfile>),
        ...normalizeDocAccountSettings(data),
      };
    }

    return Object.keys(merged).length ? merged : null;
  } catch {
    return null;
  }
}

/**
 * Profili mobil `profilesByUid` ve web ile aynı `profiles` + `userProfiles` belgelerine yazar (merge).
 */
export async function pushProfileToFirestore(profile: StoredProfile): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const uid = await resolveFirestoreActorKey();
    const db = getFirebaseFirestore();
    const payload = buildSiteMirroredWritePayload(profile, uid);
    const writes = READ_COLLECTIONS.map((col) => setDoc(doc(db, col, uid), payload, { merge: true }));
    await Promise.allSettled(writes);
  } catch {
    /* sessiz: yerel kayıt geçerli */
  }
}
