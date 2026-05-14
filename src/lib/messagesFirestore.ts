import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getSessionLoginEmail } from "./authSession";
import { ensureFirestoreAuthReady, getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, resolveFirestoreActorKey } from "./firebaseClient";
import { loadProfile } from "./profileStorage";
import { uploadLocalUriToStoragePath } from "./storageLocalUpload";

export type ConversationItem = {
  peerKey: string;
  peerUserId?: string;
  peerPhotoUri?: string;
  peerLabel: string;
  peerEmail: string;
  lastText: string;
  lastAtMs: number;
};

export type MessageAttachment = {
  kind: "image" | "video" | "audio";
  uri: string;
  durationMs?: number;
};

export type MessageItem = {
  id: string;
  text: string;
  fromUid: string;
  toUid: string;
  createdAtMs: number;
  attachment?: MessageAttachment;
};

export type IncomingMessageAlert = {
  peerUserId: string;
  peerLabel: string;
  peerPhotoUri?: string;
  unreadCount: number;
};

function tsToMs(ts: unknown): number {
  const x = ts as { toMillis?: () => number } | undefined;
  return typeof x?.toMillis === "function" ? x.toMillis() : 0;
}

function firestoreListenErrorMessage(fallback: string, err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  if (code === "permission-denied") {
    return "Firestore izin reddi: Firebase Console → Authentication → Anonymous’i açıp uygulamayı yeniden başlatın.";
  }
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message?: string }).message) : "";
  return msg?.trim() ? msg : fallback;
}

function cleanKey(v: string): string {
  return (v || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9._@-]/g, "_");
}

function normalizeUsername(v: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

function isLikelyEmail(v: string): boolean {
  const s = (v || "").trim();
  return !!s && !s.startsWith("@") && s.includes("@") && s.includes(".");
}

function threadDoc(uid: string, peerKey: string) {
  return doc(getFirebaseFirestore(), "chatByUid", uid, "threads", peerKey);
}

function threadMessages(uid: string, peerKey: string) {
  return collection(getFirebaseFirestore(), "chatByUid", uid, "threads", peerKey, "messages");
}

function guessExt(kind: MessageAttachment["kind"]): string {
  if (kind === "audio") return "m4a";
  if (kind === "video") return "mp4";
  return "jpg";
}

function fallbackAttachmentContentType(kind: MessageAttachment["kind"]): string {
  if (kind === "audio") return "audio/mp4";
  if (kind === "video") return "video/mp4";
  return "image/jpeg";
}

async function uploadAttachmentToStorage(att: MessageAttachment, actorKey: string): Promise<MessageAttachment> {
  const u = (att.uri || "").trim();
  if (!u) return att;
  if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return att;

  const st = getStorage(getFirebaseApp());
  const ext = guessExt(att.kind);
  const path = `messages/${actorKey}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const ct = fallbackAttachmentContentType(att.kind);

  try {
    const dl = await uploadLocalUriToStoragePath(st, path, u, ct);
    return { ...att, uri: dl };
  } catch {
    const ms = att.kind === "video" ? 120_000 : 90_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(u, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const rf = ref(st, path);
      await uploadBytes(rf, blob, { contentType: blob.type || ct });
      const dl = await getDownloadURL(rf);
      return { ...att, uri: dl };
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Medya Firebase’e yüklenemedi: ${msg}`);
    }
  }
}

