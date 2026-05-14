import {
  EmailAuthProvider,
  confirmPasswordReset,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { getFirebaseAuth, ensureFirestoreAuthReady } from "./firebaseClient";
import { loadProfile } from "./profileStorage";

/** Firebase e-posta şablonundaki sıfırlama bağlantısından `oobCode` çıkarır (uygulama içi confirmPasswordReset için). */
export function extractOobCodeFromFirebaseResetLink(resetLink: string): string | null {
  try {
    const u = new URL(String(resetLink).trim());
    let c = u.searchParams.get("oobCode");
    if (!c && u.hash && u.hash.length > 2) {
      const h = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
      try {
        c = new URLSearchParams(h).get("oobCode");
      } catch {
        /* noop */
      }
    }
    const t = (c || "").trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

function mapAuthCode(code: string): string {
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Mevcut şifre doğru değil.";
  if (code === "auth/weak-password") return "Yeni şifre çok zayıf.";
  if (code === "auth/user-not-found") return "Bu e-posta için kayıtlı hesap bulunamadı.";
  if (code === "auth/invalid-email") return "Profildeki e-posta geçersiz.";
  if (code === "auth/too-many-requests") return "Çok fazla deneme. Bir süre sonra tekrar deneyin.";
  if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") {
    return "Bağlantı geçersiz veya süresi dolmuş. «Şifremi unuttum» ile yeni kod isteyin.";
  }
  return code ? `İşlem tamamlanamadı (${code}).` : "İşlem tamamlanamadı.";
}

/**
 * E-posta ile gelen 6 haneli kod sonrası sunucunun verdiği `oobCode` ile yeni şifre belirler
 * (Firebase web «New password» sayfası açılmaz).
 */
export async function confirmPasswordWithResetOob(
  oobCode: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (newPassword.length < 6) {
    return { ok: false, message: "Yeni şifre en az 6 karakter olmalı." };
  }
  const code = oobCode.trim();
  if (!code) {
    return { ok: false, message: "Geçersiz sıfırlama kodu." };
  }
  try {
    const auth = getFirebaseAuth();
    await confirmPasswordReset(auth, code, newPassword);
    return { ok: true };
  } catch (e: unknown) {
    const c = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
    if (c === "auth/weak-password") return { ok: false, message: "Yeni şifre çok zayıf." };
    return { ok: false, message: mapAuthCode(c) };
  }
}

/**
 * Oturumda zaten e-posta/şifre varsa reauthenticate + güncelle.
 */
async function changeWhenEmailUser(currentPassword: string, newPassword: string): Promise<boolean> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  const email = user?.email;
  if (!user || !email) return false;
  const hasPassword = user.providerData.some((p) => p.providerId === "password");
  if (!hasPassword) return false;
  const cred = EmailAuthProvider.credential(email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
  return true;
}

/**
 * Profildeki e-posta + mevcut şifre ile giriş yapar, şifreyi günceller, ardından çıkış yapıp anonim Firestore oturumunu yeniler.
 * (Mobil çoğu zaman anonim Firebase kullanır; böylece şifre yine de Firebase’de güncellenir.)
 */
export async function tryChangeAppPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (newPassword.length < 6) {
    return { ok: false, message: "Yeni şifre en az 6 karakter olmalı." };
  }

  try {
    if (await changeWhenEmailUser(currentPassword, newPassword)) {
      return { ok: true };
    }
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
    return { ok: false, message: mapAuthCode(code) };
  }

  const profile = await loadProfile();
  const email = (profile.email || "").trim();
  if (!email) {
    return {
      ok: false,
      message: "Profilinizde e-posta kayıtlı değil. Önce Profilim’den e-posta ekleyin (site ile aynı hesap).",
    };
  }

  const auth = getFirebaseAuth();
  try {
    const cred = await signInWithEmailAndPassword(auth, email, currentPassword);
    await updatePassword(cred.user, newPassword);
    await signOut(auth);
    await ensureFirestoreAuthReady();
    return { ok: true };
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
    return { ok: false, message: mapAuthCode(code) };
  }
}
