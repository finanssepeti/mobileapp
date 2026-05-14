import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, resolveFirestoreActorKey } from "./firebaseClient";
import { loadProfile } from "./profileStorage";
import { enqueueSocialNotification } from "./socialNotificationOutbox";

export type KisiAraPerson = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  photoUri: string;
  bio: string;
  company: string;
  university: string;
  city: string;
};

export type FollowRequestItem = {
  requestId?: string;
  fromUserId: string;
  fromUsername: string;
  fromEmail: string;
  fromPhotoUri: string;
  createdAtMs: number;
};

export type ProfileSocialCounts = {
  following: number;
  followers: number;
  mutual: number;
};

export type BlockState = {
  iBlocked: Set<string>;
  blockedMe: Set<string>;
};

function normalizeUsername(v: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNestedPhoto(obj: Record<string, unknown>): string {
  const topCandidates = ["photo", "avatar", "image", "profilePhoto", "profileImage", "profile"];
  const nestedCandidates = ["url", "uri", "photoUrl", "photoURL", "imageUrl", "imageURL", "avatarUrl", "avatarURL", "path"];
  for (const key of topCandidates) {
    const v = obj[key];
    if (!v || typeof v !== "object") continue;
    const n = v as Record<string, unknown>;
    const direct = pickString(n, nestedCandidates);
    if (direct) return direct;
  }
  return "";
}

function includesAnyKey(raw: string, keys: string[]): boolean {
  const v = (raw || "").trim().toLocaleLowerCase("tr-TR");
  if (!v) return false;
  return keys.some((k) => v === (k || "").trim().toLocaleLowerCase("tr-TR"));
}

async function resolveSocialUserIdByHint(input: { username?: string; email?: string }): Promise<string | null> {
  const db = getFirebaseFirestore();
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
  const pickUserId = (docId: string, x: Record<string, unknown>) =>
    pickString(x, ["userId", "uid", "id"]) || (docId && !docId.includes("@") && !docId.includes(".") ? docId : "");

  const cols: Array<"userProfiles" | "profiles" | "profilesByUid"> = ["userProfiles", "profiles", "profilesByUid"];

  if (usernameCandidates.length) {
    type Snap = Awaited<ReturnType<typeof getDocs>> | null;
    const jobs: Promise<Snap>[] = [];
    for (const u of usernameCandidates) {
      for (const c of cols) {
        jobs.push(getDocs(query(collection(db, c), where("username", "==", u), limit(1))).catch(() => null));
        jobs.push(getDocs(query(collection(db, c), where("kullaniciAdi", "==", u), limit(1))).catch(() => null));
        jobs.push(getDocs(query(collection(db, c), where("userName", "==", u), limit(1))).catch(() => null));
      }
    }
    const snaps = await Promise.all(jobs);
    for (const snap of snaps) {
      if (snap && !snap.empty) {
        const d = snap.docs[0]!;
        const uid = pickUserId(d.id, d.data() as Record<string, unknown>);
        if (uid) return uid;
      }
    }
  }

  if (email) {
    type Snap = Awaited<ReturnType<typeof getDocs>> | null;
    const mailJobs: Promise<Snap>[] = [];
    for (const c of cols) {
      mailJobs.push(getDocs(query(collection(db, c), where("email", "==", email), limit(1))).catch(() => null));
      mailJobs.push(getDocs(query(collection(db, c), where("mail", "==", email), limit(1))).catch(() => null));
    }
    const snaps = await Promise.all(mailJobs);
    for (const snap of snaps) {
      if (snap && !snap.empty) {
        const d = snap.docs[0]!;
        const uid = pickUserId(d.id, d.data() as Record<string, unknown>);
        if (uid) return uid;
      }
    }
  }
  return null;
}

async function resolveCurrentSocialUserId(): Promise<string> {
  const actor = await resolveFirestoreActorKey();
  const me = await loadProfile();
  const resolved = await resolveSocialUserIdByHint({
    username: me.kullaniciAdi,
    email: me.email,
  });
  return resolved || actor;
}

async function resolveCurrentSocialReceiverKeys(): Promise<string[]> {
  const actor = await resolveFirestoreActorKey();
  const socialId = await resolveCurrentSocialUserId();
  const me = await loadProfile();
  const uname = normalizeUsername(me.kullaniciAdi || "");
  const unameBare = uname.startsWith("@") ? uname.slice(1) : uname;
  const email = (me.email || "").trim().toLocaleLowerCase("tr-TR");
  const keys = new Set([actor, socialId, uname, unameBare, email].map((x) => (x || "").trim()).filter(Boolean));
  const db = getFirebaseFirestore();
  const addFromDoc = (docId: string, x: Record<string, unknown>) => {
    [
      docId,
      pickString(x, ["userId", "uid", "id"]),
      normalizeUsername(pickString(x, ["username", "kullaniciAdi", "userName"])),
      pickString(x, ["username", "kullaniciAdi", "userName"]),
      pickString(x, ["email", "mail"]),
    ]
      .map((v) => (v || "").trim())
      .filter(Boolean)
      .forEach((v) => {
        keys.add(v);
        if (v.startsWith("@")) keys.add(v.slice(1));
        if (v.includes("@")) keys.add(v.toLocaleLowerCase("tr-TR"));
      });
  };
  for (const colName of ["userProfiles", "profiles", "profilesByUid"] as const) {
    const byEmail = email
      ? await getDocs(query(collection(db, colName), where("email", "==", email), limit(5))).catch(() => null)
      : null;
    if (byEmail) byEmail.docs.forEach((d) => addFromDoc(d.id, d.data() as Record<string, unknown>));
    for (const u of [uname, unameBare].filter(Boolean)) {
      const byU1 = await getDocs(query(collection(db, colName), where("username", "==", u), limit(5))).catch(() => null);
      const byU2 = await getDocs(query(collection(db, colName), where("kullaniciAdi", "==", u), limit(5))).catch(() => null);
      if (byU1) byU1.docs.forEach((d) => addFromDoc(d.id, d.data() as Record<string, unknown>));
      if (byU2) byU2.docs.forEach((d) => addFromDoc(d.id, d.data() as Record<string, unknown>));
    }
  }
  return Array.from(keys.values());
}

async function resolveCurrentActorKeysForFriendQueries(): Promise<string[]> {
  const keys = await resolveCurrentSocialReceiverKeys();
  return Array.from(new Set(keys.map((k) => (k || "").trim()).filter(Boolean)));
}

async function ensurePhotoUrl(raw: string): Promise<string> {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || /^data:/i.test(v)) return v;
  if (/^gs:\/\//i.test(v)) {
    const normalized = v.replace(/^gs:\/\/[^/]+\//i, "");
    if (!normalized) return "";
    try {
      const st = getStorage(getFirebaseApp());
      return await getDownloadURL(ref(st, normalized));
    } catch {
      return "";
    }
  }
  try {
    const st = getStorage(getFirebaseApp());
    return await getDownloadURL(ref(st, v.replace(/^\/+/, "")));
  } catch {
    return "";
  }
}

async function mapDocToPerson(docId: string, data: Record<string, unknown>): Promise<KisiAraPerson | null> {
  const username = normalizeUsername(pickString(data, ["username", "kullaniciAdi", "userName"]));
  const displayName = pickString(data, ["adSoyad", "displayName", "name", "fullName"]);
  const email = pickString(data, ["email", "mail"]);
  let userId =
    pickString(data, ["userId", "uid", "id"]) ||
    (docId && !docId.includes("@") && !docId.includes(".") ? docId : "");
  if (!userId) {
    userId = (await resolveSocialUserIdByHint({ username, email })) || "";
  }
  // Son çare: sonuç listesinde gösterebilmek için stabil geçici anahtar.
  if (!userId) {
    userId = `hint:${(username || email || docId || "").toLocaleLowerCase("tr-TR")}`;
  }
  const photoRaw = pickString(data, [
    "photoUri",
    "photoURL",
    "profilePhotoUrl",
    "profilePhotoURL",
    "profileImageUrl",
    "profileImageURL",
    "avatarUrl",
    "avatarURL",
    "avatar",
    "imageUrl",
    "imageURL",
    "profilePhotoPath",
    "profileImagePath",
    "avatarPath",
  ]);
  const nestedPhotoRaw = pickNestedPhoto(data);
  const photoUri = await ensurePhotoUrl(photoRaw || nestedPhotoRaw);
  const bio = pickString(data, ["bio", "biyografi", "about"]);
  const company = pickString(data, ["company", "kurum", "firma", "calistigiKurum"]);
  const university = pickString(data, ["university", "universite"]);
  const city = pickString(data, ["city", "sehir"]);
  return {
    userId,
    username: username || "@kullanici",
    displayName,
    email,
    photoUri,
    bio,
    company,
    university,
    city,
  };
}

async function resolvePersonById(userId: string, fallback?: Partial<KisiAraPerson>): Promise<KisiAraPerson> {
  const db = getFirebaseFirestore();
  const base: KisiAraPerson = {
    userId,
    username: fallback?.username || "@kullanici",
    displayName: fallback?.displayName || "",
    email: fallback?.email || "",
    photoUri: fallback?.photoUri || "",
    bio: fallback?.bio || "",
    company: fallback?.company || "",
    university: fallback?.university || "",
    city: fallback?.city || "",
  };
  const mergeProfileData = async (data: Record<string, unknown>): Promise<KisiAraPerson> => {
    const photoRaw =
      pickString(data, [
        "photoUri",
        "photoURL",
        "profilePhotoUrl",
        "profilePhotoURL",
        "profileImageUrl",
        "profileImageURL",
        "avatarUrl",
        "avatarURL",
        "avatar",
        "imageUrl",
        "imageURL",
        "profilePhotoPath",
        "profileImagePath",
        "avatarPath",
        "fromUserPhoto",
      ]) || pickNestedPhoto(data);
    const photoUri = await ensurePhotoUrl(photoRaw);
    return {
      ...base,
      username: normalizeUsername(pickString(data, ["username", "kullaniciAdi", "userName", "fromUserName", "fromUsername"])) || base.username,
      displayName: pickString(data, ["adSoyad", "displayName", "name", "fullName"]) || base.displayName,
      email: pickString(data, ["email", "mail", "fromEmail"]) || base.email,
      photoUri: photoUri || base.photoUri,
      bio: pickString(data, ["bio", "biyografi", "about"]) || base.bio,
      company: pickString(data, ["company", "kurum", "firma", "calistigiKurum"]) || base.company,
      university: pickString(data, ["university", "universite"]) || base.university,
      city: pickString(data, ["city", "sehir"]) || base.city,
    };
  };

  const byIdCandidates = [
    doc(db, "userProfiles", userId),
    doc(db, "profiles", userId),
    doc(db, "profilesByUid", userId),
  ];
  const directSnaps = await Promise.all(byIdCandidates.map((refDoc) => getDoc(refDoc).catch(() => null)));
  for (const snap of directSnaps) {
    if (snap?.exists()) {
      return mergeProfileData(snap.data() as Record<string, unknown>);
    }
  }
  const uidFieldQueries = await Promise.all(
    (["userProfiles", "profiles", "profilesByUid"] as const).map((col) =>
      getDocs(query(collection(db, col), where("userId", "==", userId), limit(1))).catch(() => null),
    ),
  );
  for (const q of uidFieldQueries) {
    if (q && !q.empty) {
      return mergeProfileData(q.docs[0]!.data() as Record<string, unknown>);
    }
  }
  const uidAltQueries = await Promise.all(
    (["userProfiles", "profiles", "profilesByUid"] as const).map((col) =>
      getDocs(query(collection(db, col), where("uid", "==", userId), limit(1))).catch(() => null),
    ),
  );
  for (const q of uidAltQueries) {
    if (q && !q.empty) {
      return mergeProfileData(q.docs[0]!.data() as Record<string, unknown>);
    }
  }
  // userId tutarsızsa username/e-mail üzerinden web profilini bul.
  const fallbackUsername = normalizeUsername(fallback?.username || "");
  const fallbackEmail = (fallback?.email || "").trim().toLocaleLowerCase("tr-TR");
  const resolvedByHint = await resolveSocialUserIdByHint({ username: fallbackUsername, email: fallbackEmail }).catch(() => null);
  if (resolvedByHint && resolvedByHint !== userId) {
    const resolved = await resolvePersonById(resolvedByHint, fallback);
    if (resolved.photoUri || resolved.username !== "@kullanici") return resolved;
  }
  const unameBare = fallbackUsername.startsWith("@") ? fallbackUsername.slice(1) : fallbackUsername;
  const usernameCandidates = Array.from(
    new Set([fallbackUsername, fallbackUsername.toLocaleLowerCase("tr-TR"), unameBare, unameBare.toLocaleLowerCase("tr-TR")].filter(Boolean)),
  );
  for (const col of ["userProfiles", "profiles", "profilesByUid"] as const) {
    for (const u of usernameCandidates) {
      const qs = [
        getDocs(query(collection(db, col), where("username", "==", u), limit(1))).catch(() => null),
        getDocs(query(collection(db, col), where("kullaniciAdi", "==", u), limit(1))).catch(() => null),
        getDocs(query(collection(db, col), where("userName", "==", u), limit(1))).catch(() => null),
      ];
      const hits = await Promise.all(qs);
      for (const hit of hits) {
        if (hit && !hit.empty) {
          return mergeProfileData(hit.docs[0]!.data() as Record<string, unknown>);
        }
      }
    }
    if (fallbackEmail) {
      const emailHits = await Promise.all([
        getDocs(query(collection(db, col), where("email", "==", fallbackEmail), limit(1))).catch(() => null),
        getDocs(query(collection(db, col), where("mail", "==", fallbackEmail), limit(1))).catch(() => null),
      ]);
      for (const hit of emailHits) {
        if (hit && !hit.empty) {
          return mergeProfileData(hit.docs[0]!.data() as Record<string, unknown>);
        }
      }
    }
  }
  return base;
}

async function enrichPersonIfNeeded(person: KisiAraPerson): Promise<KisiAraPerson> {
  if (person.photoUri && person.username && person.username !== "@kullanici") return person;
  return resolvePersonById(person.userId, person);
}

export function canUseKisiAraFirestore(): boolean {
  return isFirebaseConfigured();
}

export async function getBlockState(): Promise<BlockState> {
  if (!isFirebaseConfigured()) return { iBlocked: new Set<string>(), blockedMe: new Set<string>() };
  try {
    const actor = await resolveCurrentSocialUserId();
    const db = getFirebaseFirestore();
    const iBlockedSnap = await getDocs(query(collection(db, "socialBlocks", actor, "blocked"), limit(2000))).catch(() => null);
    const iBlocked = new Set<string>();
    if (iBlockedSnap) iBlockedSnap.docs.forEach((d) => iBlocked.add(d.id));
    // blockedMe taraması çok pahalı/yan etkili olabildiği için güvenli tarafta boş bırak.
    return { iBlocked, blockedMe: new Set<string>() };
  } catch {
    return { iBlocked: new Set<string>(), blockedMe: new Set<string>() };
  }
}

export async function setBlockedUser(targetUserId: string, blocked: boolean): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const actor = await resolveCurrentSocialUserId();
  if (!targetUserId || targetUserId === actor) return;
  const db = getFirebaseFirestore();
  const refDoc = doc(db, "socialBlocks", actor, "blocked", targetUserId);
  if (blocked) {
    await setDoc(refDoc, { userId: targetUserId, createdAt: serverTimestamp() }, { merge: true });
    await Promise.allSettled([
      deleteDoc(doc(db, "socialFollows", actor, "following", targetUserId)),
      deleteDoc(doc(db, "socialFollowers", actor, "followers", targetUserId)),
      deleteDoc(doc(db, "socialFollows", targetUserId, "following", actor)),
      deleteDoc(doc(db, "socialFollowers", targetUserId, "followers", actor)),
    ]);
  } else {
    await deleteDoc(refDoc).catch(() => {
      /* ignore */
    });
  }
}

