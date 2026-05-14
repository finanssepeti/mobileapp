import { collection, getCountFromServer } from "firebase/firestore";
import { ensureFirestoreAuthReady, getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";

/** Sosyal üye profilleri koleksiyonu (web ile uyumlu isim). */
const COLLECTION = "userProfiles";

/**
 * Firestore aggregate count; izin veya ağ hatasında null döner.
 */
export async function fetchSiteMembershipCount(): Promise<number | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    await ensureFirestoreAuthReady();
    const snap = await getCountFromServer(collection(getFirebaseFirestore(), COLLECTION));
    return snap.data().count;
  } catch {
    return null;
  }
}
