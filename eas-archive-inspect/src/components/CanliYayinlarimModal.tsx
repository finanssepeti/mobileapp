import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { JitsiNativeMeeting } from "./JitsiNativeMeeting";
import { getSessionUserKey } from "../lib/authSession";
import {
  buildDefaultLiveRoomId,
  buildJitsiMeetWebUrl,
  getJitsiServerUrl,
  getCanliYayinWebViewUserAgent,
  getCanliYayinlarimPageUrl,
} from "../lib/canliYayinConfig";
import { loadProfile } from "../lib/profileStorage";
import { useAppTheme } from "../theme/ThemeProvider";

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Phase = "home" | "live";

const HOME_BG = "#050a18";
const HOME_CARD_BG = "#0c1b36";
const HOME_CARD_BORDER = "#2563eb";
const LIVE_ACTION_BLUE = "#2563eb";

function truncateRoom(label: string, max = 52): string {
  if (label.length <= max) return label;
  return `${label.slice(0, 34)}…${label.slice(-12)}`;
}

/** Google Gmail/hesap ile oturum, gömülü WebView’da güvenlik nedeniyle desteklenmez (kullanıcı “e‑posta hatası” sansa da). */
function isEmbeddedGoogleOAuthUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    const pathQ = `${u.pathname}${u.search}`;
    if (h === "accounts.google.com" || h.endsWith(".accounts.google.com")) return true;
    if (h === "oauth2.googleapis.com") return true;
    if (h === "www.google.com" || h === "google.com") {
      return /\/oauth|\/accounts\/signin|ServiceLogin|\/signin\//i.test(pathQ);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Yerel giriş ekranı + uygulama içi Jitsi Meet (WebView). Tarayıcıya çıkmadan video akışı.
 */
export function CanliYayinlarimModal({ visible, onClose }: Props) {
  const { palette } = useAppTheme();
  const sitePortalUrl = useMemo(() => getCanliYayinlarimPageUrl(), []);

  const [phase, setPhase] = useState<Phase>("home");
  const [displayName, setDisplayName] = useState("Katılımcı");
  const [roomId, setRoomId] = useState("");
  const [jitsiUri, setJitsiUri] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [oauthBlocked, setOauthBlocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [liveMode, setLiveMode] = useState<"native" | "web">("web");

  useEffect(() => {
    if (!visible) {
      setPhase("home");
      setJitsiUri(null);
      setRoomId("");
      setLoadErr(null);
      setStarting(false);
      setOauthBlocked(false);
      setAuthRequired(false);
      setLiveMode("web");
      return;
    }
    let cancelled = false;
    void (async () => {
      const p = await loadProfile();
      if (cancelled) return;
      const n = (p.adSoyad || p.kullaniciAdi || "").trim();
      setDisplayName(n || "Katılımcı");
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const isExpoGo =
    Constants.executionEnvironment === "storeClient" ||
    Constants.appOwnership === "expo" ||
    Constants.appOwnership === null;
  const preferNativeJitsi = !isExpoGo;
  const jitsiServerUrl = useMemo(() => getJitsiServerUrl(), []);

  const startBroadcast = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setLoadErr(null);
    try {
      const userKey = await getSessionUserKey();
      const room = buildDefaultLiveRoomId(userKey);
      const name = displayName.trim() || "Katılımcı";
      const url = buildJitsiMeetWebUrl(room, name);
      setRoomId(room);
      setJitsiUri(url);
      setLiveMode(preferNativeJitsi ? "native" : "web");
      setRetryNonce((k) => k + 1);
      setPhase("live");
    } catch {
      setLoadErr("Yayın başlatılamadı. Tekrar deneyin.");
    } finally {
      setStarting(false);
    }
  }, [starting, displayName]);

  const goBackHome = useCallback(() => {
    setPhase("home");
    setJitsiUri(null);
    setRoomId("");
    setLoadErr(null);
    setOauthBlocked(false);
    setAuthRequired(false);
    setLiveMode("web");
  }, []);

  const reloadJitsi = useCallback(() => {
    setOauthBlocked(false);
    setAuthRequired(false);
    setLoadErr(null);
    setRetryNonce((k) => k + 1);
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeHome: {
          flex: 1,
          backgroundColor: HOME_BG,
          justifyContent: "center",
          paddingHorizontal: 18,
          paddingVertical: 16,
        },
        safeLive: { flex: 1, backgroundColor: palette.background },
        homeScroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 12 },
        homeCard: {
          width: "100%",
          maxWidth: 420,
          alignSelf: "center",
          borderRadius: 18,
          borderWidth: 2,
          borderColor: HOME_CARD_BORDER,
          backgroundColor: HOME_CARD_BG,
          paddingHorizontal: 18,
          paddingVertical: 20,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 10,
        },
        homeTitleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
        },
        waveIconWrap: {
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: "rgba(255,255,255,0.06)",
          alignItems: "center",
          justifyContent: "center",
        },
        waveIconTxt: { fontSize: 20 },
        homeTitleTxt: {
          flex: 1,
          flexShrink: 1,
          color: "#f8fafc",
          fontSize: 21,
          fontWeight: "800",
          letterSpacing: -0.3,
        },
        closeGhost: {
          width: 40,
          height: 40,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.18)",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.2)",
        },
        closeGhostTxt: { color: "#e2e8f0", fontSize: 18, fontWeight: "700", marginTop: -2 },
        startBtn: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: LIVE_ACTION_BLUE,
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          marginBottom: 16,
          minHeight: 48,
          opacity: 1,
        },
        startBtnDisabled: { opacity: 0.55 },
        startBtnEmoji: { fontSize: 16 },
        startBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "900" },
        infoCard: {
          backgroundColor: "rgba(255,255,255,0.05)",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          padding: 13,
          marginBottom: 14,
        },
        infoCardTxt: { color: "#cbd5f5", fontSize: 13, lineHeight: 20, fontWeight: "600" },
        infoBold: { color: "#fff", fontWeight: "900" },
        footerLink: { paddingVertical: 8 },
        footerLinkTxt: {
          color: "#93c5fd",
          fontSize: 13,
          fontWeight: "700",
          textAlign: "center",
          textDecorationLine: "underline",
        },
        liveHeader: {
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: "#0a1733",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(148,163,184,0.25)",
          gap: 6,
        },
        liveMiniIcon: {
          width: 36,
          alignItems: "center",
          justifyContent: "center",
        },
        liveTitleBlock: {
          flex: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        liveTitleMain: {
          color: "#f1f5f9",
          fontSize: 15,
          fontWeight: "900",
        },
        liveTitleRoom: {
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: "600",
          marginTop: 4,
        },
        liveHangup: {
          width: 40,
          height: 38,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(248,113,113,0.6)",
          backgroundColor: "rgba(127,29,29,0.45)",
        },
        liveHangupTxt: {
          color: "#fecaca",
          fontSize: 15,
          fontWeight: "800",
          marginTop: -2,
        },
        liveBanner: {
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: "#0f1c3d",
        },
        liveBannerTxt: {
          color: palette.textMuted,
          fontSize: 11,
          fontWeight: "600",
          lineHeight: 15,
        },
        nativeHint: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: "rgba(37,99,235,0.14)",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(59,130,246,0.25)",
        },
        nativeHintTxt: {
          color: "#bfdbfe",
          fontSize: 11,
          fontWeight: "700",
          lineHeight: 16,
        },
        oauthBanner: {
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: "rgba(180, 83, 9, 0.22)",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(251, 191, 36, 0.35)",
        },
        oauthBannerTitle: {
          color: "#fde68a",
          fontSize: 12,
          fontWeight: "900",
          marginBottom: 4,
        },
        oauthBannerBody: {
          color: "#fef3c7",
          fontSize: 11,
          fontWeight: "600",
          lineHeight: 16,
          marginBottom: 10,
        },
        oauthReloadBtn: {
          alignSelf: "flex-start",
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: LIVE_ACTION_BLUE,
        },
        oauthReloadTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },
        authBanner: {
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: "rgba(239, 68, 68, 0.16)",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(248, 113, 113, 0.35)",
        },
        authBannerTitle: {
          color: "#fecaca",
          fontSize: 12,
          fontWeight: "900",
          marginBottom: 4,
        },
        authBannerBody: {
          color: "#fee2e2",
          fontSize: 11,
          fontWeight: "600",
          lineHeight: 16,
          marginBottom: 10,
        },
        web: { flex: 1, backgroundColor: "#010409" },
        errBox: {
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 20,
          padding: 14,
          borderRadius: 12,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
        },
        errTitle: { color: palette.text, fontSize: 14, fontWeight: "800", marginBottom: 6 },
        errBody: { color: palette.textMuted, fontSize: 12, marginBottom: 12 },
        errRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
        errBtn: {
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 10,
          backgroundColor: palette.accent,
        },
        errBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
        errBtn2: {
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.background,
        },
        errBtn2Text: { color: palette.accent, fontSize: 13, fontWeight: "800" },
      }),
    [palette.surface, palette.border, palette.text, palette.background, palette.textMuted, palette.accent],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {phase === "home" ? (
        <SafeAreaView style={styles.safeHome} edges={["top", "bottom", "left", "right"]}>
          <ScrollView
            contentContainerStyle={styles.homeScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.homeCard}>
              <View style={styles.homeTitleRow}>
                <View style={styles.waveIconWrap}>
                  <Text style={styles.waveIconTxt} accessibilityLabel="Canlı yayın">
                    📡
                  </Text>
                </View>
                <Text style={styles.homeTitleTxt}>Canlı Yayınlarım</Text>
                <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeGhost}>
                  <Text style={styles.closeGhostTxt}>✕</Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yayını başlat"
                onPress={() => void startBroadcast()}
                style={[styles.startBtn, starting && styles.startBtnDisabled]}
                disabled={starting}
              >
                {starting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.startBtnEmoji}>📹</Text>
                    <Text style={styles.startBtnTxt}>Yayını Başlat</Text>
                  </>
                )}
              </Pressable>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTxt}>
                  Önce <Text style={styles.infoBold}>Yayını Başlat</Text> ile Jitsi odasına girin. Kamera ve
                  mikrofon izni istenebilir. Davet ve site içi bildirimler için{" "}
                  <Text style={styles.infoBold}>FinansSepeti web</Text> hesabınızı kullanın.
                </Text>
              </View>

              <Pressable
                style={styles.footerLink}
                onPress={() => void Linking.openURL(sitePortalUrl)}
                accessibilityRole="link"
              >
                <Text style={styles.footerLinkTxt}>Davet için web’de tam ekranı aç</Text>
              </Pressable>

              <Pressable style={styles.footerLink} onPress={onClose} accessibilityRole="button">
                <Text style={[styles.footerLinkTxt, { textDecorationLine: "none", color: "#64748b" }]}>
                  ← Kapat
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      ) : (
        <SafeAreaView style={styles.safeLive} edges={["top", "left", "right"]}>
          <View style={styles.liveHeader}>
            <Pressable style={styles.liveMiniIcon} onPress={goBackHome} accessibilityLabel="Önceki">
              <Text style={{ color: LIVE_ACTION_BLUE, fontSize: 22, fontWeight: "900" }}>‹</Text>
            </Pressable>
            <View style={{ flexShrink: 0, marginRight: 4 }}>
              <Text style={{ fontSize: 18 }}>📡</Text>
            </View>
            <View style={styles.liveTitleBlock}>
              <Text style={styles.liveTitleMain}>Canlı Yayın</Text>
              <Text style={styles.liveTitleRoom} selectable={__DEV__} numberOfLines={2}>
                Oda: {truncateRoom(roomId)}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Kapat" style={styles.liveHangup}>
              <Text style={styles.liveHangupTxt}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.liveBanner}>
            <Text style={styles.liveBannerTxt}>
              Jitsi toplantı ekranı aşağıdadır — uygulama içindedir. Google / Gmail ile oturum açmayın; adınız
              yukarıdaki oda bağlantısında zaten ayarlanır. Gerekirse “Tarayıcıda aç” kullanın.
            </Text>
          </View>
          {liveMode === "web" && isExpoGo ? (
            <View style={styles.nativeHint}>
              <Text style={styles.nativeHintTxt}>
                Expo Go acik oldugu icin WebView modu kullaniliyor. Tarayiciya cikmadan native Jitsi icin development
                build gereklidir.
              </Text>
            </View>
          ) : null}
          {liveMode === "native" ? (
            <JitsiNativeMeeting
              room={roomId}
              serverURL={jitsiServerUrl}
              displayName={displayName}
              onClose={onClose}
              onUnavailable={(message) => {
                setLiveMode("web");
                setLoadErr(message);
              }}
            />
          ) : null}
          {liveMode === "web" && oauthBlocked ? (
            <View style={styles.oauthBanner}>
              <Text style={styles.oauthBannerTitle}>Google oturumu uygulama içinde desteklenmiyor</Text>
              <Text style={styles.oauthBannerBody}>
                “Bu tarayıcı veya uygulama güvenli olmayabilir” mesajı e‑posta hatası değildir; Google gömülü
                WebView’da hesap açmayı engeller. Toplantıya misafir olarak devam edin veya aynı odayı sistem
                tarayıcısında açın.
              </Text>
              <Pressable style={styles.oauthReloadBtn} onPress={reloadJitsi} accessibilityRole="button">
                <Text style={styles.oauthReloadTxt}>Jitsi’yi yeniden yükle</Text>
              </Pressable>
            </View>
          ) : null}
          {liveMode === "web" && authRequired ? (
            <View style={styles.authBanner}>
              <Text style={styles.authBannerTitle}>Bu Jitsi sunucusu hesap girişi istiyor</Text>
              <Text style={styles.authBannerBody}>
                Uygulama içi WebView Google/GitHub oturumunu güvenli şekilde tamamlayamaz; bu yüzden ekran siyah
                kalabilir. Aynı odayı “Tarayıcıda aç” ile sistem tarayıcısında açın veya misafir erişimi açık Jitsi
                sunucusu kullanın.
              </Text>
              <Pressable style={styles.oauthReloadBtn} onPress={() => jitsiUri && void Linking.openURL(jitsiUri)}>
                <Text style={styles.oauthReloadTxt}>Tarayıcıda aç</Text>
              </Pressable>
            </View>
          ) : null}
          {liveMode === "web" && jitsiUri ? (
            <WebView
              key={`${jitsiUri}-${retryNonce}`}
              source={{ uri: jitsiUri }}
              style={styles.web}
              originWhitelist={["*", "about:"]}
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled={Platform.OS === "android"}
              mixedContentMode="always"
              userAgent={getCanliYayinWebViewUserAgent()}
              setSupportMultipleWindows={false}
              allowsInlineMediaPlayback
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
              geolocationEnabled
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
              onLoadStart={() => {
                setLoadErr(null);
              }}
              injectedJavaScriptBeforeContentLoaded={`
                (function() {
                  var sent = false;
                  function check() {
                    if (sent) return;
                    try {
                      var txt = (document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
                      if (txt.includes("sign in with google") || txt.includes("sign in with github")) {
                        window.ReactNativeWebView.postMessage("__AUTH_REQUIRED__");
                        sent = true;
                      }
                    } catch (e) {}
                  }
                  setInterval(check, 500);
                  check();
                })();
                true;
              `}
              onMessage={(e) => {
                if (e.nativeEvent.data === "__AUTH_REQUIRED__") {
                  setAuthRequired(true);
                }
              }}
              onError={(e) => {
                const n = e.nativeEvent;
                const msg = [n.description, n.domain ? `(${n.domain})` : "", n.code != null ? `#${n.code}` : ""]
                  .filter(Boolean)
                  .join(" ");
                setLoadErr(msg || "Jitsi yüklenemedi.");
              }}
              onHttpError={(e) => setLoadErr(`HTTP ${e.nativeEvent.statusCode}`)}
              onShouldStartLoadWithRequest={(req) => {
                const u = req.url;
                if (u === "about:blank") return true;
                if (!(u.startsWith("http://") || u.startsWith("https://"))) return false;
                if (isEmbeddedGoogleOAuthUrl(u)) {
                  setOauthBlocked(true);
                  return false;
                }
                return true;
              }}
            />
          ) : null}
          {loadErr ? (
            <View style={styles.errBox}>
              <Text style={styles.errTitle}>Bağlantı sorunu</Text>
              <Text style={styles.errBody}>{loadErr}</Text>
              <View style={styles.errRow}>
                <Pressable
                  style={styles.errBtn}
                  onPress={() => {
                    setLoadErr(null);
                    setOauthBlocked(false);
                    setAuthRequired(false);
                    setRetryNonce((k) => k + 1);
                  }}
                >
                  <Text style={styles.errBtnText}>Tekrar dene</Text>
                </Pressable>
                <Pressable style={styles.errBtn2} onPress={() => jitsiUri && void Linking.openURL(jitsiUri)}>
                  <Text style={styles.errBtn2Text}>Tarayıcıda aç</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      )}
    </Modal>
  );
}
