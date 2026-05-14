/**
 * Arka plan push bildirimleri (Expo Push + FCM üzerinden).
 * Kurulum: `eas init` ile proje oluşturun, `EXPO_PUBLIC_EAS_PROJECT_ID` .env içine yazın;
 * ardından `firebase/functions` içindeki Cloud Function'ı deploy edin.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { isRunningInExpoGo } from "expo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { doc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { ensureFirestoreAuthReady, getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";
import { resolveCommentActor } from "./commentsFirestore";

const DEVICE_ID_KEY = "@finansepeti_push_device_id_v1";
const ANDROID_CHANNEL_ID = "finansepeti_default";

/**
 * SDK 53+ ile Android Expo Go’da uzak push kaldırıldı; `getExpoPushTokenAsync` çağrılırsa
 * expo-notifications `console.error` ile tam ekran uyarı basıyor.
 * `appOwnership` güvenilir olmayabiliyor; resmi `isRunningInExpoGo()` kullan.
 */
function isAndroidExpoGoNoRemotePush(): boolean {
  return Platform.OS === "android" && isRunningInExpoGo();
}

/** İlk importta çağrılmalı: bildirim davranışı + Android kanalı */
let runtimeInited = false;

export function initPushNotificationRuntime(): void {
  if (isAndroidExpoGoNoRemotePush()) {
    return;
  }
  if (runtimeInited) return;
  runtimeInited = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  void (async () => {
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: "FinansSepeti",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          sound: "default",
          enableVibrate: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      } catch {
        /* FCM yapılandırması yoksa veya Expo Go kısıtı — sessiz geç */
      }
    }
  })();
}

function randomDeviceId(): string {
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

export async function getOrCreatePushDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing?.trim()) return existing.trim();
    const id = randomDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return randomDeviceId();
  }
}

function resolveExpoProjectId(): string | undefined {
  const fromConstants =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  return fromConstants || fromEnv || undefined;
}

/**
 * Oturum açıkken Expo push token alır ve Firestore'a yazar (Cloud Function ile eşleşir).
 */
export async function registerPushForCurrentUser(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  if (isAndroidExpoGoNoRemotePush()) return;
  initPushNotificationRuntime();

  if (!Device.isDevice) return;

  try {
    await ensureFirestoreAuthReady();
  } catch {
    return;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return;

  const easProjectId = resolveExpoProjectId();
  let expoPushToken: string;
  try {
    const tokenRes = easProjectId
      ? await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })
      : await Notifications.getExpoPushTokenAsync();
    expoPushToken = tokenRes.data;
  } catch (e) {
    if (__DEV__) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[push] getExpoPushTokenAsync:", msg);
    }
    return;
  }

  let socialUserId: string;
  try {
    const actor = await resolveCommentActor();
    socialUserId = actor.socialUserId;
  } catch {
    return;
  }

  if (!socialUserId) return;

  const deviceId = await getOrCreatePushDeviceId();
  const db = getFirebaseFirestore();
  const auth = getFirebaseAuth();

  await setDoc(
    doc(db, "userPushTokens", socialUserId, "devices", deviceId),
    {
      expoPushToken,
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
      authUid: auth.currentUser?.uid ?? null,
    },
    { merge: true },
  );
}

/**
 * Çıkışta cihaz kaydını sil — başka cihazlara dokunmaz.
 */
export async function removePushDeviceForCurrentUser(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await ensureFirestoreAuthReady();
  } catch {
    return;
  }
  let socialUserId: string;
  try {
    const actor = await resolveCommentActor();
    socialUserId = actor.socialUserId;
  } catch {
    return;
  }
  const deviceId = await getOrCreatePushDeviceId();
  const db = getFirebaseFirestore();
  try {
    await deleteDoc(doc(db, "userPushTokens", socialUserId, "devices", deviceId));
  } catch {
    /* ignore */
  }
}

export { ANDROID_CHANNEL_ID };
