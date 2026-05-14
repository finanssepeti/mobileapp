import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useAppTheme } from "../theme/ThemeProvider";
import { t } from "../lib/i18n";
import { createYatirimEkleModalStyles } from "./yatirimEkleModalStyles";
import { loadYatirimlarMerged, saveYatirimlar, type StoredYatirim } from "../lib/yatirimStorage";
import { fetchProductQuote, fetchUsdTry } from "../lib/livePrice";

export type YatirimPrefill = {
  urun: string;
  urunArama?: string;
  birimFiyat: string;
  quoteCurrency?: "TRY" | "USD";
  usdTry?: string;
  symbol?: string;
};

type Props = { visible: boolean; onClose: () => void; prefill?: YatirimPrefill | null };

function bugunIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseNum(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR") : "";
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function formatTry(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function YatirimEkleModal({ visible, onClose, prefill }: Props) {
  const { palette, isLight, lang } = useAppTheme();
  const styles = useMemo(() => createYatirimEkleModalStyles(palette, isLight), [palette, isLight]);
  const [tarih, setTarih] = useState(bugunIso());
  const [urun, setUrun] = useState("");
  const [urunArama, setUrunArama] = useState("");
  const [miktar, setMiktar] = useState("");
  const [birimFiyat, setBirimFiyat] = useState("");
  const [seciliSymbol, setSeciliSymbol] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState<"TRY" | "USD">("TRY");
  const [usdTry, setUsdTry] = useState("");
  const [busySearch, setBusySearch] = useState(false);
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState<Date>(parseIsoDate(bugunIso()));

  useEffect(() => {
    if (!visible) return;
    if (!prefill) {
      setTarih(bugunIso());
      setUrun("");
      setUrunArama("");
      setMiktar("");
      setBirimFiyat("");
      setSeciliSymbol("");
      setQuoteCurrency("TRY");
      setUsdTry("");
      return;
    }
    setTarih(bugunIso());
    setUrun(prefill.urun.trim());
    setUrunArama(prefill.urunArama?.trim() ?? "");
    setBirimFiyat(prefill.birimFiyat);
    const qc = prefill.quoteCurrency ?? "TRY";
    setQuoteCurrency(qc);
    setSeciliSymbol(prefill.symbol ?? "");
    if (prefill.usdTry?.trim()) {
      setUsdTry(prefill.usdTry);
    } else if (qc === "USD") {
      setUsdTry("");
      void fetchUsdTry().then((k) => {
        if (k && Number.isFinite(k)) setUsdTry(String(k.toFixed(4)).replace(".", ","));
      });
    } else {
      setUsdTry("");
    }
  }, [visible, prefill]);

  const toplam = useMemo(() => {
    const m = parseNum(miktar);
    const b = parseNum(birimFiyat);
    const kur = parseNum(usdTry);
    if (!Number.isFinite(m) || !Number.isFinite(b)) return 0;
    if (quoteCurrency === "USD") {
      return Number.isFinite(kur) && kur > 0 ? m * b * kur : 0;
    }
    return m * b;
  }, [miktar, birimFiyat, usdTry, quoteCurrency]);

  const tarihLabel = useMemo(() => {
    const [y, m, d] = tarih.split("-");
    return y && m && d ? `${d}.${m}.${y}` : tarih;
  }, [tarih]);

  const acTakvim = () => {
    const cur = parseIsoDate(tarih);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: cur,
        onChange: (ev, selected) => {
          if (ev.type !== "set" || !selected) return;
          const iso = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
          setTarih(iso);
          setPickerValue(selected);
        },
      });
      return;
    }
    setPickerValue(cur);
    setIosPickerOpen(true);
  };

  const onIosDate = (_: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    const iso = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
    setTarih(iso);
    setPickerValue(selected);
  };

  const kaydet = async () => {
    const m = parseNum(miktar);
    const b = parseNum(birimFiyat);
    const kur = parseNum(usdTry);
    if (!urun.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(tarih) || !(m > 0) || !(b > 0)) {
      Alert.alert(t(lang, "error"), t(lang, "invest_err_incomplete"));
      return;
    }
    if (quoteCurrency === "USD" && !(kur > 0)) {
      Alert.alert(t(lang, "error"), t(lang, "invest_err_fx"));
      return;
    }
    const satir: StoredYatirim = {
      id: `yt-${Date.now()}`,
      tarih,
      urun: urun.trim(),
      symbol: seciliSymbol || undefined,
      quoteCurrency,
      usdTryAtBuy: quoteCurrency === "USD" ? kur : undefined,
      miktar: m,
      birimFiyat: b,
      toplamTutar: quoteCurrency === "USD" ? m * b * kur : m * b,
    };
    const mevcut = await loadYatirimlarMerged();
    await saveYatirimlar([satir, ...mevcut]);
    setUrun("");
    setUrunArama("");
    setMiktar("");
    setBirimFiyat("");
    setSeciliSymbol("");
    setQuoteCurrency("TRY");
    setUsdTry("");
    Alert.alert(t(lang, "invest_saved_title"), t(lang, "invest_saved_body"));
  };

  const araUrun = async () => {
    if (!urunArama.trim()) {
      Alert.alert(t(lang, "search_button"), t(lang, "invest_search_need"));
      return;
    }
    setBusySearch(true);
    try {
      const q = await fetchProductQuote(urunArama);
      if (!q) {
        Alert.alert(t(lang, "invest_not_found_title"), t(lang, "invest_not_found_body"));
        return;
      }
      setUrun(q.displayName);
      setSeciliSymbol(q.symbol);
      setQuoteCurrency(q.quoteCurrency);
      setBirimFiyat(String(q.price.toFixed(2)).replace(".", ","));
      if (q.usdBased) {
        const kur = await fetchUsdTry();
        if (kur) setUsdTry(String(kur.toFixed(4)).replace(".", ","));
      } else {
        setUsdTry("");
      }
    } finally {
      setBusySearch(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <View style={styles.headerPad} />
          <Text style={styles.title}>{t(lang, "invest_add_title")}</Text>
          <Pressable onPress={onClose} style={styles.headerPad}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.noteText}>{t(lang, "invest_note_bist")}</Text>

          <Text style={styles.label}>{t(lang, "invest_calendar_window")}</Text>
          <Pressable style={styles.inputPressable} onPress={acTakvim}>
            <Text style={styles.inputPressableText}>{tarihLabel}</Text>
          </Pressable>

          <Text style={styles.label}>{t(lang, "invest_search_label")}</Text>
          <View style={styles.searchRow}>
            <TextInput style={[styles.input, styles.searchInput]} value={urunArama} onChangeText={setUrunArama} placeholder={t(lang, "invest_search_ph")} placeholderTextColor={palette.textMuted} />
            <Pressable style={styles.searchBtn} onPress={() => void araUrun()} disabled={busySearch}>
              {busySearch ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.searchBtnText}>{t(lang, "invest_search_btn")}</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.label}>{t(lang, "invest_product_name")}</Text>
          <TextInput style={styles.input} value={urun} onChangeText={setUrun} placeholder={t(lang, "invest_product_ph")} placeholderTextColor={palette.textMuted} />

          <Text style={styles.label}>{t(lang, "quantity")}</Text>
          <TextInput style={styles.input} value={miktar} onChangeText={(txt) => setMiktar(formatNumInput(txt))} keyboardType="number-pad" placeholder={t(lang, "invest_qty_ph")} placeholderTextColor={palette.textMuted} />

          <Text style={styles.label}>{t(lang, "unit_price")}</Text>
          <TextInput style={styles.input} value={birimFiyat} onChangeText={setBirimFiyat} keyboardType="decimal-pad" placeholder={t(lang, "invest_unit_price_ph")} placeholderTextColor={palette.textMuted} />

          {quoteCurrency === "USD" ? (
            <>
              <Text style={styles.label}>{t(lang, "invest_fx_label")}</Text>
              <TextInput style={styles.input} value={usdTry} onChangeText={setUsdTry} keyboardType="decimal-pad" placeholder={t(lang, "invest_fx_ph")} placeholderTextColor={palette.textMuted} />
            </>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(lang, "invest_total_amount")}</Text>
            <Text style={styles.totalValue}>{formatTry(toplam)}</Text>
          </View>

          <Pressable style={styles.saveBtn} onPress={() => void kaydet()}>
            <Text style={styles.saveText}>{t(lang, "invest_save_btn")}</Text>
          </Pressable>
        </View>

        {Platform.OS === "ios" && iosPickerOpen ? (
          <View style={styles.iosWrap}>
            <View style={styles.iosHead}>
              <Text style={styles.iosTitle}>{t(lang, "invest_ios_pick_title")}</Text>
              <Pressable onPress={() => setIosPickerOpen(false)}>
                <Text style={styles.iosDone}>{t(lang, "invest_ios_done")}</Text>
              </Pressable>
            </View>
            <DateTimePicker value={pickerValue} mode="date" display="spinner" onChange={onIosDate} />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
