import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useThemeColors } from "../theme/ThemeProvider";
import { createLoginScreenStyles } from "./loginScreenStyles";
import type { RootStackParamList } from "../navigation/types";
import { confirmPasswordWithResetOob } from "../lib/firebaseChangePassword";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

export function ResetPasswordScreen({ route, navigation }: Props) {
  const { oobCode, email } = route.params;
  const [pwdNew, setPwdNew] = useState("");
  const [pwdAgain, setPwdAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const palette = useThemeColors();
  const styles = useMemo(() => createLoginScreenStyles(palette), [palette]);

  const onSave = async () => {
    setInfo("");
    if (pwdNew !== pwdAgain) {
      setInfo("Yeni şifre ve tekrarı aynı olmalı.");
      return;
    }
    setBusy(true);
    const r = await confirmPasswordWithResetOob(oobCode, pwdNew);
    setBusy(false);
    if (r.ok) {
      Alert.alert("Tamam", "Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.", [
        { text: "Giriş ekranına", onPress: () => navigation.replace("Login") },
      ]);
      return;
    }
    setInfo(r.message);
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
              <Text style={styles.brand}>Şifre ayarları</Text>
              <Text style={styles.subtitle}>Yeni şifrenizi belirleyin</Text>
              <Text style={[styles.subtitle, { marginTop: 6 }]}>{email}</Text>
            </View>

            <View style={styles.form}>
              <Text style={styles.label}>Yeni şifre</Text>
              <TextInput
                style={styles.input}
                placeholder="En az 6 karakter"
                placeholderTextColor={palette.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={pwdNew}
                onChangeText={setPwdNew}
              />
              <Text style={[styles.label, styles.labelSpacing]}>Yeni şifre (tekrar)</Text>
              <TextInput
                style={styles.input}
                placeholder="Tekrar girin"
                placeholderTextColor={palette.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={pwdAgain}
                onChangeText={setPwdAgain}
              />

              {info ? (
                <Text style={[styles.resetInfo, { marginTop: 10, color: palette.error }]}>{info}</Text>
              ) : null}

              <Pressable
                style={[styles.modalButton, { marginTop: 14 }]}
                onPress={() => void onSave()}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>Kaydet</Text>
                )}
              </Pressable>

              <Pressable style={styles.modalLink} onPress={() => navigation.replace("Login")}>
                <Text style={styles.modalLinkText}>Giriş ekranına dön</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
