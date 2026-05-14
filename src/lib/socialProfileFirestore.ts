import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";
import { normalizeDocAccountSettings } from "./profileSiteFieldMap";
import type { StoredProfile } from "./profileStorage";

export type SocialProfileDetail = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  photoUri: string;
  phone: string;
  title: string;
  profession: string;
  company: string;
  university: string;
  city: string;
  bio: string;
  followers: number;
  following: number;
  mutual: number;
  photos: string[];
  videos: string[];
  comments: string[];
  careerItems: string[];
  memberType: "bireysel" | "kurumsal";
  /** Profil sahibinin gizlilik tercihi (Firestore: gizlilik / site alanlarından) */
  gizlilik: StoredProfile["gizlilik"];
};

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeUsername(v: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

function pickStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const arr = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
      if (arr.length) return arr;
    }
  }
  return [];
}

async function resolveProfileDoc(userId: string, username?: string, email?: string): Promise<Record<string, unknown> | null> {
  if (!isFirebaseConfigured()) return null;
  const db = getFirebaseFirestore();
  const byId = await Promise.all([
    getDocs(query(collection(db, "userProfiles"), where("userId", "==", userId), limit(1))).catch(() => null),
    getDocs(query(collection(db, "profiles"), where("userId", "==", userId), limit(1))).catch(() => null),
    getDocs(query(collection(db, "profilesByUid"), where("uid", "==", userId), limit(1))).catch(() => null),
  ]);
  for (const snap of byId) {
    if (snap && !snap.empty) return snap.docs[0]!.data() as Record<string, unknown>;
  }
  const uname = normalizeUsername(username || "");
  if (uname) {
    const unameBare = uname.slice(1);
    const candidates = Array.from(new Set([uname, uname.toLocaleLowerCase("tr-TR"), unameBare, unameBare.toLocaleLowerCase("tr-TR")]));
    for (const colName of ["userProfiles", "profiles", "profilesByUid"] as const) {
      for (const u of candidates) {
        const snap = await getDocs(query(collection(db, colName), where("username", "==", u), limit(1))).catch(() => null);
        if (snap && !snap.empty) return snap.docs[0]!.data() as Record<string, unknown>;
        const snap2 = await getDocs(query(collection(db, colName), where("kullaniciAdi", "==", u), limit(1))).catch(() => null);
        if (snap2 && !snap2.empty) return snap2.docs[0]!.data() as Record<string, unknown>;
      }
    }
  }
  const mail = (email || "").trim().toLocaleLowerCase("tr-TR");
  if (mail) {
    for (const colName of ["userProfiles", "profiles", "profilesByUid"] as const) {
      const snap = await getDocs(query(collection(db, colName), where("email", "==", mail), limit(1))).catch(() => null);
      if (snap && !snap.empty) return snap.docs[0]!.data() as Record<string, unknown>;
    }
  }
  return null;
}

async function loadUserFeedArrays(input: { userId: string; username: string; email: string }): Promise<{
  photos: string[];
  videos: string[];
  comments: string[];
}> {
  if (!isFirebaseConfigured()) return { photos: [], videos: [], comments: [] };
  const db = getFirebaseFirestore();
  const keys = Array.from(
    new Set(
      [input.userId, input.username, input.username.replace(/^@/, ""), input.email]
        .map((x) => (x || "").trim())
        .filter(Boolean),
    ),
  );
  const photos = new Set<string>();
  const videos = new Set<string>();
  const comments = new Set<string>();
  const collectionsToProbe = ["socialPosts", "posts", "comments"] as const;
  for (const colName of collectionsToProbe) {
    const snap = await getDocs(query(collection(db, colName), limit(600))).catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const x = d.data() as Record<string, unknown>;
      const owner = pickString(x, ["userId", "uid", "ownerId", "fromUserId", "username", "kullaniciAdi", "email", "mail"]);
      if (!keys.some((k) => k.toLocaleLowerCase("tr-TR") === owner.toLocaleLowerCase("tr-TR"))) continue;
      pickStringArray(x, ["photos", "photoUrls", "images"]).forEach((p) => photos.add(p));
      pickStringArray(x, ["videos", "videoUrls"]).forEach((v) => videos.add(v));
      const c = pickString(x, ["text", "comment", "yorum"]);
      if (c) comments.add(c);
    }
  }
  return { photos: Array.from(photos), videos: Array.from(videos), comments: Array.from(comments) };
}

export async function getSocialProfileDetail(
  input: {
    userId: string;
    username?: string;
    displayName?: string;
    email?: string;
    photoUri?: string;
    followers?: number;
    following?: number;
    mutual?: number;
  },
  opts?: { skipHeavyFeedScan?: boolean },
): Promise<SocialProfileDetail> {
  const doc = await resolveProfileDoc(input.userId, input.username, input.email);
  const d = doc || {};
  const localPhotos = pickStringArray(d, ["photos", "photoUrls", "photoURLs", "fotograflar", "images"]);
  const localVideos = pickStringArray(d, ["videos", "videoUrls", "videoURLs"]);
  const localComments = pickStringArray(d, ["comments", "yorumlar"]);
  const feed = opts?.skipHeavyFeedScan
    ? { photos: [] as string[], videos: [] as string[], comments: [] as string[] }
    : await loadUserFeedArrays({
        userId: input.userId,
        username: normalizeUsername(pickString(d, ["username", "kullaniciAdi", "userName"])) || normalizeUsername(input.username || ""),
        email: pickString(d, ["email", "mail"]) || input.email || "",
      });
  const photos = Array.from(new Set([...localPhotos, ...feed.photos]));
  const videos = Array.from(new Set([...localVideos, ...feed.videos]));
  const comments = Array.from(new Set([...localComments, ...feed.comments]));
  const careerItems = pickStringArray(d, ["career", "kariyer", "certificates", "sertifikalar"]);
  const gizFromDoc = normalizeDocAccountSettings(d as Record<string, unknown>).gizlilik;
  const gizlilik: StoredProfile["gizlilik"] = gizFromDoc ?? "herkese_acik";
  return {
    userId: input.userId,
    username: normalizeUsername(pickString(d, ["username", "kullaniciAdi", "userName"])) || normalizeUsername(input.username || "") || "@kullanici",
    displayName: pickString(d, ["adSoyad", "displayName", "name", "fullName"]) || input.displayName || "",
    email: pickString(d, ["email", "mail"]) || input.email || "",
    photoUri:
      pickString(d, [
        "photoUri",
        "photoURL",
        "profilePhotoUrl",
        "profilePhotoURL",
        "profileImageUrl",
        "profileImageURL",
        "avatarUrl",
        "avatarURL",
        "imageUrl",
        "imageURL",
      ]) || input.photoUri || "",
    phone: pickString(d, ["telefon", "phone"]),
    title: pickString(d, ["unvan", "title"]),
    profession: pickString(d, ["meslek", "profession", "job"]),
    company: pickString(d, ["kurum", "company", "firma", "calistigiKurum"]),
    university: pickString(d, ["universite", "university"]),
    city: pickString(d, ["sehir", "city"]),
    bio: pickString(d, ["biyografi", "bio", "about"]),
    followers: input.followers ?? 0,
    following: input.following ?? 0,
    mutual: input.mutual ?? 0,
    photos,
    videos,
    comments,
    careerItems,
    memberType: (pickString(d, ["uyelikTipi", "memberType", "accountType"]).toLocaleLowerCase("tr-TR") === "kurumsal" ? "kurumsal" : "bireysel"),
    gizlilik,
  };
}
