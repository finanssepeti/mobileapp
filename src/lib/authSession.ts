import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@finansepeti_auth_session_v1";
const KEY_USER = "@finansepeti_auth_user_key_v1";
const KEY_LOGIN_EMAIL = "@finansepeti_auth_login_email_v1";

function normalizeUserKey(input: string): string {
  const base = (input || "").trim().toLowerCase();
  if (!base) return "guest";
  // Firestore doc id için güvenli karakter seti.
  return base.replace(/[^a-z0-9._-]/g, "_");
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setLoggedIn(userIdentity?: string): Promise<void> {
  await AsyncStorage.setItem(KEY, "1");
  const raw = (userIdentity || "").trim();
  const userKey = normalizeUserKey(raw);
  await AsyncStorage.setItem(KEY_USER, userKey);
  if (raw.includes("@")) {
    await AsyncStorage.setItem(KEY_LOGIN_EMAIL, raw.toLowerCase());
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY),
    AsyncStorage.removeItem(KEY_USER),
    AsyncStorage.removeItem(KEY_LOGIN_EMAIL),
  ]);
}

export async function getSessionUserKey(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(KEY_USER);
    return normalizeUserKey(raw || "guest");
  } catch {
    return "guest";
  }
}

/** Giriş sırasında verilen gerçek e-posta (`normalizeUserKey` kaybı olmadan); profil ile eşlemek için. */
export async function getSessionLoginEmail(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(KEY_LOGIN_EMAIL);
    return (v || "").trim();
  } catch {
    return "";
  }
}
