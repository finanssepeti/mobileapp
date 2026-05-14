import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useThemeColors } from "../theme/ThemeProvider";
import { createYatirimModalStyles } from "./yatirimModalStyles";
import { loadYatirimlarMerged, saveYatirimlar, type StoredYatirim } from "../lib/yatirimStorage";

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Tab = "gunluk" | "aylik" | "yillik";

function bugun() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseNum(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function formatInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR") : "";
}

function formatTry(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

export function YatirimModal({ visible, onClose }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(() => createYatirimModalStyles(palette), [palette]);

  const [tab, setTab] = useState<Tab>("gunluk");
  const [list, setList] = useState<StoredYatirim[]>([]);
  const [tarih, setTarih] = useState(bugun());
  const [urun, setUrun] = useState("");
  const [miktarStr, setMiktarStr] = useState("");
  const [birimStr, setBirimStr] = useState("");
  const [urunFiltre, setUrunFiltre] = useState("");
  const [yil, setYil] = useState(new Date().getFullYear().toString());
  const [ay, setAy] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState<Date>(() => parseIsoDate(bugun()));

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const items = await loadYatirimlarMerged();
      setList(items);
    })();
  }, [visible]);

  const toplamTutar = useMemo(() => {
    const m = parseNum(miktarStr);
    const b = parseNum(birimStr);
    return Number.isFinite(m) && Number.isFinite(b) ? m * b : 0;
  }, [miktarStr, birimStr]);

  const gunlukRows = useMemo(() => list.filter((x) => x.tarih === tarih), [list, tarih]);
  const aylikKey = `${yil}-${ay}`;
  const aylikRows = useMemo(() => list.filter((x) => x.tarih.startsWith(aylikKey)), [list, aylikKey]);
  const aylikToplamYatirimTutari = useMemo(
    () => aylikRows.reduce((a, r) => a + r.toplamTutar, 0),
    [aylikRows],
  );
  const aylikToplamFiyat = useMemo(
    () => aylikRows.reduce((a, r) => a + r.birimFiyat, 0),
    [aylikRows],
  );

  const yillikRows = useMemo(() => {
    const base = list.filter((x) => x.tarih.startsWith(`${yil}-`));
    const q = urunFiltre.trim().toLocaleLowerCase("tr");
    const filtered = q ? base.filter((x) => x.urun.toLocaleLowerCase("tr").includes(q)) : base;
    const m = new Map<string, { miktar: number; toplam: number; adet: number }>();
    for (const r of filtered) {
      const prev = m.get(r.urun) ?? { miktar: 0, toplam: 0, adet: 0 };
      prev.miktar += r.miktar;
      prev.toplam += r.toplamTutar;
      prev.adet += 1;
      m.set(r.urun, prev);
    }
    return [...m.entries()].map(([urunAd, v]) => ({
      urun: urunAd,
      miktar: v.miktar,
      ortBirim: v.miktar > 0 ? v.toplam / v.miktar : 0,
      toplam: v.toplam,
      adet: v.adet,
    }));
  }, [list, yil, urunFiltre]);
  const yillikToplamYatirimTutari = useMemo(
    () => yillikRows.reduce((a, r) => a + r.toplam, 0),
    [yillikRows],
  );
  const yillikToplamFiyat = useMemo(
    () => yillikRows.reduce((a, r) => a + r.ortBirim, 0),
    [yillikRows],
  );

  const kaydetGunluk = async () => {
    const m = parseNum(miktarStr);
    const b = parseNum(birimStr);
    if (!urun.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(tarih) || !(m > 0) || !(b > 0)) {
      Alert.alert("Eksik bilgi", "Ürün, tarih, miktar ve birim fiyat bilgilerini kontrol edin.");
      return;
    }
    const row: StoredYatirim = {
      id: `yt-${Date.now()}`,
      tarih,
      urun: urun.trim(),
      miktar: m,
      birimFiyat: b,
      toplamTutar: m * b,
    };
    const next = [row, ...list];
    setList(next);
    await saveYatirimlar(next);
    setYil(tarih.slice(0, 4));
    setAy(tarih.slice(5, 7));
    setUrun("");
    setMiktarStr("");
    setBirimStr("");
    Alert.alert("Kaydedildi", "Günlük portföye kaydedildi.");
  };

  const openDatePicker = () => {
    const cur = parseIsoDate(tarih);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: cur,
        onChange: (event, selectedDate) => {
          if (event.type !== "set" || !selectedDate) return;
          const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
          setDatePickerValue(selectedDate);
          setTarih(iso);
          setYil(iso.slice(0, 4));
          setAy(iso.slice(5, 7));
        },
      });
      return;
    }
    setDatePickerValue(cur);
    setDatePickerOpen(true);
  };

  const onDatePickerChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) return;
    setDatePickerValue(selectedDate);
    const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
    setTarih(iso);
    setYil(iso.slice(0, 4));
    setAy(iso.slice(5, 7));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable style={styles.headerBtn} onPress={onClose}>
            <Text style={styles.headerBtnText}>← Geri</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Yatırım Ekle</Text>
          <Pressable style={styles.headerBtn} onPress={onClose}>
            <Text style={styles.headerBtnText}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.tabRow}>
          {[
            ["gunluk", "Günlük Portföy"],
            ["aylik", "Aylık Portföy"],
            ["yillik", "Yıllık Portföy"],
          ].map(([k, l]) => (
            <Pressable key={k} style={[styles.tabBtn, tab === k && styles.tabOn]} onPress={() => setTab(k as Tab)}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{l}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {tab === "gunluk" ? (
            <View>
              <Text style={styles.label}>Tarih (YYYY-AA-GG)</Text>
              <Pressable style={styles.inputPressable} onPress={openDatePicker}>
                <Text style={styles.inputPressableText}>{tarih}</Text>
              </Pressable>
              <Text style={styles.label}>Ürün</Text>
              <TextInput style={styles.input} value={urun} onChangeText={setUrun} placeholder="Altın, Hisse..." placeholderTextColor={palette.textMuted} />
              <Text style={styles.label}>Miktar</Text>
              <TextInput style={styles.input} value={miktarStr} onChangeText={(t) => setMiktarStr(formatInput(t))} keyboardType="number-pad" placeholder="0" placeholderTextColor={palette.textMuted} />
              <Text style={styles.label}>Birim Fiyat</Text>
              <TextInput style={styles.input} value={birimStr} onChangeText={(t) => setBirimStr(formatInput(t))} keyboardType="number-pad" placeholder="0" placeholderTextColor={palette.textMuted} />
              <View style={styles.row}>
                <Text style={styles.totalText}>Toplam Tutar</Text>
                <Text style={styles.totalVal}>{formatTry(toplamTutar)}</Text>
              </View>
              <Pressable style={styles.primaryBtn} onPress={() => void kaydetGunluk()}>
                <Text style={styles.primaryBtnText}>Günlük Portföye Kaydet</Text>
              </Pressable>
              <Text style={styles.sectionTitle}>Günlük Portföy (Kaydedilenler)</Text>
              <View style={styles.tableHead}>
                <Text style={[styles.cellH, styles.cUrun]}>Ürün</Text>
                <Text style={[styles.cellH, styles.cNum]}>Miktar</Text>
                <Text style={[styles.cellH, styles.cNum]}>Birim</Text>
                <Text style={[styles.cellH, styles.cNum]}>Toplam</Text>
              </View>
              {gunlukRows.map((r) => (
                <View key={r.id} style={styles.tableRow}>
                  <Text style={[styles.cell, styles.cUrun]}>{r.urun}</Text>
                  <Text style={[styles.cell, styles.cNum]}>{r.miktar.toLocaleString("tr-TR")}</Text>
                  <Text style={[styles.cell, styles.cNum]}>{formatTry(r.birimFiyat)}</Text>
                  <Text style={[styles.cell, styles.cNum]}>{formatTry(r.toplamTutar)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {tab === "aylik" ? (
            <View>
              <Text style={styles.label}>Yıl / Ay</Text>
              <View style={styles.filterRow}>
                <TextInput style={[styles.input, styles.flex]} value={yil} onChangeText={setYil} keyboardType="number-pad" />
                <TextInput style={[styles.input, styles.flex]} value={ay} onChangeText={setAy} keyboardType="number-pad" />
              </View>
              <Text style={styles.sectionTitle}>Aylık Portföy ({aylikKey})</Text>
              <View style={styles.tableCard}>
                <View style={styles.tableHead}>
                  <Text style={[styles.cellH, styles.cDate]}>Tarih</Text>
                  <Text style={[styles.cellH, styles.cUrun]}>Ürün</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Miktar</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Birim</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Toplam</Text>
                </View>
                {aylikRows.map((r) => (
                  <View key={r.id} style={styles.tableRow}>
                    <Text style={[styles.cell, styles.cDate]}>{r.tarih}</Text>
                    <Text style={[styles.cell, styles.cUrun]}>{r.urun}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{r.miktar.toLocaleString("tr-TR")}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{formatTry(r.birimFiyat)}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{formatTry(r.toplamTutar)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toplam yatırım tutarı</Text>
                  <Text style={styles.summaryValue}>{formatTry(aylikToplamYatirimTutari)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toplam fiyat</Text>
                  <Text style={styles.summaryValue}>{formatTry(aylikToplamFiyat)}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {tab === "yillik" ? (
            <View>
              <Text style={styles.label}>Yıl</Text>
              <TextInput style={styles.input} value={yil} onChangeText={setYil} keyboardType="number-pad" />
              <Text style={styles.label}>Ürün Ara</Text>
              <TextInput style={styles.input} value={urunFiltre} onChangeText={setUrunFiltre} placeholder="ürün adı..." placeholderTextColor={palette.textMuted} />
              <Text style={styles.sectionTitle}>Yıllık Portföy Excel Tablosu ({yil})</Text>
              <View style={styles.tableCard}>
                <View style={styles.tableHead}>
                  <Text style={[styles.cellH, styles.cUrun]}>Ürün</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Toplam Miktar</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Ortalama Birim Fiyat</Text>
                  <Text style={[styles.cellH, styles.cNum]}>Toplam Tutar</Text>
                  <Text style={[styles.cellH, styles.cNum]}>İşlem</Text>
                </View>
                {yillikRows.map((r) => (
                  <View key={r.urun} style={styles.tableRow}>
                    <Text style={[styles.cell, styles.cUrun]}>{r.urun}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{r.miktar.toLocaleString("tr-TR")}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{formatTry(r.ortBirim)}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{formatTry(r.toplam)}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{r.adet}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toplam yatırım tutarı</Text>
                  <Text style={styles.summaryValue}>{formatTry(yillikToplamYatirimTutari)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toplam fiyat</Text>
                  <Text style={styles.summaryValue}>{formatTry(yillikToplamFiyat)}</Text>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
        {Platform.OS === "ios" && datePickerOpen ? (
          <View style={styles.iosDateWrap}>
            <View style={styles.iosDateHead}>
              <Text style={styles.iosDateTitle}>Tarih seç</Text>
              <Pressable onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.iosDateDone}>Tamam</Text>
              </Pressable>
            </View>
            <DateTimePicker value={datePickerValue} mode="date" display="spinner" onChange={onDatePickerChange} />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}



