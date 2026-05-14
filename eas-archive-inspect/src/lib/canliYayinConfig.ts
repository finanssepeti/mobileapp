/**
 * finanssepeti.net canlı yayın sayfası — WebView için geçerli tam HTTPS URL üretir.
 * EXPO_PUBLIC_CANLI_YAYINLARIM_URL hatalıysa (yalnız slug, /path, boş host) güvenli varsayılana düşer.
 */

import { Platform } from "react-native";

const SITE_ORIGIN = "https://finanssepeti.net";
/** Logo vb. ile aynı kök; bazı cihazlarda bare domain çözülmediği için www kullanılır. */
export const DEFAULT_CANLI_YAYINLARIM_URL = `${SITE_ORIGIN}/canliyayin`;

function isGarbageEnv(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "" || s === "undefined" || s === "null" || s === "0";
}

function normalizeCanliPath(pathname: string): string {
  const lowered = pathname.toLocaleLowerCase("tr-TR");
  const plain = lowered
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
  if (plain === "/canliyayin" || plain === "/canli-yayin" || plain === "/canli-yayinlarim") {
    return "/canliyayin";
  }
  return pathname;
}

/**
 * Kullanıcı veya .env değerini her zaman mutlak https URL’ye çevirir.
 */
export function resolveCanliYayinlarimUrl(rawFromEnv: string | undefined): string {
  const raw0 = rawFromEnv?.trim();
  if (!raw0 || isGarbageEnv(raw0)) return DEFAULT_CANLI_YAYINLARIM_URL;

  try {
    // Sadece yol: /canli-yayin veya /tr/...
    if (raw0.startsWith("/")) {
      const u = new URL(raw0, SITE_ORIGIN);
      u.pathname = normalizeCanliPath(u.pathname);
      return u.href.replace(/\/+$/, "") || DEFAULT_CANLI_YAYINLARIM_URL;
    }

    // Protokollsuz "alan.ad/yol"
    const withScheme = raw0.includes("://") ? raw0 : `https://${raw0}`;
    let u = new URL(withScheme);
    let host = (u.hostname || "").replace(/\.+$/g, "");

    // "https:///path" → host boş
    if (!host || host.length < 3) {
      u = new URL(u.pathname || "/", SITE_ORIGIN);
      host = u.hostname;
    }

    // Tek kelime slug (ör. canli-yayinlarim yazılmış, nokta yok): site üzerinde yol say
    if (!raw0.includes("://") && !raw0.includes("/") && !raw0.includes(".")) {
      u = new URL(`/${encodeURI(raw0)}`, SITE_ORIGIN);
      u.pathname = normalizeCanliPath(u.pathname);
      return u.href.replace(/\/+$/, "") || DEFAULT_CANLI_YAYINLARIM_URL;
    }

    if (!host || host.length < 3) return DEFAULT_CANLI_YAYINLARIM_URL;

    u.pathname = normalizeCanliPath(u.pathname);
    const out = u.href.replace(/\/+$/, "");
    return out.startsWith("http://") || out.startsWith("https://") ? out : DEFAULT_CANLI_YAYINLARIM_URL;
  } catch {
    return DEFAULT_CANLI_YAYINLARIM_URL;
  }
}

export function getCanliYayinlarimPageUrl(): string {
  return resolveCanliYayinlarimUrl(process.env.EXPO_PUBLIC_CANLI_YAYINLARIM_URL);
}

/** Varsayılan halka açık Jitsi Meet; kurumsal sunucunuz varsa EXPO_PUBLIC_JITSI_MEET_BASE_URL */
const DEFAULT_JITSI_MEET_BASE = "https://meet.jit.si";
export const DEFAULT_JITSI_SERVER_URL = DEFAULT_JITSI_MEET_BASE;

/**
 * Jitsi oda adı: yalnız güvenli karakterler (yol segmenti için).
 */
export function sanitizeJitsiRoomName(room: string): string {
  const s = room.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (s || "FinansSepeti-Yayin").slice(0, 200);
}

/**
 * Jitsi Meet web arayüzü — uygulama içi WebView’da tam ekran açılır (tarayıcı dışına çıkmaz).
 * @displayName Ön yüz / toplantı adı olarak Jitsi’ye iletilir.
 *
 * Ön katılım kapalı ve derin bağlantılar kısmen devre dışı: mobilde gereksiz yönlendirmeler/Gmail ile
 * giriş ekranına itme azalır. (Google OAuth yine WebView içinde bloklanır; kullanıcı misafir olarak kalmalı.)
 */
export function buildJitsiMeetWebUrl(roomName: string, displayName: string): string {
  const base = (process.env.EXPO_PUBLIC_JITSI_MEET_BASE_URL?.trim() || DEFAULT_JITSI_MEET_BASE).replace(
    /\/+$/,
    "",
  );
  const room = sanitizeJitsiRoomName(roomName);
  const dn = encodeURIComponent((displayName || "Katılımcı").trim().slice(0, 72) || "Katılımcı");
  const hash = [
    `userInfo.displayName=${dn}`,
    "config.prejoinConfig.enabled=false",
    "config.deeplinking.disabled=true",
    "config.enableWelcomePage=false",
    "config.disableThirdPartyRequests=true",
    "config.startWithVideoMuted=false",
    "config.startWithAudioMuted=false",
    "config.disableInitialGUM=false",
  ].join("&");

  return `${base}/${room}#${hash}`;
}

export function getJitsiServerUrl(): string {
  return (process.env.EXPO_PUBLIC_JITSI_MEET_BASE_URL?.trim() || DEFAULT_JITSI_SERVER_URL).replace(/\/+$/, "");
}

/** Yayın odası kimliği (sitedeki "Oda: Canli-…" desenine benzer) */
export function buildDefaultLiveRoomId(userSessionKey: string): string {
  const k = sanitizeJitsiRoomName(userSessionKey).replace(/^-+|-+$/g, "") || "kullanici";
  return `Canli-${k}-${Date.now()}`;
}

/**
 * Mobil tarayıcıya yakın UA (meet.jit.si uyumu + gereksiz “masaüstü”/Google akışı azaltma).
 * Android’de `; wv` içermez — bazı bloklar daha az tetiklenebilir; Google OAuth gömülü WebView’da yine güvenilir değildir.
 */
export function getCanliYayinWebViewUserAgent(): string {
  if (Platform.OS === "ios") {
    return "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  }
  return "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
}

/** @deprecated use getCanliYayinWebViewUserAgent() */
export const CANLI_YAYIN_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