export async function searchPeople(input: string, advanced?: { company?: string; university?: string; city?: string }): Promise<KisiAraPerson[]> {
  if (!isFirebaseConfigured()) return [];
  const db = getFirebaseFirestore();
  const qRaw = (input || "").trim().toLocaleLowerCase("tr-TR");
  const qNoAt = qRaw.startsWith("@") ? qRaw.slice(1) : qRaw;
  const qAt = qRaw ? (qRaw.startsWith("@") ? qRaw : `@${qRaw}`) : "";
  const companyQ = (advanced?.company || "").trim().toLocaleLowerCase("tr-TR");
  const universityQ = (advanced?.university || "").trim().toLocaleLowerCase("tr-TR");
  const cityQ = (advanced?.city || "").trim().toLocaleLowerCase("tr-TR");
  const out = new Map<string, KisiAraPerson>();
  const dedup = new Map<string, KisiAraPerson>();
  const scorePerson = (p: KisiAraPerson): number => {
    let s = 0;
    if (p.userId && !p.userId.startsWith("hint:")) s += 4;
    if (p.photoUri) s += 3;
    if (p.displayName) s += 2;
    if (p.email) s += 1;
    if (p.username && p.username !== "@kullanici") s += 1;
    return s;
  };
  const putPerson = (person: KisiAraPerson) => {
    const prev = out.get(person.userId);
    if (!prev) {
      out.set(person.userId, person);
    } else {
      out.set(person.userId, {
        ...prev,
        username: prev.username !== "@kullanici" ? prev.username : person.username,
        displayName: prev.displayName || person.displayName,
        email: prev.email || person.email,
        photoUri: prev.photoUri || person.photoUri,
        bio: prev.bio || person.bio,
        company: prev.company || person.company,
        university: prev.university || person.university,
        city: prev.city || person.city,
      });
    }
    const kEmail = (person.email || "").trim().toLocaleLowerCase("tr-TR");
    const kUser = normalizeUsername(person.username || "").toLocaleLowerCase("tr-TR");
    const dedupKey = kEmail ? `mail:${kEmail}` : kUser ? `user:${kUser}` : `id:${person.userId}`;
    const current = dedup.get(dedupKey);
    if (!current || scorePerson(person) > scorePerson(current)) dedup.set(dedupKey, person);
  };
  const matchesAdvanced = (person: KisiAraPerson) => {
    if (companyQ && !person.company.toLocaleLowerCase("tr-TR").includes(companyQ)) return false;
    if (universityQ && !person.university.toLocaleLowerCase("tr-TR").includes(universityQ)) return false;
    if (cityQ && person.city.toLocaleLowerCase("tr-TR") !== cityQ) return false;
    return true;
  };
  const mapAndPutDoc = async (d: { id: string; data: () => Record<string, unknown> }) => {
    const person = await mapDocToPerson(d.id, d.data() as Record<string, unknown>);
    if (!person) return;
    if (!matchesAdvanced(person)) return;
    putPerson(person);
  };

  // 0) @kullanıcı → tek UID: profil + engel listesi paralel
  if (qRaw && !companyQ && !universityQ && !cityQ) {
    const hintRaw = (qAt || (qNoAt ? `@${qNoAt}` : "")).trim();
    if (hintRaw.length >= 2) {
      try {
        const quickUid = await resolveSocialUserIdByHint({ username: normalizeUsername(hintRaw) });
        if (quickUid) {
          const [person, { iBlocked, blockedMe }] = await Promise.all([
            resolvePersonById(quickUid, { username: normalizeUsername(hintRaw) }),
            getBlockState(),
          ]);
          if (matchesAdvanced(person) && !iBlocked.has(person.userId) && !blockedMe.has(person.userId)) {
            return [person].sort((a, b) => a.username.localeCompare(b.username, "tr"));
          }
        }
      } catch {
        /* tam eşleşme + gerekirse dar geniş aramaya düş */
      }
    }
  }

  // 1) Alan eşleşmesi — kullanıcı adı tek satır gibi görünüyorsa isim/soyad alanlarını atla (daha az sorgu)
  if (qRaw) {
    const qCandidates = Array.from(new Set([qRaw, qNoAt, qAt].filter(Boolean)));
    const cols = ["userProfiles", "profiles", "profilesByUid"] as const;
    const tokenLooksLikeHandle =
      !companyQ &&
      !universityQ &&
      !cityQ &&
      !(input || "").trim().includes(" ") &&
      /^[@a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._-]+$/.test((input || "").trim());
    type Snap = Awaited<ReturnType<typeof getDocs>> | null;
    const jobs: Promise<Snap>[] = [];
    for (const colName of cols) {
      for (const v of qCandidates) {
        jobs.push(getDocs(query(collection(db, colName), where("username", "==", v), limit(40))).catch(() => null));
        jobs.push(getDocs(query(collection(db, colName), where("kullaniciAdi", "==", v), limit(40))).catch(() => null));
        jobs.push(getDocs(query(collection(db, colName), where("userName", "==", v), limit(40))).catch(() => null));
        jobs.push(getDocs(query(collection(db, colName), where("email", "==", v), limit(40))).catch(() => null));
        jobs.push(getDocs(query(collection(db, colName), where("mail", "==", v), limit(40))).catch(() => null));
        if (!tokenLooksLikeHandle) {
          jobs.push(getDocs(query(collection(db, colName), where("adSoyad", "==", v), limit(40))).catch(() => null));
          jobs.push(getDocs(query(collection(db, colName), where("displayName", "==", v), limit(40))).catch(() => null));
          jobs.push(getDocs(query(collection(db, colName), where("name", "==", v), limit(40))).catch(() => null));
          jobs.push(getDocs(query(collection(db, colName), where("fullName", "==", v), limit(40))).catch(() => null));
        }
      }
    }
    const snaps = await Promise.all(jobs);
    const seenPath = new Set<string>();
    const docTasks: Promise<void>[] = [];
    for (const snap of snaps) {
      if (!snap) continue;
      for (const d of snap.docs) {
        const path = d.ref.path;
        if (seenPath.has(path)) continue;
        seenPath.add(path);
        const id = d.id;
        const data = d.data() as Record<string, unknown>;
        docTasks.push(mapAndPutDoc({ id, data: () => data }));
      }
    }
    await Promise.all(docTasks);
  }

  const readAndMerge = async (colName: "userProfiles" | "profiles" | "profilesByUid", broadLimit: number) => {
    const snap = await getDocs(query(collection(db, colName), limit(broadLimit))).catch(() => null);
    if (!snap) return;
    const people = await Promise.all(
      snap.docs.map((d) => mapDocToPerson(d.id, d.data() as Record<string, unknown>).catch(() => null)),
    );
    for (const person of people) {
      if (!person) continue;
      if (qRaw) {
        const uname = (person.username || "").toLocaleLowerCase("tr-TR");
        const unameNoAt = uname.startsWith("@") ? uname.slice(1) : uname;
        const hay = `${uname} ${unameNoAt} ${person.displayName} ${person.email}`.toLocaleLowerCase("tr-TR");
        if (!(hay.includes(qRaw) || (qNoAt && hay.includes(qNoAt)) || (qAt && hay.includes(qAt)))) continue;
      }
      if (!matchesAdvanced(person)) continue;
      putPerson(person);
    }
  };

  /* Son çare: limitsiz 3x220 belge tüm istemcileri kilitliyordu. Önce sonuç var mı bak; yoksa tek koleksiyon → sonra diğerleri. */
  if (out.size === 0) {
    const lim = qRaw ? 100 : 120;
    await readAndMerge("userProfiles", lim);
    if (out.size === 0) {
      await Promise.all([readAndMerge("profiles", Math.min(lim, 100)), readAndMerge("profilesByUid", Math.min(lim, 100))]);
    }
  }

  const { iBlocked, blockedMe } = await getBlockState();
  const uniq = dedup.size ? Array.from(dedup.values()) : Array.from(out.values());
  return uniq
    .filter((p) => !iBlocked.has(p.userId) && !blockedMe.has(p.userId))
    .sort((a, b) => a.username.localeCompare(b.username, "tr"));
}

