import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { ensureFirestoreAuthReady, getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";
import { resolveCommentActor } from "./commentsFirestore";

export type ForumTopicItem = {
  id: string;
  hashtag: string;
  createdAtMs: number;
  userId: string;
  username: string;
};

/** Konu başlığı: # ile başlar, boşluksuz; benzersizlik için küçük harfe çevrilir. */
export function normalizeForumHashtag(raw: string): string {
  let s = (raw || "").trim().replace(/\s+/g, "");
  if (!s.startsWith("#")) s = `#${s.replace(/^#+/, "")}`;
  const body = s
    .slice(1)
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._-]/g, "")
    .toLocaleLowerCase("tr-TR");
  const out = `#${body}`;
  if (out.length < 3) throw new Error("Konu en az 2 karakter olmalı (#ab gibi).");
  if (out.length > 52) throw new Error("Konu başlığı çok uzun.");
  return out;
}

export function forumHashtagToDocId(hashtag: string): string {
  const bare = hashtag.replace(/^#/, "").toLocaleLowerCase("tr-TR");
  const slug = bare.replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return (slug || "konu").slice(0, 80);
}

export function canUseForumFirestore(): boolean {
  return isFirebaseConfigured();
}

export async function createForumTopic(rawHashtag: string): Promise<void> {
  await ensureFirestoreAuthReady();
  const hashtag = normalizeForumHashtag(rawHashtag);
  const db = getFirebaseFirestore();
  const { socialUserId, username } = await resolveCommentActor();
  const userId = String(socialUserId ?? "").trim() || "anon";
  const nameRaw = String(username ?? "").trim();
  const userLabel =
    !nameRaw ? "@kullanici" : nameRaw.startsWith("@") ? nameRaw : `@${nameRaw}`;
  const docId = forumHashtagToDocId(hashtag);
  const ref = doc(db, "forumTopics", docId);
  /* Tek işlemde oku+yaz: yoksa oluştur; varsa dokunma. Ayrı setDoc yarışında update sayılıp kurallar reddediyordu. */
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (snap.exists()) {
        return;
      }
      transaction.set(ref, {
        hashtag,
        userId,
        username: userLabel,
        source: "finanssepeti-mobile-forum",
        createdAt: serverTimestamp(),
      });
    });
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(code ? `${base} (${code})` : base);
  }
}

/** Oturum açıksa forum konu belgesini siler (moderasyon). */
export async function deleteForumTopicDoc(docId: string): Promise<void> {
  const id = (docId || "").trim();
  if (!id) throw new Error("Konu kimliği yok.");
  try {
    await ensureFirestoreAuthReady();
  } catch {
    throw new Error("Konu silmek için Firebase’de Anonymous oturumu gerekir (Console → Authentication).");
  }
  const db = getFirebaseFirestore();
  await deleteDoc(doc(db, "forumTopics", id));
}

export async function subscribeForumTopics(
  onItems: (items: ForumTopicItem[]) => void,
  onError?: (msg: string) => void,
): Promise<Unsubscribe> {
  const db = getFirebaseFirestore();
  const q = query(collection(db, "forumTopics"), orderBy("createdAt", "desc"), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const out: ForumTopicItem[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const hashtag = typeof x.hashtag === "string" ? x.hashtag.trim() : "";
        const userId = typeof x.userId === "string" ? x.userId : "";
        const username = typeof x.username === "string" ? x.username : "@kullanici";
        const ts = x.createdAt as { toMillis?: () => number } | undefined;
        const createdAtMs = typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
        return { id: d.id, hashtag: hashtag || `#${d.id}`, createdAtMs, userId, username };
      });
      onItems(out);
    },
    () => onError?.("Forum konuları yüklenemedi."),
  );
}
