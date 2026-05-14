import type { ImageSourcePropType } from "react-native";

/** Yerleşik logo fallback (SVG data URI). WebView / HTML çıktıları için. */
export const BRAND_LOGO_DATA_URI =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%231f3a8a'/%3E%3Cstop offset='100%25' stop-color='%232563eb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x='8' y='8' width='204' height='204' rx='40' fill='url(%23g)'/%3E%3Ctext x='110' y='130' text-anchor='middle' font-size='76' font-family='Arial,sans-serif' font-weight='700' fill='white'%3EFS%3C/text%3E%3C/svg%3E";

// Proje kökündeki logo/app-icon.png — APK/AAB ve giriş ekranı ile aynı dosya (Expo app.json icon ile uyumlu).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOCAL_BRAND_LOGO_PNG = require("../../logo/app-icon.png") as number;

export function resolveBrandLogoUri(rawUrl?: string): string {
  const raw = (rawUrl || "").trim();
  if (!raw) return BRAND_LOGO_DATA_URI;
  const ok = /^(https?:\/\/|data:|file:|content:|asset:)/i.test(raw);
  return ok ? raw : BRAND_LOGO_DATA_URI;
}

/**
 * React Native <Image source={...} /> için paketlenmiş `logo/app-icon.png`.
 * `.env` içindeki EXPO_PUBLIC_LOGO_URL çoğu kurulumda geçersiz/404 kalabildiği için
 * giriş ve profil yedek görselinde uzak URL kullanılmaz (PDF/WebView için `resolveBrandLogoUri` ayrı).
 */
export function resolveBrandLogoImageSource(_rawUrl?: string): ImageSourcePropType {
  return LOCAL_BRAND_LOGO_PNG;
}
