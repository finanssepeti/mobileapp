import React, { useCallback, useMemo } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { ThemePalette } from "../theme/palettes";
import { useAppTheme } from "../theme/ThemeProvider";
import {
  SITE_MENU_SECTIONS,
  SITE_MENU_SOCIAL_LINKS,
  type SiteMenuEntry,
  type SiteMenuSocialLink,
} from "../lib/siteMenuContent";
import { t, type AppLang } from "../lib/i18n";

const MENU_SECTION_KEY: Record<string, string> = {
  krediler: "menu_sec_loans",
  kiyasla: "menu_sec_kiyasla",
  dusenler_yukselenler: "menu_sec_movers",
  analiz: "menu_sec_analiz_block",
  yatirim_ekle: "menu_sec_yatirim_ekle",
  cuzdanim: "menu_sec_cuzdanim",
  profil: "menu_sec_profile",
  icerik: "menu_sec_content",
  kariyer_yayin: "menu_sec_career_pub",
  ayarlar: "menu_sec_settings",
  misyon: "menu_sec_mission",
  vizyon: "menu_sec_vision",
  bize_ulasin: "menu_sec_contact",
};

const MENU_ITEM_KEY: Record<string, string> = {
  kredi_hesaplama: "menu_item_kredi_hesaplama",
  kullandigim_krediler: "menu_item_kullandigim_krediler",
  profilim: "menu_item_profilim",
  ana_sayfam: "menu_item_ana_sayfam",
  kisi_ara: "menu_item_kisi_ara",
  bildirimler: "menu_item_bildirimler",
  mesajlarim: "menu_item_mesajlarim",
  yorum_yaz: "menu_item_yorum_yaz",
  yorumlarim: "menu_item_yorumlarim",
  begendiklerim: "menu_item_begendiklerim",
  favorilerim: "menu_item_favorilerim",
  fotograflarim: "menu_item_fotograflarim",
  videolarim: "menu_item_videolarim",
  kariyerim: "menu_item_kariyerim",
  profil_gizliligi: "menu_item_profil_gizliligi",
  sifre_degistir: "menu_item_sifre_degistir",
  dil_secenekleri: "menu_item_dil_secenekleri",
  site_gorunumu: "menu_item_site_gorunumu",
  misyon_metin: "menu_item_misyon_metin",
  vizyon_metin: "menu_item_vizyon_metin",
  iletisim_eposta: "menu_item_iletisim_eposta",
  kiyasla_aciklama: "menu_item_kiyasla_aciklama",
  dusenler_aciklama: "menu_item_dusenler_aciklama",
  analiz_aciklama: "menu_item_analiz_aciklama",
  yatirim_ekle_aciklama: "menu_item_yatirim_ekle_aciklama",
  cuzdanim_aciklama: "menu_item_cuzdanim_aciklama",
};

function menuSectionTitle(lang: AppLang, sectionId: string, fallback: string) {
  const k = MENU_SECTION_KEY[sectionId];
  return k ? t(lang, k) : fallback;
}
function menuItemText(lang: AppLang, itemId: string, fallback: string) {
  const k = MENU_ITEM_KEY[itemId];
  return k ? t(lang, k) : fallback;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Menü maddesine basılınca (isteğe bağlı yönlendirme) */
  onItemPress?: (entry: SiteMenuEntry) => void;
};

/** Expo Go / Android uyumu için MaterialCommunityIcons (marka glifleri tutarlı raster). */
function SocialBrandIcon({ platform }: { platform: SiteMenuSocialLink["platform"] }) {
  const size = 26;
  const color = "#ffffff";
  if (platform === "x") {
    return <FontAwesome6 name="x-twitter" size={size} color={color} brand />;
  }
  if (platform === "instagram") {
    return <MaterialCommunityIcons name="instagram" size={size} color={color} />;
  }
  return <MaterialCommunityIcons name="youtube" size={size} color={color} />;
}

function socialLabel(platform: SiteMenuSocialLink["platform"], lang: AppLang): string {
  if (platform === "x") return t(lang, "menu_social_x");
  if (platform === "instagram") return t(lang, "menu_social_ig");
  return t(lang, "menu_social_yt");
}

function createSiteMenuStyles(colors: ThemePalette, isLight: boolean) {
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
    closeHit: { minWidth: 64, paddingVertical: 6 },
    closeText: { color: colors.accent, fontSize: 16, fontWeight: "800" },
    headerTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
    body: { flex: 1 },
    bodyContent: { padding: 14, paddingBottom: 16 },
    section: { marginBottom: 22 },
    sectionTitle: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: "800",
      marginBottom: 10,
    },
    itemRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    itemText: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "500",
      lineHeight: 21,
      paddingRight: 8,
    },
    chevron: { color: colors.accent, fontSize: 20, fontWeight: "700", marginTop: 2 },
    externalHint: { color: colors.textMuted, fontSize: 16, fontWeight: "700", marginTop: 2 },
    socialRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      paddingVertical: 10,
    },
    footerBar: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingTop: 10,
    },
    socialBtn: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: isLight ? colors.primary : "rgba(15,23,42,0.96)",
      borderWidth: 1,
      borderColor: isLight ? colors.primaryLight : "#64748b",
      alignItems: "center",
      justifyContent: "center",
    },
  });
}

export function SiteMenuModal({ visible, onClose, onItemPress }: Props) {
  const { palette, isLight, lang } = useAppTheme();
  const styles = useMemo(() => createSiteMenuStyles(palette, isLight), [palette, isLight]);
  const insets = useSafeAreaInsets();

  const openExternal = useCallback(
    async (url: string) => {
      try {
        const u = url.trim();
        if (await Linking.canOpenURL(u)) await Linking.openURL(u);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeHit}>
            <Text style={styles.closeText}>{t(lang, "close")}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{t(lang, "site_menu")}</Text>
          <View style={styles.closeHit} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            { paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          nestedScrollEnabled
          scrollEventThrottle={16}
          bounces
          overScrollMode={Platform.OS === "android" ? "always" : undefined}
        >
          {SITE_MENU_SECTIONS.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{menuSectionTitle(lang, section.id, section.title)}</Text>
              {section.items.map((item) => {
                const external = !!item.openUrl;
                return (
                  <Pressable
                    key={item.id}
                    style={styles.itemRow}
                    onPress={() => {
                      if (item.openUrl) void openExternal(item.openUrl);
                      else onItemPress?.(item);
                      onClose();
                    }}
                  >
                    <Text style={styles.itemText}>{menuItemText(lang, item.id, item.text)}</Text>
                    {external ? <Text style={styles.externalHint}>↗</Text> : <Text style={styles.chevron}>›</Text>}
                  </Pressable>
                );
              })}
              {section.socialLinks?.length ? (
                <View style={styles.socialRow}>
                  {section.socialLinks.map((link) => (
                    <Pressable
                      key={link.id}
                      style={styles.socialBtn}
                      accessibilityRole="link"
                      accessibilityLabel={socialLabel(link.platform, lang)}
                      onPress={() => {
                        void openExternal(link.url);
                        onClose();
                      }}
                    >
                      <SocialBrandIcon platform={link.platform} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.footerBar, styles.socialRow, { paddingBottom: Math.max(12, insets.bottom + 6) }]}>
          {SITE_MENU_SOCIAL_LINKS.map((link) => (
            <Pressable
              key={link.id}
              style={styles.socialBtn}
              accessibilityRole="link"
              accessibilityLabel={socialLabel(link.platform, lang)}
              onPress={() => {
                void openExternal(link.url);
                onClose();
              }}
            >
              <SocialBrandIcon platform={link.platform} />
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
