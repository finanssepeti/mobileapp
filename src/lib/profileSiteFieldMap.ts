import type { StoredProfile } from "./profileStorage";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Firestore / web’den gelen dil değerini güvenli eşle (startsWith hatası: "default" → de). */
function mapLocaleToDil(raw: string): StoredProfile["dil"] | null {
  const n = raw.trim().toLowerCase();
  const seg = (n.split(/[-_]/)[0] ?? "").trim();
  if (seg === "tr" || seg === "tur" || n === "turkish" || n === "türkçe") return "tr";
  if (seg === "en" || seg === "eng" || n === "english") return "en";
  if (seg === "de" || seg === "deu" || n === "deutsch" || n === "german") return "de";
  if (seg === "fr" || seg === "fra" || seg === "fre" || n === "french" || n === "français" || n === "francais") return "fr";
  return null;
}

const GIZ_KEYS: StoredProfile["gizlilik"][] = ["herkese_acik", "sadece_takipciler", "gizli"];

/**
 * Web + mobil belgelerinden ayar alanlarını okunur değerlere çevirir (finansepeti.net ile uyum).
 */
export function normalizeDocAccountSettings(raw: Record<string, unknown>): Partial<Pick<StoredProfile, "gizlilik" | "dil" | "siteGorunumu">> {
  const out: Partial<Pick<StoredProfile, "gizlilik" | "dil" | "siteGorunumu">> = {};

  const gizRaw = pickString(raw, ["gizlilik", "profilePrivacy", "privacy"]);
  if (gizRaw) {
    const g = gizRaw.toLowerCase();
    if (GIZ_KEYS.includes(g as StoredProfile["gizlilik"])) {
      out.gizlilik = g as StoredProfile["gizlilik"];
    } else if (g === "public" || g === "herkese" || g === "everyone") {
      out.gizlilik = "herkese_acik";
    } else if (g === "followers" || g === "takipciler") {
      out.gizlilik = "sadece_takipciler";
    } else if (g === "private" || g === "hidden" || g === "none") {
      out.gizlilik = "gizli";
    }
  }

  const langRaw = pickString(raw, ["dil", "language", "lang", "locale"]);
  if (langRaw) {
    const mapped = mapLocaleToDil(langRaw);
    if (mapped) out.dil = mapped;
  }

  const themeRaw = pickString(raw, ["siteGorunumu", "siteTheme", "theme", "appearance", "colorMode"]);
  if (themeRaw) {
    const n = themeRaw.toLowerCase();
    if (n === "acik" || n === "light" || n === "aydinlik" || n === "bright") out.siteGorunumu = "acik";
    else if (n === "koyu" || n === "dark" || n === "karanlik") out.siteGorunumu = "koyu";
  }

  return out;
}

/**
 * Üç koleksiyona aynı anda yazılacak gövde: mobil alanlar + web’de arama/görüntüleme için yansıma alanları.
 */
export function buildSiteMirroredWritePayload(profile: StoredProfile, uid: string): Record<string, unknown> {
  return {
    ...profile,
    userId: uid,
    uid,
    updatedAtMs: Date.now(),
    language: profile.dil,
    siteTheme: profile.siteGorunumu === "acik" ? "light" : "dark",
  };
}
