import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, initializeAuth, signInAnonymously as firebaseSignInAnonymously, type Auth } from "firebase/auth";
// Metro `firebase/auth` → RN girişi; tarayıcı tip dosyasında export görünmeyebilir.
// @ts-expect-error RN bundle
import { getReactNativePersistence } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";

let appSingleton: FirebaseApp | null = null;
let authSingleton: Auth | null = null;
let dbSingleton: Firestore | null = null;

/** Paralel signInAnonymously çağrılarını tek sıraya alır (auth/too-many-requests riskini azaltır). */
let ensureAuthInFlight: Promise<void> | null = null;

export function isFirebaseConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() && process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim());
}

function readFirebaseConfig() {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() || "";
  const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "";
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "";
  const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "";
  const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || "";
  const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() || "";
  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

export function getFirebaseApp(): FirebaseApp {
  if (appSingleton) return appSingleton;
  const c = readFirebaseConfig();
  if (!c.projectId || !c.apiKey) {
    const missing: string[] = [];
    if (!c.apiKey) missing.push("EXPO_PUBLIC_FIREBASE_API_KEY");
    if (!c.projectId) missing.push("EXPO_PUBLIC_FIREBASE_PROJECT_ID");
    throw new Error(`Firebase yapılandırması eksik (${missing.join(", ")}).`);
  }
  if (!getApps().length) {
    appSingleton = initializeApp({
      apiKey: c.apiKey,
      authDomain: c.authDomain || undefined,
      projectId: c.projectId,
      storageBucket: c.storageBucket || undefined,
      messagingSenderId: c.messagingSenderId || undefined,
      appId: c.appId || undefined,
    });
  } else {
    appSingleton = getApp();
  }
  return appSingleton;
}

export function getFirebaseAuth(): Auth {
  if (authSingleton) return authSingleton;
  const app = getFirebaseApp();
  try {
    authSingleton = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    authSingleton = getAuth(app);
  }
  return authSingleton;
}

export function getFirebaseFirestore(): Firestore {
  if (dbSingleton) return dbSingleton;
  const app = getFirebaseApp();
  try {
    dbSingleton = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      ignoreUndefinedProperties: true,
    });
  } catch {
    dbSingleton = getFirestore(app);
  }
  return dbSingleton;
}

function authErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: string }).code).toLowerCase() : "";
}

function buildAnonAuthFailureMessage(lastErr: unknown): string {
  const code = authErrorCode(lastErr);
  const hint =
    code.includes("admin-restricted-operation") || code.includes("operation-not-allowed")
      ? " Firebase Console → Authentication → Sign-in method → Anonymous’i açıp Kaydet’e basın (mobil mesaj/yorum için zorunlu)."
      : code
        ? ` (${code})`
        : "";
  return `Firebase anonim oturum açılamadı.${hint}`;
}

/** Bu hatalarda tekrar denemek zaman kaybıdır (ör. Anonymous kapalı veya proje kısıtlı). */
function isNonRetryableAnonymousError(code: string): boolean {
  const c = code.toLowerCase();
  return (
    c.includes("admin-restricted-operation") ||
    c.includes("operation-not-allowed") ||
    c.includes("auth/operation-not-allowed")
  );
}

async function runAnonymousSignInAttempts(auth: Auth): Promise<void> {
  const ready = auth as Auth & { authStateReady?: () => Promise<void> };
  let lastErr: unknown;
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await firebaseSignInAnonymously(auth);
      if (auth.currentUser) return;
    } catch (e) {
      lastErr = e;
      const code = authErrorCode(e);
      if (isNonRetryableAnonymousError(code)) {
        throw new Error(buildAnonAuthFailureMessage(e));
      }
      const slow = code.includes("too-many-requests") || code.includes("network-request-failed");
      const delayMs = slow ? Math.min(8000, 1500 * (attempt + 1)) : 350 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  if (typeof ready.authStateReady === "function") {
    await ready.authStateReady();
  }
  if (auth.currentUser) return;
  throw new Error(buildAnonAuthFailureMessage(lastErr));
}

/**
 * Kalıcılıktan oturum yüklendikten sonra tek seferlik (sıralı) anonim giriş.
 * Firestore kuralları `request.auth != null` istediği için oturumsuz AsyncStorage anahtarı ile yazılamaz.
 */
export async function ensureFirestoreAuthReady(): Promise<void> {
  const auth = getFirebaseAuth();
  const ready = auth as Auth & { authStateReady?: () => Promise<void> };
  if (typeof ready.authStateReady === "function") {
    await ready.authStateReady();
  }
  if (auth.currentUser) return;

  if (!ensureAuthInFlight) {
    ensureAuthInFlight = (async () => {
      const a = getFirebaseAuth();
      const r = a as Auth & { authStateReady?: () => Promise<void> };
      if (typeof r.authStateReady === "function") {
        await r.authStateReady();
      }
      if (!a.currentUser) {
        await runAnonymousSignInAttempts(a);
      }
    })().finally(() => {
      ensureAuthInFlight = null;
    });
  }

  await ensureAuthInFlight;

  if (typeof ready.authStateReady === "function") {
    await ready.authStateReady();
  }
  if (!auth.currentUser) {
    throw new Error(buildAnonAuthFailureMessage(undefined));
  }
}

/**
 * Cüzdan / portföy senkronu vb. — Firestore yazmadan önce gerçek Firebase kullanıcısı olmalı.
 */
export async function ensureAnonymousFirebaseUser(): Promise<string> {
  await ensureFirestoreAuthReady();
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) throw new Error("Firebase oturumu açılamadı.");
  return uid;
}

/**
 * Firestore `chatByUid/{uid}` ve benzeri yollar `request.auth.uid == uid` bekler; yalnızca gerçek auth uid döner.
 */
export async function resolveFirestoreActorKey(): Promise<string> {
  const auth = getFirebaseAuth();
  const currentUid = auth.currentUser?.uid;
  if (currentUid) return currentUid;
  await ensureFirestoreAuthReady();
  const uid = auth.currentUser?.uid;
  if (uid) return uid;
  throw new Error("Firebase oturumu gerekli; mesaj ve yorumlar için anonim giriş yapılamadı.");
}
