import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useThemeColors } from "../theme/ThemeProvider";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Privacy">;
};

export function PrivacyScreen({ navigation }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: {
          flex: 1,
          backgroundColor: palette.background,
        },
        header: {
          height: 56,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          backgroundColor: palette.surface,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        back: {
          color: palette.accent,
          fontWeight: "700",
          fontSize: 15,
        },
        title: {
          color: palette.text,
          fontWeight: "700",
          fontSize: 16,
        },
        spacer: {
          width: 32,
        },
        content: {
          padding: 20,
          gap: 8,
        },
        h2: {
          fontSize: 16,
          fontWeight: "700",
          color: palette.text,
          marginTop: 10,
        },
        p: {
          fontSize: 14,
          lineHeight: 22,
          color: palette.text,
        },
      }),
    [palette],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Geri</Text>
        </Pressable>
        <Text style={styles.title}>Gizlilik Sözleşmesi</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h2}>1) Kapsam ve Tanımlar</Text>
        <Text style={styles.p}>
          Bu sözleşme, FinansSepeti uygulamasını kullanan tüm bireysel ve kurumsal
          kullanıcıların kişisel verilerinin işlenmesine ilişkin esasları düzenler.
          Uygulamayı kullanarak bu metindeki hükümleri kabul etmiş sayılırsınız.
        </Text>

        <Text style={styles.h2}>2) İşlenen Veri Kategorileri</Text>
        <Text style={styles.p}>
          Kimlik ve iletişim bilgileri (ad-soyad, e-posta), hesap güvenliği verileri
          (şifre hash, oturum kayıtları), finansal kullanım verileri ve teknik günlük
          kayıtları hizmetin sunulması amacıyla işlenebilir.
        </Text>

        <Text style={styles.h2}>3) Veri İşleme Amaçları</Text>
        <Text style={styles.p}>
          Veriler; kullanıcı hesabının oluşturulması, kimlik doğrulama, finansal
          raporlama, güvenlik kontrolleri, hata analizi, hizmet kalitesinin artırılması
          ve yasal yükümlülüklerin yerine getirilmesi amaçlarıyla işlenir.
        </Text>

        <Text style={styles.h2}>4) Saklama Süresi ve Güvenlik</Text>
        <Text style={styles.p}>
          Kişisel veriler, ilgili mevzuatta öngörülen süreler boyunca veya işleme
          amacının gerektirdiği süre kadar saklanır. Verilerin gizliliği, bütünlüğü
          ve erişilebilirliği için teknik ve idari güvenlik tedbirleri uygulanır.
        </Text>

        <Text style={styles.h2}>5) Üçüncü Taraf Hizmet Sağlayıcılar</Text>
        <Text style={styles.p}>
          Kimlik doğrulama, altyapı, bildirim ve analiz süreçlerinde üçüncü taraf
          hizmet sağlayıcılar kullanılabilir. Bu servis sağlayıcılar, kendi gizlilik
          politikaları çerçevesinde veri işleyebilir.
        </Text>

        <Text style={styles.h2}>6) Kullanıcı Hakları</Text>
        <Text style={styles.p}>
          Kullanıcılar; verilerine erişim, düzeltme, silme, işleme itiraz etme ve
          mevzuat kapsamındaki diğer haklarını ilgili kanallar üzerinden talep edebilir.
        </Text>

        <Text style={styles.h2}>7) Sözleşme Değişiklikleri</Text>
        <Text style={styles.p}>
          FinansSepeti, işbu sözleşmede mevzuata ve hizmet kapsamına uygun şekilde
          değişiklik yapma hakkını saklı tutar. Güncel metin uygulama içinde yayımlanır.
        </Text>

        <Text style={styles.h2}>8) İletişim</Text>
        <Text style={styles.p}>
          Gizlilik ve veri işleme süreçleri hakkında sorularınız için uygulama içinde
          yer alan iletişim kanallarından bizimle iletişime geçebilirsiniz.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
