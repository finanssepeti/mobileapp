import { doc, getDoc } from "firebase/firestore";
import { DEFAULT_HABER_CONFIG, type HaberConfigData } from "./haberConfigData";
import { getFirebaseFirestore, isFirebaseConfigured } from "./firebaseClient";

/**
 * Opsiyonel: Firestore `app_config/haberler` belgesi.
 * Şema: { ulusalGazete?, globalGazete?, ulusalTv?, globalTv? } — haberConfigData ile aynı yapı.
 * Okuma kuralları reddederse sessizce varsayılan kullanılır.
 */
function cloneDefaultHaberConfig(): HaberConfigData {
  return {
    ulusalGazete: [...DEFAULT_HABER_CONFIG.ulusalGazete],
    globalGazete: [...DEFAULT_HABER_CONFIG.globalGazete],
    ulusalTv: [...DEFAULT_HABER_CONFIG.ulusalTv],
    globalTv: [...DEFAULT_HABER_CONFIG.globalTv],
  };
}

export async function loadHaberConfig(): Promise<HaberConfigData> {
  let base = cloneDefaultHaberConfig();

  const envJson = (process.env.EXPO_PUBLIC_HABER_CONFIG_JSON ?? "").trim();
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Partial<HaberConfigData>;
      base = mergeHaberConfig(base, parsed);
    } catch {
      /* yoksay */
    }
  }

  if (!isFirebaseConfigured()) return base;

  try {
    const db = getFirebaseFirestore();
    const snap = await getDoc(doc(db, "app_config", "haberler"));
    if (snap.exists()) {
      const data = snap.data() as Partial<HaberConfigData>;
      base = mergeHaberConfig(base, data);
    }
  } catch {
    /* izin yok veya ağ */
  }

  return base;
}

function mergeHaberConfig(a: HaberConfigData, b: Partial<HaberConfigData>): HaberConfigData {
  return {
    ulusalGazete: Array.isArray(b.ulusalGazete) && b.ulusalGazete.length ? b.ulusalGazete : a.ulusalGazete,
    globalGazete: Array.isArray(b.globalGazete) && b.globalGazete.length ? b.globalGazete : a.globalGazete,
    ulusalTv: Array.isArray(b.ulusalTv) && b.ulusalTv.length ? b.ulusalTv : a.ulusalTv,
    globalTv: Array.isArray(b.globalTv) && b.globalTv.length ? b.globalTv : a.globalTv,
  };
}
