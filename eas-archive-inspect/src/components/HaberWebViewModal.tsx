import React, { useMemo } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { resolveHaberWebViewPlayback } from "../lib/youtubeInAppUrl";
import type { ThemePalette } from "../theme/palettes";
import { useAppTheme } from "../theme/ThemeProvider";

type Props = {
  visible: boolean;
  uri: string;
  title?: string;
  onClose: () => void;
};

function createHaberWebViewStyles(colors: ThemePalette, isLight: boolean) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    backBtn: { minWidth: 72, paddingVertical: 6 },
    backText: { color: colors.accent, fontSize: 16, fontWeight: "800" },
    title: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
    web: { flex: 1, backgroundColor: isLight ? colors.surface : "#0f172a" },
  });
}

/** Haber / TV sayfası — uygulama içinde, harici tarayıcıya zorlamadan. */
export function HaberWebViewModal({ visible, uri, title, onClose }: Props) {
  const { source, userAgent } = useMemo(() => resolveHaberWebViewPlayback(uri), [uri]);
  const { palette, isLight } = useAppTheme();
  const styles = useMemo(() => createHaberWebViewStyles(palette, isLight), [palette, isLight]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Text style={styles.backText}>← Geri</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? "Haber"}
          </Text>
          <View style={styles.backBtn} />
        </View>
        {uri ? (
          <WebView
            source={source}
            style={styles.web}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={Platform.OS === "android"}
            mixedContentMode="always"
            userAgent={userAgent}
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            onShouldStartLoadWithRequest={(req) => {
              const u = req.url;
              if (u === "about:blank") return true;
              if (u.startsWith("http://") || u.startsWith("https://")) return true;
              return false;
            }}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