async function resolveUserIdByProfileHint(input: { username?: string; email?: string }): Promise<string | null> {
  const db = getFirebaseFirestore();
  const pickUserId = (_docId: string, x: Record<string, unknown>): string => {
    if (typeof x.userId === "string" && x.userId) return x.userId;
    if (typeof x.uid === "string" && x.uid) return x.uid;
    if (typeof x.id === "string" && x.id) return x.id;
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
    const s1 = await getDocs(query(collection(db, "userProfiles"), where("username", "==", u), limit(1)));
    if (!s1.empty) {
      const uid = s1.docs[0]?.data()?.userId;
      if (typeof uid === "string" && uid) return uid;
    }
    const s1u = await getDocs(query(collection(db, "userProfiles"), where("kullaniciAdi", "==", u), limit(1)));
    if (!s1u.empty) {
      const doc = s1u.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s1n = await getDocs(query(collection(db, "userProfiles"), where("userName", "==", u), limit(1)));
    if (!s1n.empty) {
      const doc = s1n.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s1b = await getDocs(query(collection(db, "profiles"), where("username", "==", u), limit(1)));
    if (!s1b.empty) {
      const doc = s1b.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s1bk = await getDocs(query(collection(db, "profiles"), where("kullaniciAdi", "==", u), limit(1)));
    if (!s1bk.empty) {
      const doc = s1bk.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s1bn = await getDocs(query(collection(db, "profiles"), where("userName", "==", u), limit(1)));
    if (!s1bn.empty) {
      const doc = s1bn.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
  }
  const emailCandidates = Array.from(
    new Set([email, (input.email || "").trim(), (input.email || "").trim().toLocaleLowerCase("tr-TR")].filter(Boolean)),
  );
  for (const m of emailCandidates) {
    const s2 = await getDocs(query(collection(db, "userProfiles"), where("email", "==", m), limit(1)));
    if (!s2.empty) {
      const uid = s2.docs[0]?.data()?.userId;
      if (typeof uid === "string" && uid) return uid;
    }
    const s2m = await getDocs(query(collection(db, "userProfiles"), where("mail", "==", m), limit(1)));
    if (!s2m.empty) {
      const doc = s2m.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s2b = await getDocs(query(collection(db, "profiles"), where("email", "==", m), limit(1)));
    if (!s2b.empty) {
      const doc = s2b.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
    const s2bm = await getDocs(query(collection(db, "profiles"), where("mail", "==", m), limit(1)));
    if (!s2bm.empty) {
      const doc = s2bm.docs[0]!;
      const uid = pickUserId(doc.id, doc.data() as Record<string, unknown>);
      if (uid) return uid;
    }
  }

  // Son çare: küçük/büyük harf ve @ farklarını lokal karşılaştırmak için tarama.
  if (username || email) {
    const all = await getDocs(query(collection(db, "userProfiles"), limit(2000)));
    const targetUser = username.toLocaleLowerCase("tr-TR").replace(/^@/, "");
    const targetMail = email.toLocaleLowerCase("tr-TR");
    for (const d of all.docs) {
      const x = d.data() as Record<string, unknown>;
      const uid = pickUserId(d.id, x);
      const uRaw =
        (typeof x.username === "string" && x.username) ||
        (typeof x.kullaniciAdi === "string" && x.kullaniciAdi) ||
        (typeof x.userName === "string" && x.userName) ||
        "";
      const u = uRaw.toLocaleLowerCase("tr-TR").replace(/^@/, "");
      const mRaw =
        (typeof x.email === "string" && x.email) ||
        (typeof x.mail === "string" && x.mail) ||
        "";
      const m = mRaw.toLocaleLowerCase("tr-TR");
      if (uid && ((targetUser && u === targetUser) || (targetMail && m === targetMail))) return uid;
    }
    const allProfiles = await getDocs(query(collection(db, "profiles"), limit(2000)));
    for (const d of allProfiles.docs) {
      const x = d.data() as Record<string, unknown>;
      const uid = pickUserId(d.id, x);
      const uRaw =
        (typeof x.username === "string" && x.username) ||
        (typeof x.kullaniciAdi === "string" && x.kullaniciAdi) ||
        (typeof x.userName === "string" && x.userName) ||
        "";
      const u = uRaw.toLocaleLowerCase("tr-TR").replace(/^@/, "");
      const mRaw =
        (typeof x.email === "string" && x.email) ||
        (typeof x.mail === "string" && x.mail) ||
        "";
      const m = mRaw.toLocaleLowerCase("tr-TR");
      if (uid && ((targetUser && u === targetUser) || (targetMail && m === targetMail))) return uid;
    }
  }
  return null;
}

async function resolveCurrentWebUserId(actorKey: string): Promise<string> {
  const p = await loadProfile();
  return (
    (await resolveUserIdByProfileHint({
      username: p.kullaniciAdi,
      email: p.email,
    })) || actorKey
  );
}

/** Sohbette `/messages/` satırları `fromUserId` / `toUserId` olarak profil kullanıcı kimliği taşır; `peerKey` çoğu zaman thread doküman id’sidir (temizlenmiş kullanıcı adı/e‑posta). */
async function resolveConversationWebPeerFirebaseId(input: {
  actorUid: string;
  threadKeyCleaned: string;
  rawPeerKey: string;
  hintUserId?: string;
}): Promise<string> {
  const hint = (input.hintUserId || "").trim();
  if (hint) return hint;
  try {
    const snap = await getDoc(threadDoc(input.actorUid, input.threadKeyCleaned));
    const x = snap.data() as Record<string, unknown> | undefined;
    const pu = typeof x?.peerUserId === "string" ? x.peerUserId.trim() : "";
    if (pu) return pu;
    const pl = typeof x?.peerLabel === "string" ? x.peerLabel.trim() : "";
    const pe = typeof x?.peerEmail === "string" ? x.peerEmail.trim() : "";
    if (pl || pe) {
      const resolved = await resolveUserIdByProfileHint({
        username: pl && !isLikelyEmail(pl) ? normalizeUsername(pl) : "",
        email: pe || (isLikelyEmail(pl) ? pl : ""),
      });
      if (resolved) return resolved;
    }
  } catch {
    /* ignore */
  }
  const raw = (input.rawPeerKey || "").trim();
  if (raw.length >= 20 && /^[a-zA-Z0-9]+$/.test(raw)) return raw;
  if (isLikelyEmail(raw)) {
    const r = await resolveUserIdByProfileHint({ email: raw });
    if (r) return r;
  } else {
    const r = await resolveUserIdByProfileHint({ username: normalizeUsername(raw || ""), email: "" });
    if (r) return r;
  }
  return raw;
}

async function resolvePeerProfile(peerUserId: string): Promise<{ label: string; email: string; photoUri: string }> {
  const id = (peerUserId || "").trim();

  const pickNestedPhoto = (obj: unknown): string => {
    const seen = new Set<unknown>();
    const walk = (x: unknown): string => {
      if (!x || typeof x !== "object") return "";
      if (seen.has(x)) return "";
      seen.add(x);
      const rec = x as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        const key = k.toLocaleLowerCase("tr-TR");
        if (typeof v === "string" && v.trim()) {
          if (
            key.includes("photo") ||
            key.includes("avatar") ||
            key.includes("image") ||
            key.includes("resim") ||
            key.includes("foto")
          ) {
            return v.trim();
          }
        } else if (v && typeof v === "object") {
          const nested = walk(v);
          if (nested) return nested;
        }
      }
      return "";
    };
    return walk(obj);
  };
  const pickString = (obj: Record<string, unknown>, keys: string[]): string => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const ensurePublicPhotoUrl = async (uri: string): Promise<string> => {
    const raw = (uri || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    try {
      const st = getStorage(getFirebaseApp());
      return await getDownloadURL(ref(st, raw.replace(/^\/+/, "")));
    } catch {
      return raw;
    }
  };
  const byConventionStoragePath = async (): Promise<string> => {
    const st = getStorage(getFirebaseApp());
    const candidates = [
      `profiles/${id}/photo.jpg`,
      `profiles/${id}/profile.jpg`,
      `profiles/${id}/avatar.jpg`,
      `profiles/${id}/photo.png`,
      `profiles/${id}/profile.png`,
      `profiles/${id}/avatar.png`,
    ];
    for (const p of candidates) {
      try {
        return await getDownloadURL(ref(st, p));
      } catch {
        // continue
      }
    }
    return "";
  };

  const merged = { username: "", email: "", photoFlat: "" };

  const mergeFromDoc = (d: Record<string, unknown>) => {
    const uRaw = pickString(d, ["username", "kullaniciAdi", "userName", "handle"]);
    if (uRaw && !merged.username) merged.username = normalizeUsername(uRaw);
    const em = pickString(d, ["email", "mail"]);
    if (em && !merged.email) merged.email = em;
    if (!merged.photoFlat) {
      const photoFlat = pickString(d, [
        "photoUri",
        "photoURL",
        "profilePhotoUrl",
        "profilePhotoURL",
        "profileImageUrl",
        "profileImageURL",
        "profileImage",
        "avatarUrl",
        "avatarURL",
        "avatar",
        "imageUrl",
        "imageURL",
        "profileImagePath",
        "profilePhotoPath",
        "avatarPath",
      ]);
      merged.photoFlat = photoFlat || pickNestedPhoto(d);
    }
  };

  try {
    const db = getFirebaseFirestore();
    const docPayloads: Array<Record<string, unknown> | null> = await Promise.all([
      getDocs(query(collection(db, "userProfiles"), where("userId", "==", id), limit(1))).then((s) =>
        s.empty ? null : (s.docs[0]!.data() as Record<string, unknown>),
      ),
      getDocs(query(collection(db, "userProfiles"), where("uid", "==", id), limit(1)))
        .then((s) => (s.empty ? null : (s.docs[0]!.data() as Record<string, unknown>)))
        .catch(() => null),
      getDocs(query(collection(db, "profiles"), where("userId", "==", id), limit(1)))
        .then((s) => (s.empty ? null : (s.docs[0]!.data() as Record<string, unknown>)))
        .catch(() => null),
      getDocs(query(collection(db, "profiles"), where("uid", "==", id), limit(1)))
        .then((s) => (s.empty ? null : (s.docs[0]!.data() as Record<string, unknown>)))
        .catch(() => null),
      getDoc(doc(db, "userProfiles", id)).then((s) => (s.exists() ? (s.data() as Record<string, unknown>) : null)),
      getDoc(doc(db, "profiles", id)).then((s) => (s.exists() ? (s.data() as Record<string, unknown>) : null)),
      getDoc(doc(db, "profilesByUid", id)).then((s) => (s.exists() ? (s.data() as Record<string, unknown>) : null)),
    ]);

    for (const row of docPayloads) {
      if (row) mergeFromDoc(row);
    }

    const photoUri = merged.photoFlat ? await ensurePublicPhotoUrl(merged.photoFlat) : "";
    /** Sohbet başlığı için ad-soyad yerine web kullanıcı adı (@handle). */
    const label = merged.username || merged.email || id;

    if (merged.username || merged.email || photoUri) {
      return { label, email: merged.email, photoUri };
    }

    const byConvention = await byConventionStoragePath();
    if (byConvention) return { label, email: merged.email, photoUri: byConvention };
  } catch {
    /* ignore */
  }
  return { label: id, email: "", photoUri: "" };
}

export function canUseMessagesFirestore(): boolean {
  return isFirebaseConfigured();
}

export async function subscribeConversations(
  onItems: (items: ConversationItem[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const actor = await resolveFirestoreActorKey();
  const db = getFirebaseFirestore();
  const webUid = await resolveCurrentWebUserId(actor);
  const chatCol = collection(db, "chatByUid", actor, "threads");
  const qChat = query(chatCol, orderBy("lastAt", "desc"), limit(120));
  // Web koleksiyonunda yalnızca gelen mesajları dinliyoruz (kendi gönderdiklerimiz chatByUid'de zaten var).
  const qTo = query(collection(db, "messages"), where("toUserId", "==", webUid), limit(400));

  let chatItems: ConversationItem[] = [];
  let webItems: ConversationItem[] = [];

  const emit = () => {
    const m = new Map<string, ConversationItem>();
    for (const it of [...chatItems, ...webItems]) {
      const mergeKey = (it.peerUserId || it.peerKey || "").trim();
      const prev = m.get(mergeKey);
      if (!prev) {
        m.set(mergeKey, it);
        continue;
      }
      if (it.lastAtMs > prev.lastAtMs) {
        // Daha yeni kayıt web koleksiyonundan gelip peerKey'i userId'ye çevirmiş olabilir.
        // Bu durumda varsa eski thread anahtarını koru; sohbet içine girince mesajlar boş görünmesin.
        const keepPrevThreadKey =
          !!prev.peerKey &&
          prev.peerKey !== mergeKey &&
          (!it.peerKey || it.peerKey === mergeKey);
        m.set(mergeKey, keepPrevThreadKey ? { ...it, peerKey: prev.peerKey } : it);
      } else {
        const needThreadKey = (!prev.peerKey || prev.peerKey === mergeKey) && it.peerKey && it.peerKey !== mergeKey;
        if (needThreadKey) {
          m.set(mergeKey, { ...prev, peerKey: it.peerKey });
        }
      }
    }
    onItems(Array.from(m.values()).sort((a, b) => b.lastAtMs - a.lastAtMs));
  };

  const unsubChat = onSnapshot(
    qChat,
    (snap) => {
      const base = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          peerKey: d.id,
          ...(typeof x.peerUserId === "string" && x.peerUserId ? { peerUserId: x.peerUserId } : {}),
          ...(typeof x.peerPhotoUri === "string" && x.peerPhotoUri ? { peerPhotoUri: x.peerPhotoUri } : {}),
          peerLabel: typeof x.peerLabel === "string" ? x.peerLabel : "",
          peerEmail: typeof x.peerEmail === "string" ? x.peerEmail : "",
          lastText: typeof x.lastText === "string" ? x.lastText : "",
          lastAtMs: tsToMs(x.lastAt),
        } satisfies ConversationItem;
      });
      /* Profil çözümü ağda gecikirse bile liste anında gelsin (UI “yükleniyor”da takılmasın). */
      chatItems = base;
      emit();

      void (async () => {
        const enriched = await Promise.all(
          base.map(async (it) => {
            const needLabel = !it.peerLabel || isLikelyEmail(it.peerLabel) || !it.peerLabel.startsWith("@");
            const needPhoto = !it.peerPhotoUri;
            if (!needLabel && !needPhoto) return it;
            const resolvedPeerUserId =
              it.peerUserId ||
              (await resolveUserIdByProfileHint({
                username: it.peerLabel,
                email: it.peerEmail,
              })) ||
              "";
            if (!resolvedPeerUserId) return it;
            const p = await resolvePeerProfile(resolvedPeerUserId);
            return {
              ...it,
              ...(it.peerUserId ? {} : { peerUserId: resolvedPeerUserId }),
              ...(needLabel && p.label ? { peerLabel: p.label } : {}),
              ...(needPhoto && p.photoUri ? { peerPhotoUri: p.photoUri } : {}),
            };
          }),
        );
        chatItems = enriched;
        emit();
      })();
    },
    () => {
      if (onError) onError("Mesajlar yüklenemedi.");
    },
  );

  const rebuildWebItems = async (toDocs: Array<Record<string, unknown>>) => {
    const all = [...toDocs];
    const byPeer = new Map<string, { at: number; text: string }>();
    for (const x of all) {
      const f = typeof x.fromUserId === "string" ? x.fromUserId : "";
      const t = typeof x.toUserId === "string" ? x.toUserId : "";
      const peer = t === webUid ? f : "";
      if (!peer) continue;
      const at = tsToMs(x.createdAt);
      const text = typeof x.text === "string" ? x.text : "";
      const prev = byPeer.get(peer);
      if (!prev || at > prev.at) byPeer.set(peer, { at, text });
    }

    const minimal: ConversationItem[] = [];
    for (const [peer, meta] of byPeer.entries()) {
      minimal.push({
        peerKey: peer,
        peerUserId: peer,
        peerLabel: peer,
        peerEmail: "",
        lastText: meta.text,
        lastAtMs: meta.at,
      });
    }
    webItems = minimal;
    emit();

    const out: ConversationItem[] = [];
    for (const [peer, meta] of byPeer.entries()) {
      const p = await resolvePeerProfile(peer);
      out.push({
        peerKey: peer,
        peerUserId: peer,
        ...(p.photoUri ? { peerPhotoUri: p.photoUri } : {}),
        peerLabel: p.label || peer,
        peerEmail: p.email,
        lastText: meta.text,
        lastAtMs: meta.at,
      });
    }
    webItems = out;
    emit();
  };

  let toRows: Array<Record<string, unknown>> = [];

  const unsubTo = onSnapshot(
    qTo,
    (snap) => {
      toRows = snap.docs.map((d) => d.data() as Record<string, unknown>);
      void rebuildWebItems(toRows);
    },
    () => {
      if (onError) onError("Web mesajları yüklenemedi.");
    },
  );

  return () => {
    unsubChat();
    unsubTo();
  };
}

export async function subscribeConversationMessages(
  peerKey: string,
  onItems: (items: MessageItem[]) => void,
  onError?: (errorText: string) => void,
  webPeerUserIdHint?: string,
): Promise<Unsubscribe> {
  const uid = await resolveFirestoreActorKey();
  const webUid = await resolveCurrentWebUserId(uid);
  const k = cleanKey(peerKey);
  if (!k) throw new Error("Geçersiz konuşma");
  const peerFirebaseId = await resolveConversationWebPeerFirebaseId({
    actorUid: uid,
    threadKeyCleaned: k,
    rawPeerKey: peerKey,
    hintUserId: webPeerUserIdHint,
  });
  const q = query(threadMessages(uid, k), orderBy("createdAt", "asc"), limit(300));
  const db = getFirebaseFirestore();
  const qWebTo =
    peerFirebaseId.trim().length > 0
      ? query(
          collection(db, "messages"),
          where("fromUserId", "==", peerFirebaseId.trim()),
          where("toUserId", "==", webUid),
          limit(300),
        )
      : null;
  const qWebFrom =
    peerFirebaseId.trim().length > 0
      ? query(
          collection(db, "messages"),
          where("fromUserId", "==", webUid),
          where("toUserId", "==", peerFirebaseId.trim()),
          limit(300),
        )
      : null;

  let chatRows: MessageItem[] = [];
  let webToRows: MessageItem[] = [];
  let webFromRows: MessageItem[] = [];
  /** Mobil thread ile web `/messages/` aynı gönderiyi iki kez yazar; listeyi tekilleştirir. */
  const dedupeThreadAndWebEchoes = (rows: MessageItem[]): MessageItem[] => {
    const sorted = [...rows].sort((a, b) => a.createdAtMs - b.createdAtMs);
    const out: MessageItem[] = [];
    for (const m of sorted) {
      let skip = false;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const prev = out[i]!;
        if (m.createdAtMs - prev.createdAtMs > 12_000) break;
        const t1 = (m.text || "").trim();
        const t2 = (prev.text || "").trim();
        const u1 = (m.attachment?.uri || "").trim();
        const u2 = (prev.attachment?.uri || "").trim();
        const k1 = m.attachment?.kind || "";
        const k2 = prev.attachment?.kind || "";
        const hasMed = !!(u1 || u2);
        /** Aynı dosya thread + web’de; web ses satırında placeholder metin olabilir (🎤 Sesli mesaj). */
        const sameMediaFingerprint = !!u1 && u1 === u2 && !!k1 && k1 === k2;
        if (t1 !== t2 && !sameMediaFingerprint) continue;
        let samePayload = false;
        if (hasMed) {
          samePayload = u1 === u2 && u1.length > 0 && (k1 === k2 || !k1 || !k2);
        } else {
          samePayload = Math.abs(m.createdAtMs - prev.createdAtMs) <= 1800;
        }
        if (!samePayload) continue;

        const mChat = m.id.startsWith("chat_");
        const pChat = prev.id.startsWith("chat_");
        if (mChat !== pChat) {
          if (mChat && !pChat) out[i] = m;
          skip = true;
          break;
        }
        skip = true;
        break;
      }
      if (!skip) out.push(m);
    }
    return out.sort((a, b) => a.createdAtMs - b.createdAtMs);
  };

  const emit = () => {
    const mergedWeb = [...webToRows, ...webFromRows];
    const byId = new Map<string, MessageItem>();
    for (const r of mergedWeb) byId.set(r.id, r);
    const mergedWebRows = Array.from(byId.values());
    const out = dedupeThreadAndWebEchoes([...chatRows, ...mergedWebRows]).sort((a, b) => a.createdAtMs - b.createdAtMs);
    onItems(out);
  };

  const mapChatDoc = (d: { id: string; data: () => Record<string, unknown> }): MessageItem => {
    const x = d.data();
    const attachmentRaw = x.attachment as Record<string, unknown> | undefined;
    const kind = attachmentRaw?.kind;
    const uri = attachmentRaw?.uri;
    const durationMsRaw = attachmentRaw?.durationMs;
    const durationMs = typeof durationMsRaw === "number" && Number.isFinite(durationMsRaw) ? durationMsRaw : undefined;
    const attachment =
      (kind === "image" || kind === "video" || kind === "audio") && typeof uri === "string" && uri
        ? ({ kind, uri, ...(durationMs !== undefined ? { durationMs } : {}) } as MessageAttachment)
        : undefined;
    return {
      id: `chat_${d.id}`,
      text: typeof x.text === "string" ? x.text : "",
      fromUid: typeof x.fromUid === "string" ? x.fromUid : "",
      toUid: typeof x.toUid === "string" ? x.toUid : "",
      createdAtMs: tsToMs(x.createdAt),
      ...(attachment ? { attachment } : {}),
    };
  };

  const mapWebDoc = (d: { id: string; data: () => Record<string, unknown> }): MessageItem => {
    const x = d.data();
    let attachment: MessageAttachment | undefined;
    if (typeof x.imageUrl === "string" && x.imageUrl) attachment = { kind: "image", uri: x.imageUrl };
    else if (typeof x.audioUrl === "string" && x.audioUrl) attachment = { kind: "audio", uri: x.audioUrl };
    else if (typeof x.videoUrl === "string" && x.videoUrl) attachment = { kind: "video", uri: x.videoUrl };
    return {
      id: `web_${d.id}`,
      text: typeof x.text === "string" ? x.text : "",
      fromUid: typeof x.fromUserId === "string" ? x.fromUserId : "",
      toUid: typeof x.toUserId === "string" ? x.toUserId : "",
      createdAtMs: tsToMs(x.createdAt),
      ...(attachment ? { attachment } : {}),
    };
  };

  const unsubChat = onSnapshot(
    q,
    (snap) => {
      chatRows = snap.docs.map(mapChatDoc);
      emit();
    },
    (err) => {
      if (onError) onError(firestoreListenErrorMessage("Sohbet yüklenemedi.", err));
    },
  );
  const rebuildWeb = () => {
    emit();
  };

  const emptyUnsub = () => {};
  const unsubWebTo = qWebTo
    ? onSnapshot(
        qWebTo,
        (snap) => {
          webToRows = snap.docs.map(mapWebDoc);
          rebuildWeb();
        },
        (err) => {
          if (onError) onError(firestoreListenErrorMessage("Web sohbeti yüklenemedi.", err));
        },
      )
    : emptyUnsub;
  const unsubWebFrom = qWebFrom
    ? onSnapshot(
        qWebFrom,
        (snap) => {
          webFromRows = snap.docs.map(mapWebDoc);
          rebuildWeb();
        },
        (err) => {
          if (onError) onError(firestoreListenErrorMessage("Web sohbeti yüklenemedi.", err));
        },
      )
    : emptyUnsub;

  return () => {
    unsubChat();
    unsubWebTo();
    unsubWebFrom();
  };
}

export async function getMyUid(): Promise<string> {
  return resolveFirestoreActorKey();
}

/** `/messages/` satırları ve web profil eşlemesi bu kimlikle yapılır (anon Firebase uid’den farklı olabilir). */
export async function resolveMyWebMessagingUserId(): Promise<string> {
  const actor = await resolveFirestoreActorKey();
  return resolveCurrentWebUserId(actor);
}

export async function subscribeIncomingMessageAlerts(
  onItems: (items: IncomingMessageAlert[]) => void,
  onError?: (errorText: string) => void,
): Promise<Unsubscribe> {
  const actor = await resolveFirestoreActorKey();
  const db = getFirebaseFirestore();
  const webUid = await resolveCurrentWebUserId(actor);
  const q = query(collection(db, "messages"), where("toUserId", "==", webUid), where("read", "==", false), limit(500));
  const unsub = onSnapshot(
    q,
    (snap) => {
      void (async () => {
        const counts = new Map<string, number>();
        let newestAtByPeer = new Map<string, number>();
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const from = typeof x.fromUserId === "string" ? x.fromUserId : "";
          if (!from) continue;
          counts.set(from, (counts.get(from) || 0) + 1);
          const at = tsToMs(x.createdAt);
          newestAtByPeer.set(from, Math.max(newestAtByPeer.get(from) || 0, at));
        }
        const out: Array<IncomingMessageAlert & { _at: number }> = [];
        for (const [peerUserId, unreadCount] of counts.entries()) {
          const p = await resolvePeerProfile(peerUserId);
          out.push({
            peerUserId,
            peerLabel: p.label,
            ...(p.photoUri ? { peerPhotoUri: p.photoUri } : {}),
            unreadCount,
            _at: newestAtByPeer.get(peerUserId) || 0,
          });
        }
        out.sort((a, b) => b._at - a._at);
        onItems(out.map(({ _at, ...rest }) => rest));
      })();
    },
    () => {
      if (onError) onError("Bildirimler yüklenemedi.");
    },
  );
  return unsub;
}

export async function markConversationRead(peerUserId: string): Promise<void> {
  const actor = await resolveFirestoreActorKey();
  const db = getFirebaseFirestore();
  const webUid = await resolveCurrentWebUserId(actor);
  const peer = (peerUserId || "").trim();
  if (!peer || !webUid) return;
  for (;;) {
    const snap = await getDocs(
      query(
        collection(db, "messages"),
        where("fromUserId", "==", peer),
        where("toUserId", "==", webUid),
        where("read", "==", false),
        limit(250),
      ),
    );
    if (snap.empty) break;
    const b = writeBatch(db);
    snap.docs.forEach((d) => b.update(d.ref, { read: true, readAt: serverTimestamp() }));
    await b.commit();
    if (snap.size < 250) break;
  }
}

export async function sendMessageToPeer(input: {
  peerKey?: string;
  peerLabel: string;
  peerEmail?: string;
  /** Açık sohbetten bilinen web kullanıcı id’si; alıcı sorgusu atlanır. */
  recipientWebUserId?: string;
  /** Açık hesaptaki web mesaj kullanıcı id’si; gönderen sorgusu atlanır. */
  senderWebUserId?: string;
  text?: string;
  attachment?: MessageAttachment;
}): Promise<string> {
  await ensureFirestoreAuthReady();
  const cleaned = (input.text || "").trim();
  const uid = await resolveFirestoreActorKey();

  const rawPeerLabel = (input.peerLabel || "").trim();
  const peerLabel = rawPeerLabel && !isLikelyEmail(rawPeerLabel) ? normalizeUsername(rawPeerLabel) : "";
  const peerEmail = input.peerEmail?.trim() || "";
  const keyBase = input.peerKey || input.peerEmail || peerLabel;
  const peerKey = cleanKey(keyBase || "");
  if (!peerKey) throw new Error("Kullanıcı alanı boş.");

  const hintedRecipient = (input.recipientWebUserId || "").trim();
  const recipientUserId = hintedRecipient
    ? hintedRecipient
    : (await resolveUserIdByProfileHint({
        username: peerLabel,
        email: peerEmail,
      }));
  if (!recipientUserId) {
    throw new Error(`Alıcı bulunamadı (${peerLabel || peerEmail}). Kullanıcı adı/e-mail web profilinde farklı olabilir.`);
  }

  const hintedSender = (input.senderWebUserId || "").trim();
  let senderUserId = hintedSender;
  if (!senderUserId) {
    const myProfile = await loadProfile();
    const effectiveEmail = ((myProfile.email || "").trim() || (await getSessionLoginEmail()).trim()).toLocaleLowerCase("tr-TR");
    senderUserId =
      (await resolveUserIdByProfileHint({
        username: myProfile.kullaniciAdi,
        email: effectiveEmail,
      })) || uid;
  }

  const db = getFirebaseFirestore();
  const [iBlockedPeer, peerBlockedMe] = await Promise.all([
    getDoc(doc(db, "socialBlocks", senderUserId, "blocked", recipientUserId)).catch(() => null),
    getDoc(doc(db, "socialBlocks", recipientUserId, "blocked", senderUserId)).catch(() => null),
  ]);
  if (iBlockedPeer?.exists() || peerBlockedMe?.exists()) {
    throw new Error("Bu kullanıcı ile mesajlaşma engellenmiş.");
  }

  const attachmentUploaded = input.attachment ? await uploadAttachmentToStorage(input.attachment, uid) : undefined;
  const hasAttachment = Boolean(attachmentUploaded?.uri);
  if (!cleaned && !hasAttachment) return "";

  const lastText =
    cleaned ||
    (attachmentUploaded?.kind === "video"
      ? "[Video]"
      : attachmentUploaded?.kind === "audio"
        ? "[Ses Kaydı]"
        : "[Fotoğraf]");

  const threadPeerLabelNow = peerLabel || rawPeerLabel || recipientUserId;

  void (async () => {
    try {
      const p = await resolvePeerProfile(recipientUserId);
      if (!p.label && !p.photoUri && !(p.email && !peerEmail.trim())) return;
      await setDoc(
        threadDoc(uid, peerKey),
        {
          ...(p.photoUri ? { peerPhotoUri: p.photoUri } : {}),
          ...(p.label ? { peerLabel: p.label } : {}),
          ...(p.email && !peerEmail.trim() ? { peerEmail: p.email } : {}),
        },
        { merge: true },
      );
    } catch {
      /* ignore — ana gönderimi etkileme */
    }
  })();

  const chatMsgPayload = {
    text: cleaned,
    fromUid: uid,
    toUid: peerKey,
    createdAt: serverTimestamp(),
    ...(hasAttachment ? { attachment: attachmentUploaded } : {}),
  };
  const webMsgPayload: Record<string, unknown> = {
    fromUserId: senderUserId,
    toUserId: recipientUserId,
    text: cleaned || (attachmentUploaded?.kind === "audio" ? "🎤 Sesli mesaj" : ""),
    createdAt: serverTimestamp(),
    read: false,
  };
  if (attachmentUploaded?.kind === "image") webMsgPayload.imageUrl = attachmentUploaded.uri;
  if (attachmentUploaded?.kind === "audio") webMsgPayload.audioUrl = attachmentUploaded.uri;
  if (attachmentUploaded?.kind === "video") webMsgPayload.videoUrl = attachmentUploaded.uri;

  await Promise.all([
    setDoc(
      threadDoc(uid, peerKey),
      {
        peerUserId: recipientUserId,
        peerLabel: threadPeerLabelNow,
        peerEmail,
        lastText,
        lastAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      },
      { merge: true },
    ),
    addDoc(threadMessages(uid, peerKey), chatMsgPayload),
    addDoc(collection(db, "messages"), webMsgPayload),
  ]);

  return peerKey;
}

export function normalizeUsernameInput(v: string): string {
  return normalizeUsername(v);
}

export async function deleteConversation(peer: ConversationItem): Promise<void> {
  const actor = await resolveFirestoreActorKey();
  const db = getFirebaseFirestore();
  const webUid = await resolveCurrentWebUserId(actor);
  const peerUserId = (peer.peerUserId || peer.peerKey || "").trim();
  const threadKeys = new Set<string>();
  const addKey = (v: string) => {
    const raw = (v || "").trim();
    if (!raw) return;
    threadKeys.add(raw);
    const cleaned = cleanKey(raw);
    if (cleaned) threadKeys.add(cleaned);
  };
  addKey(peer.peerKey || "");
  addKey(peerUserId);
  addKey(peer.peerEmail || "");

  const deleteQueryInBatches = async (makeQuery: () => ReturnType<typeof query>) => {
    // 600'lük partiler halinde tamamen tüket.
    for (;;) {
      const snap = await getDocs(makeQuery());
      if (snap.empty) break;
      const b = writeBatch(db);
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      if (snap.size < 600) break;
    }
  };

  const deleteThreadByKey = async (k: string) => {
    if (!k) return;
    await deleteQueryInBatches(() => query(threadMessages(actor, k), limit(600)));
    await deleteDoc(threadDoc(actor, k)).catch(() => {
      /* ignore */
    });
  };

  // Bilinen anahtarları sil.
  for (const k of threadKeys) {
    await deleteThreadByKey(k);
  }

  // Yanlış/eski anahtarla açılmış thread'leri de userId/e-mail eşleşmesi ile temizle.
  const threadsSnap = await getDocs(query(collection(db, "chatByUid", actor, "threads"), limit(600)));
  for (const d of threadsSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    const docPeerUserId = typeof x.peerUserId === "string" ? x.peerUserId.trim() : "";
    const docPeerEmail = typeof x.peerEmail === "string" ? x.peerEmail.trim().toLocaleLowerCase("tr-TR") : "";
    const targetEmail = (peer.peerEmail || "").trim().toLocaleLowerCase("tr-TR");
    const isSame =
      (peerUserId && docPeerUserId && docPeerUserId === peerUserId) ||
      (targetEmail && docPeerEmail && docPeerEmail === targetEmail);
    if (isSame) {
      await deleteThreadByKey(d.id);
    }
  }

  if (webUid && peerUserId) {
    await deleteQueryInBatches(() =>
      query(collection(db, "messages"), where("fromUserId", "==", webUid), where("toUserId", "==", peerUserId), limit(600)),
    );
    await deleteQueryInBatches(() =>
      query(collection(db, "messages"), where("fromUserId", "==", peerUserId), where("toUserId", "==", webUid), limit(600)),
    );
  }
}
