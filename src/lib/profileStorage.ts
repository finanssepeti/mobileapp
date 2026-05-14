import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@finansepeti_profile_v1";

/** Son başarılı `loadProfile` / `saveProfile` — Profilim modalı ilk karede doğru adı göstersin. */
let lastProfileSnapshot: StoredProfile | null = null;

/** Senkron: ağ/AsyncStorage beklenmeden son bilinen profil (yoksa `null`). */
export function peekCachedProfile(): StoredProfile | null {
  return lastProfileSnapshot ? { ...lastProfileSnapshot } : null;
}

/** Firestore + yerel birleşik profil gibi tam görünümü önbelleğe yazar (Profilim ilk açılış). */
export function rememberProfileSnapshot(p: StoredProfile): void {
  lastProfileSnapshot = { ...DEFAULT_PROFILE, ...p };
}

export type StoredProfile = {
  photoUri: string;
  kullaniciAdi: string;
  adSoyad: string;
  email: string;
  telefon: string;
  unvan: string;
  meslek: string;
  kurum: string;
  universite: string;
  sehir: string;
  dogumTarihi: string;
  biyografi: string;
  sertifikalar: string;
  hobiler: string;
  kariyerCvUri: string;
  kariyerCvName: string;
  uyelikTipi: "bireysel" | "kurumsal";
  gizlilik: "herkese_acik" | "sadece_takipciler" | "gizli";
  /** Site / uygulama ayarları (Firestore ile uyumlu) */
  dil: "tr" | "en" | "de" | "fr";
  siteGorunumu: "acik" | "koyu";
};

export const DEFAULT_PROFILE: StoredProfile = {
  photoUri: "",
  kullaniciAdi: "",
  adSoyad: "",
  email: "",
  telefon: "",
  unvan: "",
  meslek: "",
  kurum: "",
  universite: "",
  sehir: "",
  dogumTarihi: "",
  biyografi: "",
  sertifikalar: "",
  hobiler: "",
  kariyerCvUri: "",
  kariyerCvName: "",
  uyelikTipi: "bireysel",
  gizlilik: "herkese_acik",
  dil: "tr",
  siteGorunumu: "koyu",
};

export async function loadProfile(): Promise<StoredProfile> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      lastProfileSnapshot = { ...DEFAULT_PROFILE };
      return lastProfileSnapshot;
    }
    const j = JSON.parse(raw) as Partial<StoredProfile> | null;
    if (!j || typeof j !== "object") {
      lastProfileSnapshot = { ...DEFAULT_PROFILE };
      return lastProfileSnapshot;
    }
    const merged = {
      ...DEFAULT_PROFILE,
      ...j,
    };
    lastProfileSnapshot = merged;
    return merged;
  } catch {
    lastProfileSnapshot = { ...DEFAULT_PROFILE };
    return lastProfileSnapshot;
  }
}

export async function saveProfile(p: StoredProfile): Promise<void> {
  const merged = { ...DEFAULT_PROFILE, ...p };
  await AsyncStorage.setItem(KEY, JSON.stringify(merged));
  lastProfileSnapshot = merged;
}

/** Firestore web alanları (photoURL vb.) + yerel dosya yolu — ana sayfa avatarı için tek adres. */
export function pickPhotoFromProfilePayload(remote: Partial<StoredProfile> | Record<string, unknown> | null | undefined): string {
  if (!remote || typeof remote !== "object") return "";
  const r = remote as Record<string, unknown>;
  for (const k of ["photoUri", "photoURL", "profilePhotoUrl", "profilePhotoURL", "avatarUrl", "avatarURL", "profileImageUrl", "photoUrl"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Ana sayfa sol üst avatar: önce HTTPS (Firestore / CDN), sonra cihazdaki dosya yolu.
 * Yalnızca AsyncStorage okuyunca APK'da yükleme sonrası logo kalma sorunu oluşuyordu.
 */
export function resolveAvatarUriForHome(
  local: StoredProfile,
  remote: Partial<StoredProfile> | Record<string, unknown> | null | undefined,
): string {
  const localUri = (local.photoUri || "").trim();
  const remoteUri = pickPhotoFromProfilePayload(remote);
  const isHttp = (u: string) => /^https?:\/\//i.test(u);
  if (isHttp(localUri)) return localUri;
  if (isHttp(remoteUri)) return remoteUri;
  if (localUri) return localUri;
  return remoteUri || "";
}
