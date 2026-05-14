import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  getDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getSessionLoginEmail } from "./authSession";
import { ensureFirestoreAuthReady, getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, resolveFirestoreActorKey } from "./firebaseClient";
import { loadProfile } from "./profileStorage";
import type { Firestore } from "firebase/firestore";
import * as FileSystem from "expo-file-system/legacy";
import { enqueueSocialNotification } from "./socialNotificationOutbox";
import { uploadLocalUriToStoragePath } from "./storageLocalUpload";

export type MyCommentItem = {
  id: string;
  source: "comments" | "socialPosts" | "posts" | "messages";
  text: string;
  topic: string;
  createdAtMs: number;
  updatedAtMs?: number;
};

export type CommentFeedItem = {
  id: string;
  rawId: string;
  source: "comments" | "socialPosts" | "posts" | "messages";
  text: string;
  topic: string;
  createdAtMs: number;
  updatedAtMs?: number;
  authorUserId: string;
  authorUsername: string;
  authorPhotoUri?: string;
  parentId?: string;
  quoteOfId?: string;
  quoteOfText?: string;
  quoteOfUsername?: string;
  likeCount: number;
  favoriteCount: number;
  replyCount: number;
  iLiked: boolean;
  iFavorited: boolean;
  iLikedAtMs?: number;
  iFavoritedAtMs?: number;
  likedByKeys: string[];
  favoritedByKeys: string[];
  mediaKind?: "image" | "video";
  mediaUrl?: string;
};

export type CommentMentionNotification = {
  id: string;
  fromUsername: string;
  topic: string;
  textPreview: string;
  createdAtMs: number;
};

export type CommentUserNotification = {
  id: string;
  type:
    | "comment_mention"
    | "comment_like"
    | "comment_favorite"
    | "comment_reply"
    | "follow_request"
    | "follow_accepted";
  fromUsername: string;
  topic?: string;
  textPreview: string;
  createdAtMs: number;
};

