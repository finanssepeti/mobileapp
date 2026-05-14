import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Linking,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { WebView } from "react-native-webview";
import { t } from "../lib/i18n";
import { useAppTheme, useThemeColors } from "../theme/ThemeProvider";
import { createLoginScreenStyles } from "./loginScreenStyles";
import { resolveBrandLogoImageSource } from "../theme/brandLogo";
import type { RootStackParamList } from "../navigation/types";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { setLoggedIn } from "../lib/authSession";
import { extractOobCodeFromFirebaseResetLink } from "../lib/firebaseChangePassword";
import { ensureFirestoreAuthReady, getFirebaseFirestore, isFirebaseConfigured } from "../lib/firebaseClient";
import { WEBVIEW_DESKTOP_CHROME_UA } from "../lib/webviewChromeUserAgent";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Login">;
};

type UserType = "individual" | "corporate";
type AuthMode = "login" | "register";

export function LoginScreen({ navigation }: Props) {
  const [userType, setUserType] = useState<UserType>("individual");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isHuman, setIsHuman] = useState(false);
  /** Kullanıcı ilgili metni WebView'da açıp «Okudum» ile onayladı mı */
  const [privacyAck, setPrivacyAck] = useState(false);
  const [kvkkAck, setKvkkAck] = useState(false);
  /** Gizlilik + KVKK okunduktan sonra işaretlenebilir */
  const [agreeLegal, setAgreeLegal] = useState(false);
  const [legalModal, setLegalModal] = useState<null | "privacy" | "kvkk">(null);
  const [errorText, setErrorText] = useState("");
  const [recaptchaVisible, setRecaptchaVisible] = useState(false);
  const [isVerifyingCaptcha, setIsVerifyingCaptcha] = useState(false);
  const [robotCheckedAt, setRobotCheckedAt] = useState<number | null>(null);
  const [captchaStatusText, setCaptchaStatusText] = useState("Ben robot değilim");
  const [resetVisible, setResetVisible] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "code">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetInfo, setResetInfo] = useState("");
  const [issuedResetCode, setIssuedResetCode] = useState("");

  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000";
  const brandLogoSource = resolveBrandLogoImageSource(process.env.EXPO_PUBLIC_LOGO_URL);
  const siteKey = (process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY || "").trim();
  const hasRecaptchaSiteKey = Boolean(siteKey) && !siteKey.toLowerCase().includes("your_new_site_key_here");
  const firebaseProjectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const functionsBaseUrlRaw = (process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || "").trim();
  const functionsBaseUrl =
    !functionsBaseUrlRaw || functionsBaseUrlRaw.includes("your-project-id")
      ? firebaseProjectId
        ? `https://us-central1-${firebaseProjectId}.cloudfunctions.net`
        : ""
      : functionsBaseUrlRaw;
  const isCaptchaBypassEnabled =
    __DEV__ || (process.env.EXPO_PUBLIC_CAPTCHA_BYPASS || "").toLowerCase() === "true";
  const isNativeApp = Platform.OS === "android" || Platform.OS === "ios";
  const shouldUseNativeCaptchaFallback = isNativeApp || !hasRecaptchaSiteKey;

  const recaptchaHtml = useMemo(
    () => `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://www.google.com/recaptcha/api.js" async defer></script>
    <style>
      body { margin:0; font-family: Arial, sans-serif; background:#111c6b; color:#fff; }
      .wrap { padding:16px; }
      .hint { font-size:14px; margin-bottom:12px; line-height:1.4; }
      .empty { color:#fecaca; font-size:13px; }
    </style>
    <script>
      function onCaptchaDone(token) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "captcha", token }));
      }
      function onCaptchaExpired() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "expired" }));
      }
    </script>
  </head>
  <body>
    <div class="wrap">
      ${
        hasRecaptchaSiteKey
          ? `<div class="hint">Lütfen reCAPTCHA doğrulamasını tamamlayın.</div>
             <div class="g-recaptcha" data-sitekey="${siteKey}" data-callback="onCaptchaDone" data-expired-callback="onCaptchaExpired"></div>`
          : `<div class="empty">reCAPTCHA site key tanımlı değil.</div>`
      }
    </div>
  </body>
</html>`,
    [hasRecaptchaSiteKey, siteKey]
  );

  const { lang } = useAppTheme();
  const palette = useThemeColors();
  const styles = useMemo(() => createLoginScreenStyles(palette), [palette]);
  const canToggleLegalCheckbox = privacyAck && kvkkAck;

  const verifyCaptchaWithBackend = async (token: string) => {
    if (!hasRecaptchaSiteKey) {
      setIsHuman(true);
      setRobotCheckedAt(Date.now());
      setCaptchaStatusText("Doğrulama tamamlandı");
      setRecaptchaVisible(false);
      return;
    }
    setIsVerifyingCaptcha(true);
    setErrorText("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/verify-recaptcha`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (result?.success) {
        setIsHuman(true);
        setRobotCheckedAt(Date.now());
        setCaptchaStatusText("Doğrulama tamamlandı");
        setRecaptchaVisible(false);
      } else {
        setIsHuman(false);
        setCaptchaStatusText("Doğrulama başarısız");
        setErrorText("reCAPTCHA doğrulaması başarısız. Lütfen tekrar deneyin.");
      }
    } catch (_e) {
      setIsHuman(false);
      setCaptchaStatusText("Doğrulama başarısız");
      setErrorText(
        "Doğrulama servisine ulaşılamadı. API adresi ve ağ bağlantısını kontrol edin."
      );
    } finally {
      setIsVerifyingCaptcha(false);
    }
  };

  const legalHtmlByType = useMemo(
    () => ({
      privacy: `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{font-family:Arial,sans-serif;background:#0b1460;color:#f8fafc;padding:16px;line-height:1.55}h1{font-size:20px;margin:0 0 12px}h2{font-size:16px;margin:16px 0 8px;color:#dbeafe}p{font-size:14px;margin:0 0 10px}</style></head><body><h1>Gizlilik Sozlesmesi</h1><p>FinansSepeti uygulamasini kullanirken paylastiginiz bilgiler, hizmeti sunmak ve guvenligi saglamak amaciyla islenir.</p><h2>Toplanan veriler</h2><p>Hesap bilgileri, cihaz bilgileri ve uygulama ici islem kayitlari hizmetin dogru calismasi icin kullanilir.</p><h2>Veri kullanimi</h2><p>Verileriniz hesap yonetimi, giris guvenligi, sifre yenileme, bildirimler ve destek surecleri icin kullanilir.</p><h2>Haklariniz</h2><p>Bilgilerinizi guncelleme, duzeltme ve mevzuata uygun olarak silinmesini talep etme hakkiniz vardir.</p><p>Uygulamayi kullanmaya devam ederek bu metni okudugunuzu ve kabul ettiginizi beyan edersiniz.</p></body></html>`,
      kvkk: `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{font-family:Arial,sans-serif;background:#0b1460;color:#f8fafc;padding:16px;line-height:1.55}h1{font-size:20px;margin:0 0 12px}h2{font-size:16px;margin:16px 0 8px;color:#dbeafe}p{font-size:14px;margin:0 0 10px}</style></head><body><h1>KVKK Aydinlatma Metni</h1><p>6698 sayili KVKK kapsaminda veri sorumlusu olarak FinansSepeti, kisisel verilerinizi hukuka uygun sekilde isler.</p><h2>Isleme amaci</h2><p>Kisisel verileriniz; kimlik dogrulama, hesap guvenligi, iletisim, teknik destek ve yasal yukumluluklerin yerine getirilmesi amaclariyla islenir.</p><h2>Aktarim ve saklama</h2><p>Verileriniz gerekli teknik ve idari tedbirlerle korunur, mevzuatin izin verdigi sure boyunca saklanir.</p><h2>Basvuru hakki</h2><p>KVKK madde 11 kapsamindaki taleplerinizi uygulama destek iletisim kanallari uzerinden iletebilirsiniz.</p><p>Bu metni okudugunuzu ve aydinlatildiginizi kabul ederek devam edebilirsiniz.</p></body></html>`,
    }),
    []
  );

  const generateSixDigitCode = () => String(Math.floor(100000 + Math.random() * 900000));

  const sendResetCode = async () => {
    const emailNorm = resetEmail.trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      setResetInfo("Lütfen geçerli bir e-posta adresi girin.");
      return;
    }
    if (!functionsBaseUrl) {
      setResetInfo("EXPO_PUBLIC_FUNCTIONS_BASE_URL tanımlı değil.");
      return;
    }
    if (!isFirebaseConfigured()) {
      setResetInfo("Şifre sıfırlama için Firebase .env değerleri (API key, project id) gerekli.");
      return;
    }
    const code = generateSixDigitCode();
    setResetBusy(true);
    setResetInfo("");
    try {
      const db = getFirebaseFirestore();
      const payload = {
        email: emailNorm,
        code,
        createdAt: serverTimestamp(),
      };
      try {
        await addDoc(collection(db, "passwordResetCodes"), payload);
      } catch {
        await ensureFirestoreAuthReady();
        await addDoc(collection(db, "passwordResetCodes"), payload);
      }
      const r = await fetch(`${functionsBaseUrl}/sendPasswordResetCodeEmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailNorm, code }),
      });
      let j: { ok?: boolean } = {};
      try {
        const text = await r.text();
        if (text) j = JSON.parse(text) as { ok?: boolean };
      } catch {
        j = {};
      }
      if (r.ok && j?.ok) {
        setIssuedResetCode(code);
        setResetStep("code");
        setResetInfo("Doğrulama kodu e-posta adresinize gönderildi.");
      } else {
        setResetInfo("Kod gönderilemedi. Lütfen tekrar deneyin.");
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setResetInfo(raw.trim() ? `Şifre sıfırlama adımı başarısız: ${raw.trim().slice(0, 260)}` : "Şifre sıfırlama adımı başarısız.");
    } finally {
      setResetBusy(false);
    }
  };

  const verifyResetCode = async () => {
    const emailNorm = resetEmail.trim().toLowerCase();
    const codeNorm = resetCode.replace(/\D/g, "");
    if (!/^\d{6}$/.test(codeNorm)) {
      setResetInfo("Lütfen 6 haneli kodu girin.");
      return;
    }
    if (!functionsBaseUrl) {
      setResetInfo("EXPO_PUBLIC_FUNCTIONS_BASE_URL tanımlı değil.");
      return;
    }
    setResetBusy(true);
    setResetInfo("");
    try {
      const r = await fetch(`${functionsBaseUrl}/verifyPasswordResetCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailNorm, code: codeNorm || issuedResetCode }),
      });
      let j: { ok?: boolean; resetLink?: string; oobCode?: string; error?: string } = {};
      try {
        j = await r.json();
      } catch {
        j = {};
      }
      if (r.ok && j?.ok) {
        const oobFromBody = typeof j.oobCode === "string" ? j.oobCode.trim() : "";
        const oobFromLink =
          typeof j.resetLink === "string" ? extractOobCodeFromFirebaseResetLink(j.resetLink) : null;
        const oob = oobFromBody || oobFromLink;
        if (oob) {
          setResetVisible(false);
          setResetStep("email");
          setResetCode("");
          setIssuedResetCode("");
          setResetInfo("");
          navigation.navigate("ResetPassword", { oobCode: oob, email: emailNorm });
        } else if (j.resetLink) {
          await Linking.openURL(String(j.resetLink));
          setResetVisible(false);
          setResetStep("email");
          setResetCode("");
          setIssuedResetCode("");
          setResetInfo("");
        } else {
          setResetInfo("Sunucu yanıtı eksik (oobCode yok). Lütfen tekrar deneyin veya destek ile iletişime geçin.");
        }
      } else if (j?.error === "invalid_or_expired" || j?.error === "invalid_code") {
        setResetInfo("Kod hatalı veya süresi dolmuş (1 saat). Tekrar «Kod Gönder» ile yeni kod isteyin.");
      } else if (j?.error === "auth_user_not_found") {
        setResetInfo("Bu e-posta ile kayıtlı Firebase hesabı bulunamadı.");
      } else {
        setResetInfo("Kod doğrulanamadı veya süresi doldu.");
      }
    } catch (_e) {
      setResetInfo("Doğrulama servisine ulaşılamadı.");
    } finally {
      setResetBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!isHuman) {
      setErrorText("Lütfen 'Ben robot değilim' seçeneğini işaretleyin.");
      return;
    }
    if (robotCheckedAt && Date.now() - robotCheckedAt < 800) {
      setErrorText("Lütfen robot doğrulamasını bir an bekleyip tekrar deneyin.");
      return;
    }
    if (!email.trim() || !password) {
      setErrorText(t(lang, "login_email_password_required"));
      return;
    }
    if (!privacyAck || !kvkkAck || !agreeLegal) {
      setErrorText(t(lang, "legal_must_open_and_confirm"));
      return;
    }
    if (authMode === "register" && password !== confirmPassword) {
      setErrorText("Şifre ve şifre tekrarı aynı olmalı.");
      return;
    }
    setErrorText("");
    await setLoggedIn(email.trim().toLowerCase());
    navigation.replace("Home");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.container}>
          <View style={styles.headerBlock}>
            <Text style={styles.brand}>FinansSepeti</Text>
            <Text style={styles.subtitle}>Giriş ve üyelik işlemleri</Text>
            <Image source={brandLogoSource} style={styles.logo} resizeMode="contain" />
          </View>

          <View style={styles.form}>
            <View style={styles.segmentContainer}>
              <Pressable
                style={[styles.segmentButton, userType === "individual" && styles.segmentActive]}
                onPress={() => setUserType("individual")}
              >
                <Text style={[styles.segmentText, userType === "individual" && styles.segmentTextActive]}>
                  Bireysel Kullanıcı
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segmentButton, userType === "corporate" && styles.segmentActive]}
                onPress={() => setUserType("corporate")}
              >
                <Text style={[styles.segmentText, userType === "corporate" && styles.segmentTextActive]}>
                  Kurumsal Kullanıcı
                </Text>
              </Pressable>
            </View>

            <View style={[styles.segmentContainer, styles.modeContainer]}>
              <Pressable
                style={[styles.segmentButton, authMode === "login" && styles.segmentActive]}
                onPress={() => setAuthMode("login")}
              >
                <Text style={[styles.segmentText, authMode === "login" && styles.segmentTextActive]}>
                  Giriş
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segmentButton, authMode === "register" && styles.segmentActive]}
                onPress={() => setAuthMode("register")}
              >
                <Text style={[styles.segmentText, authMode === "register" && styles.segmentTextActive]}>
                  Üye Ol
                </Text>
              </Pressable>
            </View>

            {authMode === "register" && userType === "individual" ? (
              <>
                <Text style={styles.label}>Ad Soyad</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ad Soyad"
                  placeholderTextColor={palette.textMuted}
                  value={fullName}
                  onChangeText={setFullName}
                />
              </>
            ) : null}

            {authMode === "register" && userType === "corporate" ? (
              <>
                <Text style={styles.label}>Şirket Ünvanı</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Şirket adı"
                  placeholderTextColor={palette.textMuted}
                  value={companyName}
                  onChangeText={setCompanyName}
                />
                <Text style={[styles.label, styles.labelSpacing]}>Vergi No</Text>
                <TextInput
                  style={styles.input}
                  placeholder="10 haneli vergi numarası"
                  placeholderTextColor={palette.textMuted}
                  keyboardType="number-pad"
                  value={taxNumber}
                  onChangeText={setTaxNumber}
                />
              </>
            ) : null}

            <Text style={[styles.label, styles.labelSpacing]}>Kullanıcı adı / E-posta</Text>
            <TextInput
              style={styles.input}
              placeholder="kullanıcıadı veya ornek@email.com"
              placeholderTextColor={palette.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />

            <Text style={[styles.label, styles.labelSpacing]}>Şifre</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={palette.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {authMode === "register" ? (
              <>
                <Text style={[styles.label, styles.labelSpacing]}>Şifre Tekrarı</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={palette.textMuted}
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </>
            ) : null}

            {authMode === "login" ? (
              <View style={styles.inlineRow}>
                <Pressable style={styles.checkboxRow} onPress={() => setRememberMe((value) => !value)}>
                  <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                    {rememberMe ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={styles.inlineLabel}>Beni hatırla</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setResetVisible(true);
                    setResetStep("email");
                    setResetCode("");
                    setResetInfo("");
                  }}
                >
                  <Text style={styles.linkSmall}>Şifremi unuttum</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable
              style={[styles.robotBox, isHuman && styles.robotBoxChecked]}
              onPress={() => {
                if (isCaptchaBypassEnabled || shouldUseNativeCaptchaFallback) {
                  setIsHuman(true);
                  setRobotCheckedAt(Date.now());
                  setCaptchaStatusText(
                    shouldUseNativeCaptchaFallback ? "Doğrulama tamamlandı (mobil)" : "Doğrulama tamamlandı (test)"
                  );
                  setErrorText("");
                  return;
                }
                setRecaptchaVisible(true);
              }}
            >
              <View style={[styles.checkbox, isHuman && styles.checkboxChecked]}>
                {isHuman ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.robotLabel}>{captchaStatusText}</Text>
              <Text style={styles.robotMeta}>reCAPTCHA</Text>
              {isVerifyingCaptcha ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            </Pressable>

            <View style={[styles.linkWrapLeft, { flexDirection: "row", flexWrap: "wrap", alignItems: "center" }]}>
              <Pressable onPress={() => setLegalModal("privacy")}>
                <Text style={styles.link}>{t(lang, "legal_link_privacy")}</Text>
              </Pressable>
              <Text style={styles.inlineLabel}> · </Text>
              <Pressable onPress={() => setLegalModal("kvkk")}>
                <Text style={styles.link}>{t(lang, "legal_link_kvkk")}</Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.checkboxRow, styles.privacyRow, !canToggleLegalCheckbox && { opacity: 0.45 }]}
              onPress={() => {
                if (!canToggleLegalCheckbox) {
                  setErrorText(t(lang, "legal_must_open_and_confirm"));
                  return;
                }
                setErrorText("");
                setAgreeLegal((value) => !value);
              }}
            >
              <View style={[styles.checkbox, agreeLegal && styles.checkboxChecked]}>
                {agreeLegal ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.inlineLabelWrap}>{t(lang, "legal_checkbox_full")}</Text>
            </Pressable>

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
              onPress={onSubmit}
            >
              <Text style={styles.primaryButtonText}>{authMode === "login" ? "Giriş Yap" : "Üye Ol"}</Text>
            </Pressable>
            <Text style={styles.disclaimerText}>
              FinansSepeti.net ve FinansSepeti uygulamasında yayımlanan yorumlar, analiz grafikleri ve forum
              içerikleri yatırım tavsiyesi kapsamında değildir.
            </Text>
            <Text style={styles.footerSiteText}>finanssepeti.net</Text>
          </View>
        </View>
        </ScrollView>

        <Modal visible={recaptchaVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Robot doğrulaması</Text>
              <Text style={styles.modalInfo}>
                Google reCAPTCHA tamamlandığında doğrulama sunucu tarafında kontrol edilir.
              </Text>
              <View style={styles.captchaFrame}>
                <WebView
                  originWhitelist={["*"]}
                  source={{ html: recaptchaHtml }}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  sharedCookiesEnabled
                  thirdPartyCookiesEnabled={Platform.OS === "android"}
                  userAgent={WEBVIEW_DESKTOP_CHROME_UA}
                  onMessage={(event) => {
                    try {
                      const payload = JSON.parse(event.nativeEvent.data || "{}");
                      if (payload?.type === "captcha" && payload?.token) {
                        verifyCaptchaWithBackend(payload.token);
                      } else if (payload?.type === "expired") {
                        setIsHuman(false);
                        setCaptchaStatusText("Doğrulama süresi doldu");
                      }
                    } catch (_e) {
                      setErrorText("reCAPTCHA verisi okunamadı.");
                    }
                  }}
                />
              </View>
              <Pressable
                style={styles.modalButton}
                onPress={() => setRecaptchaVisible(false)}
              >
                <Text style={styles.modalButtonText}>Kapat</Text>
              </Pressable>
              <Pressable style={styles.modalLink} onPress={() => setRecaptchaVisible(false)}>
                <Text style={styles.modalLinkText}>İptal</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={resetVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Şifremi Unuttum</Text>
              {resetStep === "email" ? (
                <>
                  <Text style={styles.modalInfo}>
                    Hesabınızın e-posta adresini girin. 6 haneli doğrulama kodu
                    gönderilecektir.
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="ornek@email.com"
                    placeholderTextColor={palette.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={resetEmail}
                    onChangeText={setResetEmail}
                  />
                  <Pressable style={styles.modalButton} onPress={sendResetCode} disabled={resetBusy}>
                    <Text style={styles.modalButtonText}>{resetBusy ? "Gönderiliyor..." : "Kodu Gönder"}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.modalInfo}>E-posta adresinize gelen 6 haneli kodu girin.</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="123456"
                    placeholderTextColor={palette.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    value={resetCode}
                    onChangeText={setResetCode}
                  />
                  <Pressable style={styles.modalButton} onPress={verifyResetCode} disabled={resetBusy}>
                    <Text style={styles.modalButtonText}>{resetBusy ? "Doğrulanıyor..." : "Kodu Doğrula"}</Text>
                  </Pressable>
                </>
              )}

              {resetInfo ? <Text style={styles.resetInfo}>{resetInfo}</Text> : null}

              <Pressable style={styles.modalLink} onPress={() => setResetVisible(false)}>
                <Text style={styles.modalLinkText}>İptal</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={legalModal !== null} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "left", "right"]}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: palette.border,
              }}
            >
              <Pressable onPress={() => setLegalModal(null)} hitSlop={8}>
                <Text style={styles.modalLinkText}>{t(lang, "close")}</Text>
              </Pressable>
              <Text style={{ color: palette.text, fontWeight: "700", fontSize: 15, flex: 1, textAlign: "center" }}>
                {legalModal === "privacy" ? t(lang, "legal_modal_title_privacy") : t(lang, "legal_modal_title_kvkk")}
              </Text>
              <View style={{ width: 56 }} />
            </View>
            {legalModal ? (
              <WebView
                style={{ flex: 1 }}
                source={{
                  html: legalHtmlByType[legalModal],
                }}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                sharedCookiesEnabled
                thirdPartyCookiesEnabled={Platform.OS === "android"}
                userAgent={WEBVIEW_DESKTOP_CHROME_UA}
              />
            ) : null}
            <Pressable
              style={[styles.modalButton, { margin: 12 }]}
              onPress={() => {
                if (legalModal === "privacy") setPrivacyAck(true);
                if (legalModal === "kvkk") setKvkkAck(true);
                setLegalModal(null);
              }}
            >
              <Text style={styles.modalButtonText}>{t(lang, "legal_read_confirm")}</Text>
            </Pressable>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
