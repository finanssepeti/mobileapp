import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { createSiteAyarlarModalStyles } from "./siteAyarlarModalStyles";
import { t } from "../lib/i18n";

type SiteAyarModalStyles = ReturnType<typeof createSiteAyarlarModalStyles>;
import { DEFAULT_PROFILE, loadProfile, saveProfile, type StoredProfile } from "../lib/profileStorage";
import { pullProfileFromFirestore, pushProfileToFirestore } from "../lib/profileFirestore";
import { tryChangeAppPassword } from "../lib/firebaseChangePassword";

export type SiteAyarlarSectionId = "profil_gizlilik" | "sifre" | "dil" | "site_gorunumu";

type SectionId = SiteAyarlarSectionId;

const SECTION_SUBTITLE: Record<SectionId, string> = {
  profil_gizlilik: "settings_sections_profile_privacy",
  sifre: "settings_sections_password",
  dil: "settings_sections_language",
  site_gorunumu: "settings_sections_appearance",
};

const LANGS: { code: StoredProfile["dil"]; tr: string; native: string; flag: string }[] = [
  { code: "tr", tr: "Türkçe", native: "Turkish", flag: "🇹🇷" },
  { code: "en", tr: "İngilizce", native: "English", flag: "🇬🇧" },
  { code: "de", tr: "Almanca", native: "Deutsch", flag: "🇩🇪" },
  { code: "fr", tr: "Fransızca", native: "Français", flag: "🇫🇷" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Menüden doğrudan bir ayar sayfasına git */
  initialSection?: SiteAyarlarSectionId;
};

function PrivacyCard({
  styles,
  title,
  body,
  selected,
  icon,
  onPress,
}: {
  styles: SiteAyarModalStyles;
  title: string;
  body: string;
  selected: boolean;
  icon: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.privacyCard, selected && styles.privacyCardActive]} onPress={onPress}>
      <Text style={styles.privacyIcon}>{icon}</Text>
      <View style={styles.privacyTxtCol}>
        <Text style={styles.privacyTitle}>{title}</Text>
        <Text style={styles.privacyBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

export function SiteAyarlarModal({ visible, onClose, initialSection }: Props) {
  const { palette, isLight, setScheme, setLang, lang } = useAppTheme();
  const styles = useMemo(() => createSiteAyarlarModalStyles(palette, isLight), [palette, isLight]);
  const [section, setSection] = useState<SectionId>("profil_gizlilik");
  const [profile, setProfile] = useState<StoredProfile>({ ...DEFAULT_PROFILE });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pwdCur, setPwdCur] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdAgain, setPwdAgain] = useState("");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setSection(initialSection ?? "profil_gizlilik");
    setPwdCur("");
    setPwdNew("");
    setPwdAgain("");
    void (async () => {
      const local = await loadProfile();
      const remote = await pullProfileFromFirestore();
      if (cancelled) return;
      /* Yerel profil her zaman kazanır: tema/dil kaydı Firestore’daki eski değerleri ezemesin. */
      const merged: StoredProfile = {
        ...DEFAULT_PROFILE,
        ...(remote ?? {}),
        ...local,
      };
      if (!merged.dil) merged.dil = "tr";
      if (!merged.siteGorunumu) merged.siteGorunumu = "koyu";
      setProfile(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initialSection]);

  const persistProfile = useCallback(async (next: StoredProfile) => {
    setSaving(true);
    try {
      await saveProfile(next);
      await pushProfileToFirestore(next);
    } finally {
      setSaving(false);
    }
  }, []);

  const onSavePrivacyLangTheme = useCallback(async () => {
    if (saving) return;
    try {
      await persistProfile(profile);
      setScheme(profile.siteGorunumu);
      setLang(profile.dil);
      onClose();
    } catch {
      Alert.alert("Hata", "Kayıt tamamlanamadı. Bağlantınızı kontrol edin.");
    }
  }, [saving, profile, persistProfile, setScheme, setLang, onClose]);

  const onSavePassword = useCallback(async () => {
    if (pwdNew !== pwdAgain) {
      Alert.alert("Şifre", "Yeni şifre ve tekrarı aynı olmalı.");
      return;
    }
    if (pwdNew.length < 6) {
      Alert.alert("Şifre", "Yeni şifre en az 6 karakter olmalı.");
      return;
    }
    setSaving(true);
    try {
      const r = await tryChangeAppPassword(pwdCur, pwdNew);
      if (r.ok) {
        setPwdCur("");
        setPwdNew("");
        setPwdAgain("");
        Alert.alert("Tamam", "Şifreniz güncellendi.");
      } else {
        Alert.alert("Şifre", r.message);
      }
    } finally {
      setSaving(false);
    }
  }, [pwdCur, pwdNew, pwdAgain]);

  const subtitle = t(lang, SECTION_SUBTITLE[section]);
  const menuRows: { id: SectionId; label: string; icon?: string }[] = [
    { id: "profil_gizlilik", label: t(lang, "settings_sections_profile_privacy"), icon: "🛡" },
    { id: "sifre", label: t(lang, "settings_sections_password") },
    { id: "dil", label: t(lang, "settings_sections_language") },
    { id: "site_gorunumu", label: t(lang, "settings_sections_appearance"), icon: "🎨" },
  ];

  const detail = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.detailBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      );
    }

    if (section === "profil_gizlilik") {
      return (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitle}>Profil Gizliliği</Text>
          <Text style={styles.detailHint}>
            Profilinizi, kişisel bilgilerinizi, yorumlarınızı, fotoğraflarınızı, videolarınızı ve kariyer bilgilerinizi
            kimlerin görebileceğini seçin.
          </Text>
          <PrivacyCard
            styles={styles}
            title="Herkese Açık"
            body="Profiliniz ve paylaşımlarınız herkese görünür olabilir."
            selected={profile.gizlilik === "herkese_acik"}
            icon="🌐"
            onPress={() => setProfile((p) => ({ ...p, gizlilik: "herkese_acik" }))}
          />
          <PrivacyCard
            styles={styles}
            title="Herkesden Gizle"
            body="Profil, kişisel bilgiler, yorumlar, fotoğraflar, videolar ve kariyer bilgileri kimse tarafından görülemez."
            selected={profile.gizlilik === "gizli"}
            icon="🔒"
            onPress={() => setProfile((p) => ({ ...p, gizlilik: "gizli" }))}
          />
          <PrivacyCard
            styles={styles}
            title="Sadece Takipçilerim"
            body="Sadece sizi takip eden kişiler bu bilgileri okuyup görebilir."
            selected={profile.gizlilik === "sadece_takipciler"}
            icon="👥"
            onPress={() => setProfile((p) => ({ ...p, gizlilik: "sadece_takipciler" }))}
          />
          <View style={styles.saveRow}>
            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              disabled={saving}
              onPress={() => void onSavePrivacyLangTheme()}
            >
              <Text style={styles.saveBtnTxt}>{saving ? "…" : t(lang, "save")}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (section === "sifre") {
      return (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitle}>Şifre Değiştir</Text>
          <Text style={styles.fieldLbl}>Mevcut Şifre</Text>
          <TextInput
            style={styles.inp}
            secureTextEntry
            value={pwdCur}
            onChangeText={setPwdCur}
            placeholder="••••••••"
            placeholderTextColor={palette.textMuted}
          />
          <Text style={styles.fieldLbl}>Yeni Şifre</Text>
          <TextInput
            style={styles.inp}
            secureTextEntry
            value={pwdNew}
            onChangeText={setPwdNew}
            placeholder="En az 6 karakter"
            placeholderTextColor={palette.textMuted}
          />
          <Text style={styles.fieldLbl}>Tekrar Yeni Şifre</Text>
          <TextInput
            style={styles.inp}
            secureTextEntry
            value={pwdAgain}
            onChangeText={setPwdAgain}
            placeholder="Yeni şifreyi tekrarlayın"
            placeholderTextColor={palette.textMuted}
          />
          <View style={styles.saveRow}>
            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              disabled={saving}
              onPress={() => void onSavePassword()}
            >
              <Text style={styles.saveBtnTxt}>{saving ? "…" : t(lang, "save")}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (section === "dil") {
      return (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitle}>Dil Seçenekleri</Text>
          <Text style={styles.detailHint}>
            Seçtiğiniz dil kaydedildikten sonra sitenin tüm metinleri o dile çevrilir (uygulama metinleri aşamalı
            güncellenir).
          </Text>
          {LANGS.map((row) => (
            <Pressable
              key={row.code}
              style={[styles.langRow, profile.dil === row.code && styles.langRowActive]}
              onPress={() => setProfile((p) => ({ ...p, dil: row.code }))}
            >
              <Text style={styles.langFlag}>{row.flag}</Text>
              <View style={styles.langTxtCol}>
                <Text style={styles.langTr}>{row.tr}</Text>
                <Text style={styles.langNative}>→ {row.native}</Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.saveRow}>
            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              disabled={saving}
              onPress={() => void onSavePrivacyLangTheme()}
            >
              <Text style={styles.saveBtnTxt}>{saving ? "…" : t(lang, "save")}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (section === "site_gorunumu") {
      return (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitle}>Site Görünümü</Text>
          <Text style={styles.detailHint}>
            Açık: beyaz zemin, lacivert metin; turuncu vurgular aynı kalır. Koyu: mevcut lacivert arka plan ve beyaz
            yazılar. Kaydet dediğinizde tercih uygulanır ve bu ekran kapanır.
          </Text>
          <Pressable
            style={[styles.themeRow, profile.siteGorunumu === "acik" && styles.themeRowActive]}
            onPress={() => setProfile((p) => ({ ...p, siteGorunumu: "acik" }))}
          >
            <Text style={styles.themeIcon}>☀️</Text>
            <View style={styles.themeTxtCol}>
              <Text style={styles.themeTitle}>Açık</Text>
              <Text style={styles.themeSub}>
                Açık arka plan, lacivert yazı ve başlıklar. Turuncu alanlar turuncu kalır.
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.themeRow, profile.siteGorunumu === "koyu" && styles.themeRowActive]}
            onPress={() => setProfile((p) => ({ ...p, siteGorunumu: "koyu" }))}
          >
            <Text style={styles.themeIcon}>🌙</Text>
            <View style={styles.themeTxtCol}>
              <Text style={styles.themeTitle}>Koyu</Text>
              <Text style={styles.themeSub}>Mevcut koyu görünüm (varsayılan).</Text>
            </View>
          </Pressable>
          <View style={styles.saveRow}>
            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              disabled={saving}
              onPress={() => void onSavePrivacyLangTheme()}
            >
              <Text style={styles.saveBtnTxt}>{saving ? "…" : t(lang, "save")}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return null;
  }, [loading, section, profile, pwdCur, pwdNew, pwdAgain, saving, onSavePrivacyLangTheme, onSavePassword, styles, palette]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>{t(lang, "settings_title")}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeSq} hitSlop={12}>
              <Text style={styles.closeSqTxt}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.menuHeading}>{t(lang, "settings_sections")}</Text>
            {menuRows.map((m) => (
              <Pressable
                key={m.id}
                style={[styles.menuItem, section === m.id && styles.menuItemActive]}
                onPress={() => setSection(m.id)}
              >
                <Text style={styles.menuItemTxt}>
                  {m.icon ? `${m.icon}  ` : ""}
                  {m.label}
                </Text>
              </Pressable>
            ))}

            {detail}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