async function resolveCommentParentAuthorId(db: Firestore, parentId: string): Promise<string | null> {
  const id = (parentId || "").trim();
  if (!id) return null;
  for (const col of COMMENT_COLLECTIONS) {
    try {
      const snap = await getDoc(doc(db, col, id));
      if (snap.exists()) {
        const x = snap.data() as Record<string, unknown>;
        const uid = pickString(x, ["userId", "fromUserId", "ownerId", "uid", "authorId"]);
        if (uid) return uid;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function sendCommentSocialNotification(input: {
  type: "comment_like" | "comment_favorite";
  toUserId: string;
  fromUserId: string;
  fromUsername: string;
  commentId: string;
  textPreview: string;
}): Promise<void> {
  if (!input.toUserId || input.toUserId === input.fromUserId) return;
  const db = getFirebaseFirestore();
  await addDoc(collection(db, "socialNotifications"), {
    type: input.type,
    toUserId: input.toUserId,
    fromUserId: input.fromUserId,
    fromUsername: input.fromUsername,
    commentId: input.commentId,
    textPreview: input.textPreview.slice(0, 140),
    read: false,
    createdAt: serverTimestamp(),
  }).catch(() => {
    /* ignore */
  });
}

/**
 * Abone olurken tüm yansıma koleksiyonlarını dinle.
 * Yayın: `messages` önce olursa DM şemasıyla çakışır; sosyal yorum `comments` vb. öncelikli yazılmalı.
 */
const COMMENT_COLLECTIONS: Array<"comments" | "socialPosts" | "posts" | "messages"> = [
  "messages",
  "comments",
  "socialPosts",
  "posts",
];

const COMMENT_PUBLISH_COLLECTIONS: Array<"comments" | "socialPosts" | "posts" | "messages"> = [
  "comments",
  "socialPosts",
  "posts",
  "messages",
];
const COMMENT_MEDIA_LIMITS = { image: 15, video: 8 } as const;
/** Kotayı sayarken koleksiyon başına okunan üst sınır (daha düşük = daha hızlı yayın). */
const COMMENT_MEDIA_QUOTA_SCAN_LIMIT = 50;

function isCommentRecord(col: string, x: Record<string, unknown>): boolean {
  if (col === "messages") {
    const t = pickString(x, ["commentType", "type", "kind"]);
    const app = pickString(x, ["app"]);
    return t === "feed_comment" || app === "finanssepeti-mobile-comment";
  }
  return true;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickUrlFromUnknown(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object") {
    if (Array.isArray(v)) {
      for (const item of v) {
        const u = pickUrlFromUnknown(item);
        if (u) return u;
      }
      return "";
    }
    return pickString(v as Record<string, unknown>, [
      "url",
      "uri",
      "href",
      "src",
      "downloadURL",
      "downloadUrl",
      "publicUrl",
    ]);
  }
  return "";
}

/** Web mobil farklı alan adları; URL yoksa metin‑only satır oluşturmak için `mediaUrl` boş döner. */
function pickCommentMedia(x: Record<string, unknown>): { mediaUrl: string; mediaKind: "" | "image" | "video" } {
  const explicit = pickString(x, ["mediaKind", "mediaType", "attachmentKind", "type"]).toLowerCase();
  let mediaKind: "" | "image" | "video" = explicit === "video" || explicit === "image" ? explicit : "";

  const vUrl = pickString(x, ["videoUrl", "videoURL", "video_url", "attachmentVideoUrl"]);
  const iUrl =
    pickString(x, ["imageUrl", "imageURL", "image_url", "pictureUrl", "pictureURL", "thumbnailUrl", "thumbnailURL"]) ||
    pickUrlFromUnknown(x.image);
  const mUrl = pickString(x, ["mediaUrl", "mediaURL", "media_url", "fileUrl", "fileURL", "attachmentUrl", "cdnUrl"]);
  const pUrl = pickString(x, ["photoUrl", "photoURL", "photo", "picture", "coverUrl", "coverURL"]);

  let mediaUrl = "";
  const nestedMedia = pickUrlFromUnknown(x.media) || pickUrlFromUnknown(x.attachments) || pickUrlFromUnknown(x.attachment);

  if (vUrl) {
    mediaUrl = vUrl;
    if (!mediaKind) mediaKind = "video";
  } else if (iUrl) {
    mediaUrl = iUrl;
    if (!mediaKind) mediaKind = "image";
  } else if (mUrl) {
    mediaUrl = mUrl;
    if (!mediaKind) mediaKind = "image";
  } else if (pUrl) {
    mediaUrl = pUrl;
    if (!mediaKind) mediaKind = "image";
  } else if (nestedMedia) {
    mediaUrl = nestedMedia;
    if (!mediaKind) mediaKind = "image";
  }

  return { mediaUrl, mediaKind };
}

function tsToMs(ts: unknown): number {
  const x = ts as { toMillis?: () => number } | undefined;
  return typeof x?.toMillis === "function" ? x.toMillis() : 0;
}

function toMsLoose(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return tsToMs(v);
}

function normalizeUsername(v: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

function normalizeCommentText(v: string): string {
  return (v || "").replace(/\s+/g, " ").trim();
}

function guessMediaExt(kind: "image" | "video"): string {
  if (kind === "video") return "mp4";
  return "jpg";
}

function fallbackMediaContentType(kind: "image" | "video"): string {
  return kind === "video" ? "video/mp4" : "image/jpeg";
}

async function uploadCommentMedia(input: {
  uri: string;
  kind: "image" | "video";
  actorKey: string;
  /** Dosya zaten okunduysa (ör. kotayı sayarken paralel) tekrar okumayı atla. */
  preReadBase64?: string;
}): Promise<string> {
  const u = (input.uri || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
  const ext = guessMediaExt(input.kind);
  const path = `comments/${input.actorKey}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const st = getStorage(getFirebaseApp());
  const ct = fallbackMediaContentType(input.kind);
  const preB64 = (input.preReadBase64 || "").trim();
  try {
    return await uploadLocalUriToStoragePath(st, path, u, ct, preB64 ? { base64: preB64 } : undefined);
  } catch {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Dosya okunamadı (${res.status}).`);
    const blob = await res.blob();
    const blobType = (blob.type || "").trim();
    const storageCt =
      blobType && /^(image|video)\//i.test(blobType) ? blobType : ct;
    const rf = ref(st, path);
    await uploadBytes(rf, blob, { contentType: storageCt });
    return getDownloadURL(rf);
  }
}

async function fetchSiteUsernameForWebUser(webUserId: string): Promise<{ username: string; photoUri: string }> {
  const out = { username: "", photoUri: "" };
  const id = (webUserId || "").trim();
  if (!id || id === "unknown" || !isFirebaseConfigured()) return out;
  const db = getFirebaseFirestore();
  for (const col of ["userProfiles", "profiles", "profilesByUid"] as const) {
    try {
      const snap = await getDoc(doc(db, col, id));
      if (!snap.exists()) continue;
      const x = snap.data() as Record<string, unknown>;
      const u = pickString(x, ["username", "kullaniciAdi", "userName"]);
      if (u && !out.username) out.username = normalizeUsername(u);
      const ph = pickString(x, ["photoUri", "authorPhotoUri", "profilePhotoUri", "avatarUrl"]);
      if (ph && !out.photoUri) out.photoUri = ph.trim();
    } catch {
      /* ignore */
    }
  }
  if ((!out.username || !out.photoUri) && id) {
    for (const col of ["userProfiles", "profiles"] as const) {
      try {
        const snaps = await Promise.all([
          getDocs(query(collection(db, col), where("userId", "==", id), limit(1))).catch(() => null),
          getDocs(query(collection(db, col), where("uid", "==", id), limit(1))).catch(() => null),
        ]);
        for (const snap of snaps) {
          if (!snap || snap.empty) continue;
          const x = snap.docs[0]!.data() as Record<string, unknown>;
          const u = pickString(x, ["username", "kullaniciAdi", "userName"]);
          if (u && !out.username) out.username = normalizeUsername(u);
          const ph = pickString(x, ["photoUri", "authorPhotoUri", "profilePhotoUri", "avatarUrl"]);
          if (ph && !out.photoUri) out.photoUri = ph.trim();
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function isGenericPlaceholderUsername(raw: string): boolean {
  const s = normalizeUsername((raw || "").trim()).toLocaleLowerCase("tr-TR");
  return !(raw || "").trim() || s === "@kullanici";
}

function deriveCommentAuthorUsername(
  docRow: Record<string, unknown>,
  ownerKeys: string[],
  rawUsernamePick: string,
  myResolvedUsername: string,
): string {
  const rawPick = (rawUsernamePick || "").trim();
  if (rawPick && !isGenericPlaceholderUsername(rawPick)) {
    return normalizeUsername(rawPick);
  }
  if (matchesOwnerKeys(docRow, ownerKeys)) {
    const mine = normalizeUsername(myResolvedUsername);
    if (mine.trim()) return mine;
  }
  return rawPick ? normalizeUsername(rawPick) : "@kullanici";
}

/** Aynı yorum kimliği için tekrarlayan Firestore okumalarını önler. */
const authorEnrichmentMem = new Map<string, Promise<{ username: string; photoUri: string }>>();

function getAuthorEnrichmentPromise(webUserId: string): Promise<{ username: string; photoUri: string }> {
  const id = webUserId.trim();
  if (!id || id === "unknown") return Promise.resolve({ username: "", photoUri: "" });
  const hit = authorEnrichmentMem.get(id);
  if (hit) return hit;
  const p = fetchSiteUsernameForWebUser(id).then((r) => ({ username: r.username, photoUri: r.photoUri }));
  authorEnrichmentMem.set(id, p);
  return p;
}

async function enrichCommentFeedAuthorFields(items: CommentFeedItem[]): Promise<CommentFeedItem[]> {
  const ids = new Set<string>();
  for (const it of items) {
    const uid = (it.authorUserId || "").trim();
    if (!uid || uid === "unknown") continue;
    if (isGenericPlaceholderUsername(it.authorUsername)) ids.add(uid);
  }
  if (!ids.size) return items;

  const resolved = new Map<string, { username: string; photoUri: string }>();
  await Promise.all(
    [...ids].map(async (uid) => {
      resolved.set(uid, await getAuthorEnrichmentPromise(uid));
    }),
  );

  return items.map((it) => {
    const uid = (it.authorUserId || "").trim();
    if (!uid || uid === "unknown") return it;
    const r = resolved.get(uid);
    if (!r) return it;

    if (!isGenericPlaceholderUsername(it.authorUsername)) {
      if (!it.authorPhotoUri && r.photoUri.trim()) {
        return { ...it, authorPhotoUri: r.photoUri.trim() };
      }
      return it;
    }
    const uname = normalizeUsername(r.username);
    if (!uname.trim()) return it;
    return {
      ...it,
      authorUsername: uname,
      ...(it.authorPhotoUri ? {} : r.photoUri.trim() ? { authorPhotoUri: r.photoUri.trim() } : {}),
    };
  });
}

function buildOwnerKeys(input: { socialUserId: string; actorKey: string; username: string; email: string }): string[] {
  const uname = normalizeUsername(input.username);
  const unameBare = uname.startsWith("@") ? uname.slice(1) : uname;
  return Array.from(
    new Set(
      [input.socialUserId, input.actorKey, uname, unameBare, input.email, input.email.toLocaleLowerCase("tr-TR")]
        .map((x) => (x || "").trim())
        .filter(Boolean),
    ),
  );
}

async function resolveSocialUserIdByProfileHint(input: { username?: string; email?: string }): Promise<string | null> {
  const db = getFirebaseFirestore();
  const pickUserId = (docId: string, x: Record<string, unknown>): string => {
    const id = pickString(x, ["userId", "uid", "id"]);
    if (id) return id;
    if (docId && !docId.includes("@") && !docId.includes(".")) return docId;
    return "";
  };
  const username = normalizeUsername(input.username || "");
  const usernameBare = username.startsWith("@") ? username.slice(1) : username;
  const email = (input.email || "").trim().toLocaleLowerCase("tr-TR");
  const usernameCandidates = Array.from(
    new Set(
      [username, username.toLocaleLowerCase("tr-TR"), usernameBare, usernameBare.toLocaleLowerCase("tr-TR")]
        .map((v) => (v || "").trim())
        .filter(Boolean),
    ),
  );

  for (const u of usernameCandidates) {
    for (const c of ["userProfiles", "profiles"] as const) {
      const scans = await Promise.all([
        getDocs(query(collection(db, c), where("username", "==", u), limit(1))).catch(() => null),
        getDocs(query(collection(db, c), where("kullaniciAdi", "==", u), limit(1))).catch(() => null),
        getDocs(query(collection(db, c), where("userName", "==", u), limit(1))).catch(() => null),
      ]);
      for (const snap of scans) {
        if (!snap || snap.empty) continue;
        const d = snap.docs[0]!;
        const uid = pickUserId(d.id, d.data() as Record<string, unknown>);
        if (uid) return uid;
      }
    }
  }
  if (email) {
    for (const c of ["userProfiles", "profiles"] as const) {
      const scans = await Promise.all([
        getDocs(query(collection(db, c), where("email", "==", email), limit(1))).catch(() => null),
        getDocs(query(collection(db, c), where("mail", "==", email), limit(1))).catch(() => null),
      ]);
      for (const snap of scans) {
        if (!snap || snap.empty) continue;
        const d = snap.docs[0]!;
        const uid = pickUserId(d.id, d.data() as Record<string, unknown>);
        if (uid) return uid;
      }
    }
  }
  return null;
}

export async function resolveCommentActor() {
  await ensureFirestoreAuthReady();
  const actorKey = await resolveFirestoreActorKey();
  const profile = await loadProfile();
  const sessionEmail = ((await getSessionLoginEmail()) || "").trim().toLocaleLowerCase("tr-TR");
  let username = normalizeUsername(profile.kullaniciAdi || "");
  let email = ((profile.email || "").trim() || sessionEmail).toLocaleLowerCase("tr-TR");
  let photoUri = (profile.photoUri || "").trim();

  let socialUserId =
    (await resolveSocialUserIdByProfileHint({ username, email })) ||
    (email ? await resolveSocialUserIdByProfileHint({ username: "", email }) : null);
  if (!socialUserId) socialUserId = actorKey;

  if (!username.trim()) {
    const tryIds = Array.from(new Set([socialUserId, actorKey].filter(Boolean)));
    for (const uid of tryIds) {
      const remote = await fetchSiteUsernameForWebUser(uid);
      if (remote.username.trim()) {
        username = normalizeUsername(remote.username);
        if (!photoUri && remote.photoUri.trim()) photoUri = remote.photoUri.trim();
        break;
      }
    }
  }

  const ownerKeys = buildOwnerKeys({ socialUserId, actorKey, username, email });
  return { actorKey, socialUserId, username, email, ownerKeys, photoUri };
}

async function countActorMediaByKind(ownerKeys: string[], kind: "image" | "video"): Promise<number> {
  const db = getFirebaseFirestore();
  const cap = COMMENT_MEDIA_LIMITS[kind];
  const snaps = await Promise.all(
    COMMENT_COLLECTIONS.map((col) =>
      getDocs(
        query(collection(db, col), orderBy("createdAt", "desc"), limit(COMMENT_MEDIA_QUOTA_SCAN_LIMIT)),
      ).catch(() => null),
    ),
  );
  let total = 0;
  for (let i = 0; i < COMMENT_COLLECTIONS.length; i += 1) {
    const col = COMMENT_COLLECTIONS[i]!;
    const snap = snaps[i];
    if (!snap) continue;
    for (const d of snap.docs) {
      const x = d.data() as Record<string, unknown>;
      if (!isCommentRecord(col, x)) continue;
      if (!matchesOwnerKeys(x, ownerKeys)) continue;
      const mediaKindRaw = pickString(x, ["mediaKind"]);
      const mediaKind = mediaKindRaw === "video" ? "video" : mediaKindRaw === "image" ? "image" : "";
      if (mediaKind !== kind) continue;
      if (!pickCommentMedia(x).mediaUrl.trim()) continue;
      total += 1;
      if (total >= cap) return total;
    }
  }
  return total;
}

function matchesOwnerKeys(x: Record<string, unknown>, ownerKeys: string[]): boolean {
  const ownerCandidates = [
    pickString(x, ["userId", "uid", "ownerId", "fromUserId", "authorId"]),
    pickString(x, ["username", "kullaniciAdi", "userName", "authorUsername"]),
    pickString(x, ["email", "mail", "authorEmail"]),
  ]
    .map((v) => (v || "").trim().toLocaleLowerCase("tr-TR"))
    .filter(Boolean);
  if (!ownerCandidates.length) return false;
  const keys = new Set(ownerKeys.map((k) => k.toLocaleLowerCase("tr-TR")));
  return ownerCandidates.some((v) => keys.has(v));
}

/** `subscribeCommentFeed` satırlarında “benim yorumum” ayrımı — ayrı `subscribeMyComments` dinleyicisi gerekmez. */
export function commentFeedItemMatchesOwnerKeys(item: CommentFeedItem, ownerKeys: string[]): boolean {
  if (!ownerKeys.length) return false;
  const keys = new Set(ownerKeys.map((k) => (k || "").trim().toLocaleLowerCase("tr-TR")).filter(Boolean));
  const uid = (item.authorUserId || "").trim().toLocaleLowerCase("tr-TR");
  const uname = normalizeUsername(item.authorUsername || "");
  const unameLc = uname.trim().toLocaleLowerCase("tr-TR");
  const bare = (uname.startsWith("@") ? uname.slice(1) : uname).trim().toLocaleLowerCase("tr-TR");
  const candidates = [uid, unameLc, bare].filter(Boolean);
  return candidates.some((c) => keys.has(c));
}

function mapDoc(source: MyCommentItem["source"], id: string, x: Record<string, unknown>): MyCommentItem | null {
  const textRaw = pickString(x, ["text", "comment", "yorum", "content", "body"]);
  const { mediaUrl } = pickCommentMedia(x);
  if (!textRaw.trim() && !mediaUrl.trim()) return null;
  const text = textRaw.trim();
  const topic = pickString(x, ["topic", "konu", "category", "baslik", "title"]) || "Genel";
  const createdAtMs = tsToMs(x.createdAt) || tsToMs(x.timestamp) || tsToMs(x.date) || 0;
  const updatedAtMs = tsToMs(x.updatedAt) || 0;
  return {
    id,
    source,
    text,
    topic,
    createdAtMs,
    ...(updatedAtMs > 0 ? { updatedAtMs } : {}),
  };
}

function parseMentionUsernames(text: string): string[] {
  const re = /(^|\s)@([a-zA-Z0-9._-]{2,40})/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) != null) {
    const u = m[2]?.trim();
    if (!u) continue;
    out.add(`@${u.toLocaleLowerCase("tr-TR")}`);
  }
  return Array.from(out);
}

async function sendMentionNotifications(input: {
  text: string;
  fromUserId: string;
  fromUsername: string;
  topic: string;
  commentId: string;
}): Promise<void> {
  const mentions = parseMentionUsernames(input.text);
  if (!mentions.length) return;
  const db = getFirebaseFirestore();
  for (const mention of mentions) {
    const targetId = await resolveSocialUserIdByProfileHint({ username: mention });
    if (!targetId || targetId === input.fromUserId) continue;
    await addDoc(collection(db, "socialNotifications"), {
      type: "comment_mention",
      toUserId: targetId,
      fromUserId: input.fromUserId,
      fromUsername: input.fromUsername,
      topic: input.topic,
      commentId: input.commentId,
      textPreview: input.text.slice(0, 140),
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => {
      /* ignore */
    });
  }
}

export function canUseCommentsFirestore(): boolean {
  return isFirebaseConfigured();
}

export async function publishComment(input: {
  text: string;
  topic?: string;
  parentId?: string;
  quoteOfId?: string;
  quoteOfText?: string;
  quoteOfUsername?: string;
  media?: { uri: string; kind: "image" | "video"; durationMs?: number };
}): Promise<void> {
  await ensureFirestoreAuthReady();
  const text = normalizeCommentText(input.text);
  const hasMedia = !!input.media?.uri?.trim();
  if (!text && !hasMedia) throw new Error("Yorum boş olamaz.");
  const { socialUserId, actorKey, username, email, photoUri, ownerKeys } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  const topic = (input.topic || "").trim() || "Genel";
  let uploadedMediaUrl = "";
  if (input.media?.uri && input.media.kind) {
    const u = input.media.uri.trim();
    const isRemote = /^https?:\/\//i.test(u) || /^data:/i.test(u);
    const currentMediaCount = await countActorMediaByKind(ownerKeys, input.media.kind);
    const mediaLimit = COMMENT_MEDIA_LIMITS[input.media.kind];
    if (currentMediaCount >= mediaLimit) {
      throw new Error(
        input.media.kind === "image"
          ? "Fotoğraf kotanız dolu (maksimum 15)."
          : "Video kotanız dolu (maksimum 8).",
      );
    }
    const preB64 = !isRemote
      ? (await FileSystem.readAsStringAsync(u, { encoding: "base64" }).catch((): string => "")).trim()
      : "";
    try {
      uploadedMediaUrl = await uploadCommentMedia({
        uri: u,
        kind: input.media.kind,
        actorKey,
        ...(preB64 ? { preReadBase64: preB64 } : {}),
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  const videoDurationRounded =
    input.media?.kind === "video" && typeof input.media.durationMs === "number"
      ? Math.round(input.media.durationMs)
      : 0;
  const payload = {
    userId: socialUserId,
    uid: actorKey,
    ownerId: socialUserId,
    fromUserId: socialUserId,
    username: username || "",
    kullaniciAdi: username || "",
    authorUsername: username || "",
    authorPhotoUri: photoUri || "",
    photoUri: photoUri || "",
    email: email || "",
    text,
    comment: text,
    yorum: text,
    topic,
    ...(input.parentId?.trim() ? { parentId: input.parentId.trim() } : {}),
    ...(input.quoteOfId?.trim() ? { quoteOfId: input.quoteOfId.trim() } : {}),
    ...(input.quoteOfText?.trim() ? { quoteOfText: input.quoteOfText.trim().slice(0, 220) } : {}),
    ...(input.quoteOfUsername?.trim() ? { quoteOfUsername: input.quoteOfUsername.trim() } : {}),
    ...(uploadedMediaUrl && input.media?.kind ? { mediaUrl: uploadedMediaUrl, mediaKind: input.media.kind } : {}),
    ...(uploadedMediaUrl && input.media?.kind === "image" ? { imageUrl: uploadedMediaUrl } : {}),
    ...(uploadedMediaUrl && input.media?.kind === "video" ? { videoUrl: uploadedMediaUrl } : {}),
    ...(input.media?.kind === "video" &&
    videoDurationRounded > 0 &&
    videoDurationRounded <= 15_000 &&
    uploadedMediaUrl
      ? { mediaDurationMs: videoDurationRounded }
      : {}),
    likedBy: [],
    favoritedBy: [],
    source: "mobileapp",
    app: "finanssepeti-mobile-comment",
    commentType: "feed_comment",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  let ref: { id: string } | null = null;
  let lastErr: unknown = null;
  for (const col of COMMENT_PUBLISH_COLLECTIONS) {
    try {
      ref = await addDoc(collection(db, col), payload);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!ref) {
    const fe = lastErr as { code?: string; message?: string } | undefined;
    const code = typeof fe?.code === "string" ? `${fe.code}: ` : "";
    const msg = fe?.message || (lastErr instanceof Error ? lastErr.message : "Yorum yazılamadı.");
    throw new Error(`${code}${msg}`);
  }
  void sendMentionNotifications({
    text,
    fromUserId: socialUserId,
    fromUsername: username || "@kullanici",
    topic,
    commentId: ref.id,
  }).catch(() => {});
  const parentTrim = input.parentId?.trim();
  if (parentTrim) {
    void (async () => {
      const parentAuthor = await resolveCommentParentAuthorId(db, parentTrim);
      if (parentAuthor && parentAuthor !== socialUserId) {
        await enqueueSocialNotification({
          type: "comment_reply",
          toUserId: parentAuthor,
          fromUserId: socialUserId,
          fromUsername: username || "@kullanici",
          textPreview: text.slice(0, 140),
          topic,
        }).catch(() => {});
      }
    })().catch(() => {});
  }
}

export async function subscribeMyComments(
  onItems: (items: MyCommentItem[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const { ownerKeys } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  let byCol: Record<string, MyCommentItem[]> = {};
  const emit = () => {
    const out = Object.values(byCol)
      .flat()
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    onItems(out);
  };
  const unsubs = COMMENT_COLLECTIONS.map((col) =>
    onSnapshot(
      query(collection(db, col), orderBy("createdAt", "desc"), limit(500)),
      (snap) => {
        const out: MyCommentItem[] = [];
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          if (!isCommentRecord(col, x)) continue;
          if (!matchesOwnerKeys(x, ownerKeys)) continue;
          const item = mapDoc(col, d.id, x);
          if (item) out.push(item);
        }
        byCol[col] = out;
        emit();
      },
      () => onError?.("Yorumlar yüklenemedi."),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

export async function updateMyComment(
  commentId: string,
  nextText: string,
  source: "comments" | "socialPosts" | "posts" | "messages" = "comments",
): Promise<void> {
  const text = normalizeCommentText(nextText);
  if (!commentId.trim()) throw new Error("Yorum kimliği bulunamadı.");
  if (!text) throw new Error("Yorum boş olamaz.");
  const db = getFirebaseFirestore();
  await updateDoc(doc(db, source, commentId), {
    text,
    comment: text,
    yorum: text,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMyComment(
  commentId: string,
  source: "comments" | "socialPosts" | "posts" | "messages" = "comments",
): Promise<void> {
  if (!commentId.trim()) throw new Error("Yorum kimliği bulunamadı.");
  const db = getFirebaseFirestore();
  await deleteDoc(doc(db, source, commentId));
}

function buildCommentFeedRowsFromSnapshot(
  col: (typeof COMMENT_COLLECTIONS)[number],
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>,
  ownerKeys: string[],
  actorUsername: string,
  topicFilter?: string,
): CommentFeedItem[] {
  const rows: CommentFeedItem[] = [];
  for (const d of docs) {
    const x = d.data() as Record<string, unknown>;
    if (!isCommentRecord(col, x)) continue;
    const text = pickString(x, ["text", "comment", "yorum", "content", "body"]).trim();
    let { mediaUrl, mediaKind } = pickCommentMedia(x);
    if (mediaUrl && !mediaKind) mediaKind = "image";
    if (!text && !mediaUrl) continue;
    const topic = pickString(x, ["topic", "konu", "category", "baslik", "title"]) || "Genel";
    if (topicFilter !== undefined && topic !== topicFilter) continue;

    const createdAtMs = tsToMs(x.createdAt) || tsToMs(x.timestamp) || tsToMs(x.date) || 0;
    const updatedAtMs = tsToMs(x.updatedAt) || 0;
    const authorUserId = pickString(x, ["userId", "uid", "ownerId", "fromUserId", "authorId"]) || "unknown";
    const authorUsernamePick = pickString(x, [
      "username",
      "kullaniciAdi",
      "userName",
      "authorUsername",
      "displayName",
      "fromUsername",
    ]);
    const authorUsername = deriveCommentAuthorUsername(x, ownerKeys, authorUsernamePick, actorUsername);
    const authorPhotoUri = pickString(x, ["authorPhotoUri", "photoUri", "avatarUrl", "profilePhotoUri"]);
    const likedBy = Array.isArray(x.likedBy) ? x.likedBy.filter((v): v is string => typeof v === "string") : [];
    const favoritedBy = Array.isArray(x.favoritedBy)
      ? x.favoritedBy.filter((v): v is string => typeof v === "string")
      : [];
    const likedAtBy = (x.likedAtBy && typeof x.likedAtBy === "object" ? x.likedAtBy : {}) as Record<string, unknown>;
    const favoritedAtBy =
      (x.favoritedAtBy && typeof x.favoritedAtBy === "object" ? x.favoritedAtBy : {}) as Record<string, unknown>;
    const actorKeys = ownerKeys.map((x0) => x0.toLocaleLowerCase("tr-TR"));
    const actorLiked = likedBy.some((k) => actorKeys.includes((k || "").toLocaleLowerCase("tr-TR")));
    const actorFavorited = favoritedBy.some((k) => actorKeys.includes((k || "").toLocaleLowerCase("tr-TR")));
    const iLikedAtMs = actorKeys.reduce((acc, k) => Math.max(acc, toMsLoose(likedAtBy[k])), 0);
    const iFavoritedAtMs = actorKeys.reduce((acc, k) => Math.max(acc, toMsLoose(favoritedAtBy[k])), 0);
    rows.push({
      id: d.id,
      rawId: d.id,
      source: col,
      text,
      topic,
      createdAtMs,
      ...(updatedAtMs > 0 ? { updatedAtMs } : {}),
      authorUserId,
      authorUsername,
      ...(authorPhotoUri ? { authorPhotoUri } : {}),
      ...(pickString(x, ["parentId"]).trim() ? { parentId: pickString(x, ["parentId"]).trim() } : {}),
      ...(pickString(x, ["quoteOfId"]).trim() ? { quoteOfId: pickString(x, ["quoteOfId"]).trim() } : {}),
      ...(pickString(x, ["quoteOfText"]).trim() ? { quoteOfText: pickString(x, ["quoteOfText"]).trim() } : {}),
      ...(pickString(x, ["quoteOfUsername"]).trim()
        ? { quoteOfUsername: pickString(x, ["quoteOfUsername"]).trim() }
        : {}),
      likeCount: likedBy.length,
      favoriteCount: favoritedBy.length,
      replyCount: 0,
      iLiked: actorLiked,
      iFavorited: actorFavorited,
      ...(iLikedAtMs > 0 ? { iLikedAtMs } : {}),
      ...(iFavoritedAtMs > 0 ? { iFavoritedAtMs } : {}),
      likedByKeys: likedBy,
      favoritedByKeys: favoritedBy,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaKind ? { mediaKind } : {}),
    });
  }
  return rows;
}

/** Aynı yorum birden fazla koleksiyonda / yansıma ile gelince tek kart göster. */
function dedupeNearbyCommentFeedDuplicates(rows: CommentFeedItem[]): CommentFeedItem[] {
  const sorted = [...rows].sort((a, b) => b.createdAtMs - a.createdAtMs);
  const kept: CommentFeedItem[] = [];
  for (const r of sorted) {
    let dup = false;
    for (const k of kept) {
      if (r.authorUserId !== k.authorUserId) continue;
      if (r.text.trim() !== k.text.trim()) continue;
      if ((r.mediaUrl || "") !== (k.mediaUrl || "")) continue;
      if ((r.mediaKind || "") !== (k.mediaKind || "")) continue;
      const dt = Math.abs(r.createdAtMs - k.createdAtMs);
      const hasMedia = !!(r.mediaUrl || k.mediaUrl);
      if (!hasMedia && dt > 2200) continue;
      if (hasMedia && dt > 14_000) continue;
      dup = true;
      break;
    }
    if (!dup) kept.push(r);
  }
  return kept.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function subscribeCommentFeed(
  onItems: (items: CommentFeedItem[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const { ownerKeys, username: actorUsername } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  let byCol: Record<string, CommentFeedItem[]> = {};
  const snapGenByCol: Record<string, number> = Object.fromEntries(COMMENT_COLLECTIONS.map((k) => [k, 0]));
  const emit = () => {
    const rows = dedupeNearbyCommentFeedDuplicates(Object.values(byCol).flat());
    const replyCountMap = new Map<string, number>();
    for (const r of rows) {
      if (!r.parentId) continue;
      replyCountMap.set(r.parentId, (replyCountMap.get(r.parentId) || 0) + 1);
    }
    const sorted = rows
      .map((r) => ({ ...r, replyCount: replyCountMap.get(r.id) || 0 }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    onItems(sorted);
  };
  const unsubs = COMMENT_COLLECTIONS.map((col) =>
    onSnapshot(
      query(collection(db, col), orderBy("createdAt", "desc"), limit(800)),
      (snap) => {
        snapGenByCol[col] = (snapGenByCol[col] || 0) + 1;
        const tick = snapGenByCol[col];
        const rows = buildCommentFeedRowsFromSnapshot(col, snap.docs, ownerKeys, actorUsername);
        byCol[col] = rows;
        emit();
        void enrichCommentFeedAuthorFields(rows).then((enriched) => {
          if (snapGenByCol[col] !== tick) return;
          byCol[col] = enriched;
          emit();
        });
      },
      () => onError?.("Yorum akışı yüklenemedi."),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

/** Belirli forum konusu (#etiket) ile eşleşen yorumlar — `topic` alanı tam eşleşmeli. */
export async function subscribeCommentsForTopic(
  topic: string,
  onItems: (items: CommentFeedItem[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const t = (topic || "").trim();
  if (!t) {
    onItems([]);
    return () => {};
  }
  const { ownerKeys, username: actorUsername } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  let byCol: Record<string, CommentFeedItem[]> = {};
  const snapGenByCol: Record<string, number> = Object.fromEntries(COMMENT_COLLECTIONS.map((k) => [k, 0]));
  const emit = () => {
    const rows = dedupeNearbyCommentFeedDuplicates(Object.values(byCol).flat()).filter((r) => r.topic === t);
    const replyCountMap = new Map<string, number>();
    for (const r of rows) {
      if (!r.parentId) continue;
      replyCountMap.set(r.parentId, (replyCountMap.get(r.parentId) || 0) + 1);
    }
    const sorted = rows
      .map((r) => ({ ...r, replyCount: replyCountMap.get(r.id) || 0 }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    onItems(sorted);
  };
  /* orderBy+topic bileşik indeks gerektirir; sadece topic + limit, sıralamayı istemcide yapıyoruz. */
  const unsubs = COMMENT_COLLECTIONS.map((col) =>
    onSnapshot(
      query(collection(db, col), where("topic", "==", t), limit(400)),
      (snap) => {
        snapGenByCol[col] = (snapGenByCol[col] || 0) + 1;
        const tick = snapGenByCol[col];
        const rows = buildCommentFeedRowsFromSnapshot(col, snap.docs, ownerKeys, actorUsername, t);
        byCol[col] = rows;
        emit();
        void enrichCommentFeedAuthorFields(rows).then((enriched) => {
          if (snapGenByCol[col] !== tick) return;
          byCol[col] = enriched;
          emit();
        });
      },
      () => onError?.("Konu yorumları yüklenemedi."),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

export async function subscribeCommentMentionNotifications(
  onItems: (items: CommentMentionNotification[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const { socialUserId } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  const q = query(
    collection(db, "socialNotifications"),
    where("toUserId", "==", socialUserId),
    where("type", "==", "comment_mention"),
    orderBy("createdAt", "desc"),
    limit(120),
  );
  const unsub = onSnapshot(
    q,
    (snap) => {
      const out: CommentMentionNotification[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          fromUsername: pickString(x, ["fromUsername"]) || "@kullanici",
          topic: pickString(x, ["topic"]) || "Genel",
          textPreview: pickString(x, ["textPreview"]) || "",
          createdAtMs: tsToMs(x.createdAt),
        };
      });
      onItems(out);
    },
    () => onError?.("Yorum bildirimleri yüklenemedi."),
  );
  return unsub;
}

export async function subscribeCommentUserNotifications(
  onItems: (items: CommentUserNotification[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const { socialUserId } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  const q = query(
    collection(db, "socialNotifications"),
    where("toUserId", "==", socialUserId),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  const unsub = onSnapshot(
    q,
    (snap) => {
      const allowed = new Set([
        "comment_mention",
        "comment_like",
        "comment_favorite",
        "comment_reply",
        "follow_request",
        "follow_accepted",
      ]);
      const out: CommentUserNotification[] = [];
      for (const d of snap.docs) {
        const x = d.data() as Record<string, unknown>;
        const type = pickString(x, ["type"]);
        if (!type || !allowed.has(type)) continue;
        out.push({
          id: d.id,
          type: type as CommentUserNotification["type"],
          fromUsername: pickString(x, ["fromUsername"]) || "@kullanici",
          ...(pickString(x, ["topic"]) ? { topic: pickString(x, ["topic"]) } : {}),
          textPreview: pickString(x, ["textPreview"]) || "",
          createdAtMs: tsToMs(x.createdAt),
        });
      }
      onItems(out);
    },
    () => onError?.("Yorum bildirimleri yüklenemedi."),
  );
  return unsub;
}

/** Bildirimler listesinden tek kayıt sil (socialNotifications belgesi). */
export async function deleteSocialNotificationDoc(notificationId: string): Promise<void> {
  const id = (notificationId || "").trim();
  if (!id) throw new Error("Bildirim kimliği yok.");
  if (!isFirebaseConfigured()) return;
  await ensureFirestoreAuthReady();
  const db = getFirebaseFirestore();
  await deleteDoc(doc(db, "socialNotifications", id));
}

export async function toggleCommentLike(
  commentId: string,
  like: boolean,
  source: "comments" | "socialPosts" | "posts" | "messages" = "comments",
): Promise<void> {
  const { socialUserId, username } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  let targetUserId = "";
  let textPreview = "";
  try {
    const snap = await getDoc(doc(db, source, commentId));
    if (snap.exists()) {
      const x = snap.data() as Record<string, unknown>;
      targetUserId = pickString(x, ["userId", "uid", "ownerId", "fromUserId", "authorId"]);
      textPreview = pickString(x, ["text", "comment", "yorum", "content", "body"]);
    }
  } catch {
    /* ignore */
  }
  await updateDoc(doc(db, source, commentId), {
    likedBy: like ? arrayUnion(socialUserId) : arrayRemove(socialUserId),
    ...(like
      ? {
          [`likedAtBy.${socialUserId}`]: serverTimestamp(),
        }
      : {
          [`likedAtBy.${socialUserId}`]: deleteField(),
        }),
    updatedAt: serverTimestamp(),
  });
  if (like) {
    await sendCommentSocialNotification({
      type: "comment_like",
      toUserId: targetUserId,
      fromUserId: socialUserId,
      fromUsername: username || "@kullanici",
      commentId,
      textPreview,
    });
  }
}

export async function toggleCommentFavorite(
  commentId: string,
  favorite: boolean,
  source: "comments" | "socialPosts" | "posts" | "messages" = "comments",
): Promise<void> {
  const { socialUserId, username } = await resolveCommentActor();
  const db = getFirebaseFirestore();
  let targetUserId = "";
  let textPreview = "";
  try {
    const snap = await getDoc(doc(db, source, commentId));
    if (snap.exists()) {
      const x = snap.data() as Record<string, unknown>;
      targetUserId = pickString(x, ["userId", "uid", "ownerId", "fromUserId", "authorId"]);
      textPreview = pickString(x, ["text", "comment", "yorum", "content", "body"]);
    }
  } catch {
    /* ignore */
  }
  await updateDoc(doc(db, source, commentId), {
    favoritedBy: favorite ? arrayUnion(socialUserId) : arrayRemove(socialUserId),
    ...(favorite
      ? {
          [`favoritedAtBy.${socialUserId}`]: serverTimestamp(),
        }
      : {
          [`favoritedAtBy.${socialUserId}`]: deleteField(),
        }),
    updatedAt: serverTimestamp(),
  });
  if (favorite) {
    await sendCommentSocialNotification({
      type: "comment_favorite",
      toUserId: targetUserId,
      fromUserId: socialUserId,
      fromUsername: username || "@kullanici",
      commentId,
      textPreview,
    });
  }
}