export async function getOutgoingFollowPendingMap(): Promise<Record<string, boolean>> {
  if (!isFirebaseConfigured()) return {};
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const out: Record<string, boolean> = {};
  const pending = await getDocs(
    query(collection(db, "friendRequests"), where("fromUserId", "==", actor), where("status", "==", "pending"), limit(1500)),
  ).catch(() => null);
  if (pending) {
    for (const d of pending.docs) {
      const x = d.data() as Record<string, unknown>;
      const to = pickString(x, ["toUserId", "toUid", "targetUserId", "userId", "uid", "id"]);
      if (to) out[to] = true;
    }
  }
  return out;
}

/** Yalnızca takip alt koleksiyonu — gs:// foto çözümü ve profil turu yok; Kişi Ara anında açılsın diye */
export async function getFollowingPeopleQuick(): Promise<KisiAraPerson[]> {
  if (!isFirebaseConfigured()) return [];
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const snap = await getDocs(query(collection(db, "socialFollows", actor, "following"), limit(1000)));
  const out: KisiAraPerson[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const userId = pickString(x, ["userId", "uid", "id"]) || d.id;
    if (!userId) continue;
    const username = normalizeUsername(pickString(x, ["username", "kullaniciAdi", "userName"])) || "@kullanici";
    const email = pickString(x, ["email", "mail"]);
    let photoUri = pickString(x, ["photoUri", "photoURL", "avatarUrl", "imageUrl", "profileImageURL", "photoURL"]);
    if (photoUri && !/^https?:\/\//i.test(photoUri) && !/^data:/i.test(photoUri)) photoUri = "";
    out.push({
      userId,
      username,
      displayName: pickString(x, ["adSoyad", "displayName", "name", "fullName"]) || "",
      email,
      photoUri,
      bio: "",
      company: "",
      university: "",
      city: "",
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username, "tr"));
}

/** Yalnızca takipçi alt koleksiyonu — hızlı ilk liste */
export async function getFollowersPeopleQuick(): Promise<KisiAraPerson[]> {
  if (!isFirebaseConfigured()) return [];
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const snap = await getDocs(query(collection(db, "socialFollowers", actor, "followers"), limit(1000)));
  const out: KisiAraPerson[] = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const userId = pickString(x, ["userId", "uid", "id"]) || d.id;
    if (!userId) continue;
    const username = normalizeUsername(pickString(x, ["username", "kullaniciAdi", "userName"])) || "@kullanici";
    const email = pickString(x, ["email", "mail"]);
    let photoUri = pickString(x, ["photoUri", "photoURL", "avatarUrl", "imageUrl", "profileImageURL"]);
    if (photoUri && !/^https?:\/\//i.test(photoUri) && !/^data:/i.test(photoUri)) photoUri = "";
    out.push({
      userId,
      username,
      displayName: pickString(x, ["adSoyad", "displayName", "name", "fullName"]) || "",
      email,
      photoUri,
      bio: "",
      company: "",
      university: "",
      city: "",
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username, "tr"));
}

export async function getFollowingPeople(): Promise<KisiAraPerson[]> {
  if (!isFirebaseConfigured()) return [];
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const snap = await getDocs(query(collection(db, "socialFollows", actor, "following"), limit(1000)));
  const out = new Map<string, KisiAraPerson>();
  const followingRows = await Promise.all(
    snap.docs.map(async (d) => {
      const x = d.data() as Record<string, unknown>;
      const userId = pickString(x, ["userId", "uid", "id"]) || d.id;
      if (!userId) return null;
      const username = normalizeUsername(pickString(x, ["username", "kullaniciAdi", "userName"])) || "@kullanici";
      const email = pickString(x, ["email", "mail"]);
      const photoUri = await ensurePhotoUrl(pickString(x, ["photoUri", "photoURL", "avatarUrl", "imageUrl"]));
      return enrichPersonIfNeeded({
        userId,
        username,
        displayName: "",
        email,
        photoUri,
        bio: "",
        company: "",
        university: "",
        city: "",
      });
    }),
  );
  for (const row of followingRows) {
    if (row) out.set(row.userId, row);
  }
  const actorKeys = await resolveCurrentActorKeysForFriendQueries();
  for (const key of actorKeys) {
    const acceptedOut = await getDocs(
      query(collection(db, "friendRequests"), where("fromUserId", "==", key), where("status", "==", "accepted"), limit(1500)),
    ).catch(() => null);
    if (!acceptedOut) continue;
    for (const d of acceptedOut.docs) {
      const x = d.data() as Record<string, unknown>;
      const targetId = pickString(x, ["toUserId", "toUid", "targetUserId", "userId", "uid", "id"]);
      if (!targetId) continue;
      if (!out.has(targetId)) {
        out.set(
          targetId,
          await resolvePersonById(targetId, {
            username: normalizeUsername(pickString(x, ["toUserName", "toUsername", "username", "kullaniciAdi"])) || "@kullanici",
            email: pickString(x, ["toEmail", "email", "mail"]),
          }),
        );
      }
    }
  }
  const { iBlocked, blockedMe } = await getBlockState();
  return Array.from(out.values())
    .filter((p) => !iBlocked.has(p.userId) && !blockedMe.has(p.userId))
    .sort((a, b) => a.username.localeCompare(b.username, "tr"));
}

export async function isFollowing(targetUserId: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  const actor = await resolveCurrentSocialUserId();
  if (!targetUserId || targetUserId === actor) return false;
  const db = getFirebaseFirestore();
  const snap = await getDoc(doc(db, "socialFollows", actor, "following", targetUserId));
  return snap.exists();
}

/** Arama geçici kimliğini (hint:...) Firestore userId’ye çözümler. */
export async function resolveStableTargetUserId(person: KisiAraPerson): Promise<string> {
  const raw = (person.userId || "").trim();
  if (raw && !raw.startsWith("hint:")) return raw;
  const resolved = await resolveSocialUserIdByHint({
    username: person.username,
    email: person.email,
  });
  return ((resolved || "").trim() || raw).trim();
}

/** Görüntüleyen oturum bu profilin sahibi mi? (uid, e-posta, kullanıcı adı eşleşmeleri). */
export async function isCurrentUserTargetProfile(targetUserId: string): Promise<boolean> {
  const t = (targetUserId || "").trim();
  if (!t || t.startsWith("hint:")) return false;
  const keys = await resolveCurrentSocialReceiverKeys();
  const tl = t.toLocaleLowerCase("tr-TR");
  return keys.some((k) => (k || "").trim().toLocaleLowerCase("tr-TR") === tl);
}

export async function getFollowersPeople(): Promise<KisiAraPerson[]> {
  if (!isFirebaseConfigured()) return [];
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const snap = await getDocs(query(collection(db, "socialFollowers", actor, "followers"), limit(1000)));
  const out = new Map<string, KisiAraPerson>();
  const followerRows = await Promise.all(
    snap.docs.map(async (d) => {
      const x = d.data() as Record<string, unknown>;
      const userId = pickString(x, ["userId", "uid", "id"]) || d.id;
      if (!userId) return null;
      const username = normalizeUsername(pickString(x, ["username", "kullaniciAdi", "userName"])) || "@kullanici";
      const email = pickString(x, ["email", "mail"]);
      const photoUri = await ensurePhotoUrl(pickString(x, ["photoUri", "photoURL", "avatarUrl", "imageUrl"]));
      return enrichPersonIfNeeded({
        userId,
        username,
        displayName: "",
        email,
        photoUri,
        bio: "",
        company: "",
        university: "",
        city: "",
      });
    }),
  );
  for (const row of followerRows) {
    if (row) out.set(row.userId, row);
  }
  const actorKeys = await resolveCurrentActorKeysForFriendQueries();
  for (const key of actorKeys) {
    const acceptedIn = await getDocs(
      query(collection(db, "friendRequests"), where("toUserId", "==", key), where("status", "==", "accepted"), limit(1500)),
    ).catch(() => null);
    if (!acceptedIn) continue;
    for (const d of acceptedIn.docs) {
      const x = d.data() as Record<string, unknown>;
      const fromId = pickString(x, ["fromUserId", "fromUid", "userId", "uid", "id"]);
      if (!fromId) continue;
      if (!out.has(fromId)) {
        out.set(
          fromId,
          await resolvePersonById(fromId, {
            username: normalizeUsername(pickString(x, ["fromUserName", "fromUsername", "username", "kullaniciAdi"])) || "@kullanici",
            email: pickString(x, ["fromEmail", "email", "mail"]),
          }),
        );
      }
    }
  }
  const { iBlocked, blockedMe } = await getBlockState();
  return Array.from(out.values())
    .filter((p) => !iBlocked.has(p.userId) && !blockedMe.has(p.userId))
    .sort((a, b) => a.username.localeCompare(b.username, "tr"));
}

export async function getIncomingFollowRequests(): Promise<FollowRequestItem[]> {
  if (!isFirebaseConfigured()) return [];
  const actor = await resolveCurrentSocialUserId();
  const receiverKeys = await resolveCurrentSocialReceiverKeys();
  const db = getFirebaseFirestore();
  const outMap = new Map<string, FollowRequestItem>();
  const mapAndPut = async (d: { id: string; data: () => Record<string, unknown> }) => {
    const x = d.data() as Record<string, unknown>;
    const ts = x.createdAt as { toMillis?: () => number } | undefined;
    const fromUserId = pickString(x, ["fromUserId", "userId", "uid", "id"]) || d.id;
    const enriched = await resolvePersonById(fromUserId, {
      username: normalizeUsername(pickString(x, ["fromUsername", "username", "kullaniciAdi", "userName"])) || "@kullanici",
      email: pickString(x, ["fromEmail", "email", "mail"]),
      photoUri: await ensurePhotoUrl(pickString(x, ["fromPhotoUri", "photoUri", "photoURL", "avatarUrl", "imageUrl"])),
    });
    const item: FollowRequestItem = {
      fromUserId,
      fromUsername: enriched.username || "@kullanici",
      fromEmail: enriched.email || "",
      fromPhotoUri: enriched.photoUri || "",
      createdAtMs: typeof ts?.toMillis === "function" ? ts.toMillis() : 0,
    };
    const prev = outMap.get(fromUserId);
    if (!prev || item.createdAtMs > prev.createdAtMs) outMap.set(fromUserId, item);
  };

  for (const key of receiverKeys) {
    const [incomingSnap, requestsSnap] = await Promise.all([
      getDocs(query(collection(db, "socialFollowRequests", key, "incoming"), limit(500))).catch(() => null),
      getDocs(query(collection(db, "socialFollowRequests", key, "requests"), limit(500))).catch(() => null),
    ]);
    if (incomingSnap) for (const d of incomingSnap.docs) await mapAndPut(d);
    if (requestsSnap) for (const d of requestsSnap.docs) await mapAndPut(d);
  }

  // Web'in tek koleksiyon kullandığı varyasyon.
  for (const key of receiverKeys) {
    const flatSnap = await getDocs(
      query(collection(db, "followRequests"), where("toUserId", "==", key), limit(500)),
    ).catch(() => null);
    if (flatSnap) {
      for (const d of flatSnap.docs) {
        await mapAndPut({
          id: d.id,
          data: () => d.data() as Record<string, unknown>,
        });
      }
    }
  }

  // Web'in asıl takip sistemi: friendRequests(status=pending).
  for (const key of receiverKeys) {
    const friendReqSnap = await getDocs(
      query(
        collection(db, "friendRequests"),
        where("toUserId", "==", key),
        where("status", "==", "pending"),
        limit(500),
      ),
    ).catch(() => null);
    if (friendReqSnap) {
      for (const d of friendReqSnap.docs) {
        const x = d.data() as Record<string, unknown>;
        const ts = x.createdAt as { toMillis?: () => number } | undefined;
        const fromUserId = pickString(x, ["fromUserId", "userId", "uid", "id"]);
        if (!fromUserId) continue;
        const enriched = await resolvePersonById(fromUserId, {
          username: normalizeUsername(pickString(x, ["fromUserName", "fromUsername", "username", "kullaniciAdi", "userName"])) || "@kullanici",
          email: pickString(x, ["fromEmail", "email", "mail"]),
          photoUri: await ensurePhotoUrl(pickString(x, ["fromUserPhoto", "fromPhotoUri", "photoUri", "photoURL", "avatarUrl", "imageUrl"])),
        });
        const item: FollowRequestItem = {
          requestId: d.id,
          fromUserId,
          fromUsername: enriched.username || "@kullanici",
          fromEmail: enriched.email || "",
          fromPhotoUri: enriched.photoUri || "",
          createdAtMs: typeof ts?.toMillis === "function" ? ts.toMillis() : 0,
        };
        const prev = outMap.get(fromUserId);
        if (!prev || item.createdAtMs > prev.createdAtMs) outMap.set(fromUserId, item);
      }
    }
  }

  // Bazı web sürümlerinde to alanı farklı isimlerle geliyor; pending kayıtları geniş tarayıp filtrele.
  const broadPending = await getDocs(
    query(collection(db, "friendRequests"), where("status", "==", "pending"), limit(2000)),
  ).catch(() => null);
  if (broadPending) {
    for (const d of broadPending.docs) {
      const x = d.data() as Record<string, unknown>;
      const toRaw = pickString(x, ["toUserId", "toUid", "toUser", "toUserName", "toUsername", "toEmail", "targetUserId"]);
      if (!includesAnyKey(toRaw, receiverKeys)) continue;
      const ts = x.createdAt as { toMillis?: () => number } | undefined;
      const fromUserId = pickString(x, ["fromUserId", "fromUid", "userId", "uid", "id"]);
      if (!fromUserId) continue;
      const enriched = await resolvePersonById(fromUserId, {
        username: normalizeUsername(pickString(x, ["fromUserName", "fromUsername", "username", "kullaniciAdi", "userName"])) || "@kullanici",
        email: pickString(x, ["fromEmail", "email", "mail"]),
        photoUri: await ensurePhotoUrl(pickString(x, ["fromUserPhoto", "fromPhotoUri", "photoUri", "photoURL", "avatarUrl", "imageUrl"])),
      });
      const item: FollowRequestItem = {
        requestId: d.id,
        fromUserId,
        fromUsername: enriched.username || "@kullanici",
        fromEmail: enriched.email || "",
        fromPhotoUri: enriched.photoUri || "",
        createdAtMs: typeof ts?.toMillis === "function" ? ts.toMillis() : 0,
      };
      const prev = outMap.get(fromUserId);
      if (!prev || item.createdAtMs > prev.createdAtMs) outMap.set(fromUserId, item);
    }
  }

  const { iBlocked, blockedMe } = await getBlockState();
  return Array.from(outMap.values())
    .filter((r) => !iBlocked.has(r.fromUserId) && !blockedMe.has(r.fromUserId))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function sendFollowRequest(target: KisiAraPerson): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const actor = await resolveCurrentSocialUserId();
  const resolvedTargetUserId =
    (target.userId && !target.userId.startsWith("hint:") ? target.userId : "") ||
    (await resolveSocialUserIdByHint({ username: target.username, email: target.email })) ||
    "";
  if (!resolvedTargetUserId || resolvedTargetUserId === actor) return;
  const db = getFirebaseFirestore();
  const me = await loadProfile();
  const username = normalizeUsername(me.kullaniciAdi || "") || "@kullanici";
  const payload = {
    fromUserId: actor,
    fromUsername: username,
    fromEmail: me.email || "",
    fromPhotoUri: me.photoUri || "",
    toUserId: resolvedTargetUserId,
    createdAt: serverTimestamp(),
  };
  const results = await Promise.allSettled([
    // Ana kaynak: webin kullandığı friendRequests.
    addDoc(collection(db, "friendRequests"), {
      fromUserId: actor,
      toUserId: resolvedTargetUserId,
      fromUserName: username,
      fromUserPhoto: me.photoUri || "",
      status: "pending",
      createdAt: serverTimestamp(),
    }),
    // Alternatif pathler (uyumluluk).
    setDoc(doc(db, "socialFollowRequests", resolvedTargetUserId, "incoming", actor), payload, { merge: true }),
    setDoc(doc(db, "socialFollowRequests", resolvedTargetUserId, "requests", actor), payload, { merge: true }),
    setDoc(doc(db, "followRequests", `${resolvedTargetUserId}_${actor}`), payload, { merge: true }),
  ]);
  if (!results.some((r) => r.status === "fulfilled")) {
    throw new Error("Takip isteği yazılamadı.");
  }
  await enqueueSocialNotification({
    type: "follow_request",
    toUserId: resolvedTargetUserId,
    fromUserId: actor,
    fromUsername: username,
  }).catch(() => {});
}

export async function respondFollowRequest(req: FollowRequestItem, approve: boolean): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const requestRef = doc(db, "socialFollowRequests", actor, "incoming", req.fromUserId);
  const requestRefAlt = doc(db, "socialFollowRequests", actor, "requests", req.fromUserId);
  const requestFlatRef = doc(db, "followRequests", `${actor}_${req.fromUserId}`);
  if (approve) {
    await setDoc(
      doc(db, "socialFollows", req.fromUserId, "following", actor),
      {
        userId: actor,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    await setDoc(
      doc(db, "socialFollowers", actor, "followers", req.fromUserId),
      {
        userId: req.fromUserId,
        username: req.fromUsername,
        email: req.fromEmail,
        photoUri: req.fromPhotoUri,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    const me = await loadProfile();
    const myUsername = normalizeUsername(me.kullaniciAdi || "") || "@kullanici";
    await enqueueSocialNotification({
      type: "follow_accepted",
      toUserId: req.fromUserId,
      fromUserId: actor,
      fromUsername: myUsername,
    }).catch(() => {});
  }
  if (req.requestId) {
    await updateDoc(doc(db, "friendRequests", req.requestId), { status: approve ? "accepted" : "rejected" }).catch(() => {
      /* ignore */
    });
  } else {
    // requestId gelmediyse pending kayıtları from/to ile tarayıp güncelle.
    const pendingSnap = await getDocs(
      query(
        collection(db, "friendRequests"),
        where("fromUserId", "==", req.fromUserId),
        where("toUserId", "==", actor),
        where("status", "==", "pending"),
        limit(50),
      ),
    ).catch(() => null);
    if (pendingSnap) {
      await Promise.all(
        pendingSnap.docs.map((d) =>
          updateDoc(d.ref, { status: approve ? "accepted" : "rejected" }).catch(() => {
            /* ignore */
          }),
        ),
      );
    }
  }
  await deleteDoc(requestRef).catch(() => {
    /* ignore */
  });
  await deleteDoc(requestRefAlt).catch(() => {
    /* ignore */
  });
  await deleteDoc(requestFlatRef).catch(() => {
    /* ignore */
  });
}

export async function getProfileSocialCounts(): Promise<ProfileSocialCounts> {
  if (!isFirebaseConfigured()) return { following: 0, followers: 0, mutual: 0 };
  const actor = await resolveCurrentSocialUserId();
  const db = getFirebaseFirestore();
  const [followingSnap, followersSnap] = await Promise.all([
    getDocs(query(collection(db, "socialFollows", actor, "following"), limit(2000))),
    getDocs(query(collection(db, "socialFollowers", actor, "followers"), limit(2000))),
  ]);
  const actorKeys = await resolveCurrentActorKeysForFriendQueries();
  const friendOutDocs: Array<{ data: () => Record<string, unknown> }> = [];
  const friendInDocs: Array<{ data: () => Record<string, unknown> }> = [];
  for (const key of actorKeys) {
    const [fo, fi] = await Promise.all([
      getDocs(query(collection(db, "friendRequests"), where("fromUserId", "==", key), where("status", "==", "accepted"), limit(2000))).catch(() => null),
      getDocs(query(collection(db, "friendRequests"), where("toUserId", "==", key), where("status", "==", "accepted"), limit(2000))).catch(() => null),
    ]);
    if (fo) friendOutDocs.push(...fo.docs);
    if (fi) friendInDocs.push(...fi.docs);
  }
  // Bazı web kayıtlarında from/to alanları username/email ile tutuluyor.
  const broadAccepted = await getDocs(
    query(collection(db, "friendRequests"), where("status", "==", "accepted"), limit(4000)),
  ).catch(() => null);
  if (broadAccepted) {
    for (const d of broadAccepted.docs) {
      const x = d.data() as Record<string, unknown>;
      const fromRaw = pickString(x, ["fromUserId", "fromUid", "fromUser", "fromUserName", "fromUsername", "fromEmail"]);
      const toRaw = pickString(x, ["toUserId", "toUid", "toUser", "toUserName", "toUsername", "toEmail", "targetUserId"]);
      if (includesAnyKey(fromRaw, actorKeys)) friendOutDocs.push({ data: () => x });
      if (includesAnyKey(toRaw, actorKeys)) friendInDocs.push({ data: () => x });
    }
  }
  const followingSet = new Set<string>(followingSnap.docs.map((d) => d.id));
  friendOutDocs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const to = pickString(x, ["toUserId", "userId", "uid", "id"]);
    if (to) followingSet.add(to);
  });
  const followersSet = new Set<string>(followersSnap.docs.map((d) => d.id));
  friendInDocs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const from = pickString(x, ["fromUserId", "userId", "uid", "id"]);
    if (from) followersSet.add(from);
  });
  const following = followingSet.size;
  const followers = followersSet.size;
  const a = followingSet;
  const b = followersSet;
  let mutual = 0;
  a.forEach((id) => {
    if (b.has(id)) mutual += 1;
  });
  return { following, followers, mutual };
}

export async function toggleFollow(target: KisiAraPerson): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  const actor = await resolveCurrentSocialUserId();
  if (!target.userId || target.userId === actor) return false;
  const db = getFirebaseFirestore();
  const followRef = doc(db, "socialFollows", actor, "following", target.userId);
  const followerRef = doc(db, "socialFollowers", target.userId, "followers", actor);
  const exists = await getDoc(followRef);
  const friendAccepted = await getDocs(
    query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", actor),
      where("toUserId", "==", target.userId),
      where("status", "==", "accepted"),
      limit(1),
    ),
  ).catch(() => null);
  if (exists.exists()) {
    await deleteDoc(followRef);
    await deleteDoc(followerRef).catch(() => {
      /* ignore */
    });
    return false;
  }
  if (friendAccepted && !friendAccepted.empty) return true;
  await sendFollowRequest(target);
  return false;
}
