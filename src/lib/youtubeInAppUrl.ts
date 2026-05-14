import { WEBVIEW_DESKTOP_CHROME_UA, WEBVIEW_YOUTUBE_MOBILE_UA } from "./webviewChromeUserAgent";

/** 11 karakter video kimliği (canlı yayın da aynı ID ile watch sayfasında açılır). */
const VIDEO_ID_RE = /^[\w-]{11}$/;

/**
 * Embed (yalnızca `live_stream?channel=` gibi watch’a dönmeyen durumlar) — parametreler WebView için.
 */
function appendYoutubeEmbedPlaybackParams(embedUrl: string): string {
  try {
    const u = new URL(embedUrl);
    const p = u.searchParams;
    if (!p.has("playsinline")) p.set("playsinline", "1");
    if (!p.has("autoplay")) p.set("autoplay", "1");
    if (!p.has("mute")) p.set("mute", "1");
    if (!p.has("controls")) p.set("controls", "1");
    if (!p.has("rel")) p.set("rel", "0");
    if (!p.has("modestbranding")) p.set("modestbranding", "1");
    if (!p.has("iv_load_policy")) p.set("iv_load_policy", "3");
    if (!p.has("fs")) p.set("fs", "1");
    if (!p.has("enablejsapi")) p.set("enablejsapi", "1");
    if (!p.has("origin")) p.set("origin", "https://www.youtube.com");
    return u.toString();
  } catch {
    return embedUrl;
  }
}

/** Tarayıcıdaki gibi mobil oynatıcı sayfası — WebView’da embed’den çok daha stabil. */
function mobileWatchFromVideoId(id: string): string {
  return `https://m.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

function buildYoutubeIframeDocument(embedSrc: string): string {
  const src = escapeAttr(embedSrc);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"/>
<style>html,body{margin:0;padding:0;height:100%;background:#000}</style>
</head><body style="margin:0">
<iframe src="${src}" title="YouTube" style="position:fixed;inset:0;width:100%;height:100%;border:0"
allow="${IFRAME_ALLOW}" allowfullscreen="allowfullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body></html>`;
}

/**
 * YouTube’u uygulama içinde, sitedeki gibi **mobil watch / live** sayfasına yönlendirir (embed değil).
 * Embed çoğu cihazda “Video kullanılamıyor” / boş ekran verir; WebView gerçek tarayıcı değildir.
 */
export function youtubeInAppUrl(url: string): string {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return u;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return u;
  }

  const host = parsed.hostname.replace(/^www\./i, "");
  const isYt =
    host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  if (!isYt) return u;

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    if (id && VIDEO_ID_RE.test(id)) return mobileWatchFromVideoId(id);
    return u;
  }

  const v = parsed.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return mobileWatchFromVideoId(v);

  const liveM = parsed.pathname.match(/^\/live\/([^/]+)/i);
  if (liveM) {
    const id = liveM[1];
    if (id && VIDEO_ID_RE.test(id)) return mobileWatchFromVideoId(id);
  }

  if (/\/embed\//i.test(u)) {
    const em = parsed.pathname.match(/\/embed\/([^/]+)/i);
    if (em) {
      const seg = em[1];
      if (seg === "live_stream") {
        return appendYoutubeEmbedPlaybackParams(`https://www.youtube.com/embed/live_stream${parsed.search || ""}`);
      }
      if (VIDEO_ID_RE.test(seg)) return mobileWatchFromVideoId(seg);
    }
    return appendYoutubeEmbedPlaybackParams(u.split("#")[0]);
  }

  const at = u.match(/youtube\.com\/@([^/?#]+)/i);
  if (at) {
    const h = at[1];
    return `https://m.youtube.com/@${encodeURIComponent(h)}/live`;
  }

  const ch = u.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (ch) {
    const id = ch[1];
    if (id.startsWith("UC") && id.length >= 22) return `https://m.youtube.com/channel/${encodeURIComponent(id)}/live`;
  }

  return u;
}

export type HaberWebViewResolved = {
  source: { uri: string } | { html: string; baseUrl: string };
  userAgent: string;
};

function isYoutubeWebUri(uri: string): boolean {
  try {
    const h = new URL(uri).hostname.replace(/^www\./i, "");
    return h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be" || h === "music.youtube.com";
  } catch {
    return false;
  }
}

/**
 * YouTube: mobil UA + doğrudan `m.youtube.com` watch/live (sitedeki gibi).
 * Yalnızca `embed/live_stream` iframe ile yüklenir (watch URL’si yok).
 */
export function resolveHaberWebViewPlayback(uri: string): HaberWebViewResolved {
  const normalized = youtubeInAppUrl(uri.trim());

  if (/\/embed\/live_stream/i.test(normalized)) {
    const withParams = appendYoutubeEmbedPlaybackParams(normalized.split("#")[0]);
    return {
      source: { html: buildYoutubeIframeDocument(withParams), baseUrl: "https://www.youtube.com" },
      userAgent: WEBVIEW_YOUTUBE_MOBILE_UA,
    };
  }

  if (isYoutubeWebUri(normalized)) {
    return { source: { uri: normalized }, userAgent: WEBVIEW_YOUTUBE_MOBILE_UA };
  }

  return { source: { uri: normalized }, userAgent: WEBVIEW_DESKTOP_CHROME_UA };
}
