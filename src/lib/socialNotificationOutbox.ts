import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";

/** `socialNotifications` — Cloud Function push + (çoğu tür) uygulama içi liste */
export type SocialNotificationKind =
  | "follow_request"
  | "follow_accepted"
  | "comment_reply";

export async function enqueueSocialNotification(input: {
  type: SocialNotificationKind;
  toUserId: string;
  fromUserId: string;
  fromUsername: string;
  textPreview?: string;
  topic?: string;
}): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const to = (input.toUserId || "").trim();
  const from = (input.fromUserId || "").trim();
  if (!to || !from || to === from) return;
  const db = getFirebaseFirestore();
  await addDoc(collection(db, "socialNotifications"), {
    type: input.type,
    toUserId: to,
    fromUserId: from,
    fromUsername: input.fromUsername,
    textPreview: (input.textPreview || "").slice(0, 140),
    ...(input.topic ? { topic: input.topic } : {}),
    read: false,
    createdAt: serverTimestamp(),
  }).catch(() => {
    /* ağ / kural */
  });
}
