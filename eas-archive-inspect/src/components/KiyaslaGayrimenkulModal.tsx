import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAppTheme } from "../theme/ThemeProvider";
import { indirilenDosyayiAc, kaydetExcelHtmlDosyasi, kaydetPdfYazdirmaCiktisi } from "../lib/deviceExport";
import * as Print from "expo-print";
import { t } from "../lib/i18n";
import {
  computeKiyaslaRows,
  KIYASLA_ASSETS,
  type KiyaslaRow,
  type KiyaslaComputeInput,
} from "../lib/kiyaslaProviders";
import { fetchRisersLosers, type TrendRow } from "../lib/risersLosersProviders";
import type { MarketCategory, PeriodKey } from "../lib/marketUniverses";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Dış menüden (ör. Düşenler) hangi üst sekmenin açılacağı */
  initialTopTab?: "compare" | "risers" | "fallers";
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}
function parseTryInput(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function formatTryInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}
function formatTry(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return `₺${safe.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function formatCurrency(n: number, symbol: "₺" | "$", fractionDigits = 2): string {
  const safe = Number.isFinite(n) ? n : 0;
  return `${symbol}${safe.toLocaleString("tr-TR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function rowsToExcelHtml(rows: KiyaslaRow[], meta: { total: string; selected: string }): string {
  const head = "<tr><th>Varlık</th><th>Peşinat Getirisi</th><th>Kredi Getirisi</th><th>Toplam Tutar</th></tr>";
  const body = rows
    .map((r) => {
      const pes = r.pesinatGetirisi == null ? "" : formatTry(r.pesinatGetirisi);
      const kre = r.krediGetirisi == null ? "" : formatTry(r.krediGetirisi);
      const top = r.toplamTutar == null ? "" : formatTry(r.toplamTutar);
      return `<tr><td>${r.asset.label}</td><td>${pes}</td><td>${kre}</td><td>${top}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body{font-family:Arial;padding:14px}
  h2{margin:0 0 10px}
  .meta{font-size:12px;color:#444;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #999;padding:6px}
  th{text-align:left;background:#f2f2f2}
  td:nth-child(2),td:nth-child(3),td:nth-child(4){text-align:right}
  </style></head><body>
  <h2>Ürün Fiyat Karşılaştırma</h2>
  <div class="meta">Toplam: ${meta.total} | Tarih: ${meta.selected}</div>
  <table>${head}${body}</table>
  </body></html>`;
}

export function KiyaslaGayrimenkulModal({ visible, onClose, initialTopTab = "compare" }: Props) {
  const { palette, isLight, lang } = useAppTheme();
  const URUN_KATEGORILERI = [
    "Ev",
    "Arsa",
    "Tarla",
    "Araba",
    "TV",
    "Beyaz Eşya",
    "Telefon",
    "Bilgisayar",
    "Salon Takımı",
    "Ev Tadilatı",
    "Yatak Odası Takımı",
    "Çocuk Odası Takımı",
    "Kişisel Eşyalar",
  ] as const;

  const [totalTutar, setTotalTutar] = useState("");
  const [urunKategori, setUrunKategori] = useState<(typeof URUN_KATEGORILERI)[number]>("Ev");
  const [kategoriOpen, setKategoriOpen] = useState(false);
  const [krediYok, setKrediYok] = useState(false);
  const [aylikTaksit, setAylikTaksit] = useState("");
  const [pesinatIso, setPesinatIso] = useState(ymd(new Date()));
  const [ilkTaksitIso, setIlkTaksitIso] = useState(ymd(new Date()));
  const [taksitSayisi, setTaksitSayisi] = useState("120");
  const [selectedIso, setSelectedIso] = useState(ymd(new Date()));

  const [busy, setBusy] = useState(false);
  const [resultRows, setResultRows] = useState<KiyaslaRow[] | null>(null);
  const [activeTab, setActiveTab] = useState<"compare" | "risers" | "fallers">("compare");
  const [period, setPeriod] = useState<PeriodKey>("1W");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [category, setCategory] = useState<MarketCategory>("emtia");
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [trendBusy, setTrendBusy] = useState(false);
  /** Yükselenler/Düşenler için en az bir istek tamamlandı mı (boş sonuç ile ayırt etmek için) */
  const [trendFetchedOnce, setTrendFetchedOnce] = useState(false);
  /** Aynı anda birden fazla fetch olunca geç tamamlanan “borsa” yanıtı “kripto” üzerine yazabiliyor; sıra ile iptal et. */
  const trendFetchSeqRef = useRef(0);

  useEffect(() => {
    if (!visible) {
      setTrendRows([]);
      setTrendBusy(false);
      setTrendFetchedOnce(false);
    }
  }, [visible]);

  const pesinatNum = parseTryInput(totalTutar);
  const taksitNum = parseTryInput(aylikTaksit);
  const taksitAdediNum = parseInt(taksitSayisi.replace(/\D/g, ""), 10);
  const toplamTutarHesap = Math.max(
    0,
    (Number.isFinite(pesinatNum) ? pesinatNum : 0) +
      (krediYok ? 0 : Number.isFinite(taksitNum) && Number.isFinite(taksitAdediNum) ? taksitNum * taksitAdediNum : 0),
  );
  const toplamTutarLabel = toplamTutarHesap.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

  const styles = useMemo(
    () => {
      const panelBg = isLight ? "#ffffff" : "#06185b";
      const pageBg = isLight ? "#f8fbff" : "#051245";
      const textMain = isLight ? "#1f3a8a" : "#e2e8f0";
      const textSub = isLight ? "#1e40af" : "#93c5fd";
      const border = isLight ? "rgba(30,64,175,0.35)" : "rgba(96,165,250,0.35)";
      const inputBg = isLight ? "#ffffff" : "#020c3a";
      const headerBg = isLight ? "#ffffff" : "#051245";
      return StyleSheet.create({
        safe: { flex: 1, backgroundColor: palette.background },
        header: {
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 1,
          borderBottomColor: border,
          backgroundColor: headerBg,
        },
        title: { flex: 1, color: isLight ? "#1f3a8a" : "#e2ecff", fontWeight: "900", fontSize: 33 / 2 },
        closeWrap: {
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: border,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isLight ? "#eef4ff" : "rgba(15,23,42,0.45)",
        },
        close: { color: isLight ? "#1f3a8a" : "#dbeafe", fontSize: 18, fontWeight: "900" },
        topTabsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
        topTabBtn: {
          flex: 1,
          borderRadius: 10,
          paddingVertical: 8,
          alignItems: "center",
          borderWidth: 1,
          borderColor: border,
          backgroundColor: panelBg,
          minHeight: 46,
          justifyContent: "center",
          overflow: "hidden",
        },
        topTabBtnOn: { backgroundColor: "rgba(249,115,22,0.35)", borderColor: "rgba(249,115,22,0.95)" },
        pressOrange: { backgroundColor: "rgba(249,115,22,0.28)", borderColor: "rgba(249,115,22,0.95)" },
        topTabTxt: { color: isLight ? "#1f3a8a" : "#dbeafe", fontSize: 10.5, fontWeight: "800", textAlign: "center" },
        topTabTxtTrend: {
          color: isLight ? "#1f3a8a" : "#dbeafe",
          fontSize: 12.8,
          fontWeight: "800",
          textAlign: "center",
        },
        scroll: { flex: 1 },
        content: { padding: 14, paddingBottom: 20, backgroundColor: pageBg },
        card: {
          backgroundColor: panelBg,
          borderWidth: 1,
          borderColor: border,
          borderRadius: 14,
          padding: 12,
          marginBottom: 12,
        },
        label: { color: textMain, fontSize: 16 / 1.2, fontWeight: "700", marginBottom: 6 },
        input: {
          borderWidth: 1,
          borderColor: border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: textMain,
          backgroundColor: inputBg,
          fontWeight: "800",
        },
        row2: { flexDirection: "row", gap: 10 },
        col: { flex: 1 },
        rowLabelFixed: { minHeight: 36 },
        toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
        toggleBtn: {
          borderRadius: 10,
          borderWidth: 1,
          borderColor: palette.border,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: palette.background,
        },
        toggleBtnOn: { backgroundColor: "rgba(37,99,235,0.18)", borderColor: "rgba(37,99,235,0.55)" },
        toggleTxt: { color: palette.text, fontWeight: "900", fontSize: 12 },
        hint: { color: textSub, fontSize: 12, lineHeight: 18, marginTop: 8, fontWeight: "600" },
        primaryBtn: {
          borderRadius: 12,
          backgroundColor: "#38bdf8",
          paddingVertical: 12,
          alignItems: "center",
          justifyContent: "center",
          minHeight: 46,
        },
        primaryTxt: { color: "#0b1d4f", fontSize: 14, fontWeight: "900" },
        tableHead: {
          flexDirection: "row",
          gap: 8,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: border,
        },
        th: { color: textSub, fontSize: 11, fontWeight: "900" },
        tr: {
          flexDirection: "row",
          gap: 8,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: isLight ? "rgba(30,64,175,0.2)" : "rgba(96,165,250,0.2)",
        },
        td: { color: textMain, fontSize: 12, fontWeight: "800" },
        tdMuted: { color: textSub, fontSize: 11, fontWeight: "700" },
        wVar: { flex: 1.2 },
        wCol: { flex: 1 },
        tdNumber: { fontSize: 10.5, flexShrink: 1 },
        tableCellNoWrap: { flexShrink: 1, minWidth: 0 },
        bottomRow: { flexDirection: "row", gap: 10, marginTop: 12 },
        bottomBtn: {
          flex: 1,
          borderRadius: 12,
          paddingVertical: 12,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: border,
          backgroundColor: panelBg,
        },
        bottomBtnGreen: { backgroundColor: "rgba(34,197,94,0.2)", borderColor: "rgba(34,197,94,0.5)" },
        bottomBtnRed: { backgroundColor: "rgba(239,68,68,0.16)", borderColor: "rgba(239,68,68,0.5)" },
        bottomTxt: { color: textMain, fontWeight: "900", fontSize: 13 },
        rowInlineLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
        checkbox: {
          width: 20,
          height: 20,
          borderWidth: 1.5,
          borderColor: isLight ? "rgba(30,64,175,0.7)" : "rgba(191,219,254,0.8)",
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isLight ? "#ffffff" : "#02103f",
        },
        checkboxOn: { backgroundColor: "#dbeafe", borderColor: "#dbeafe" },
        checkboxTick: { color: "#0b1d4f", fontSize: 14, fontWeight: "900" },
        yokLabel: { color: textMain, fontWeight: "800", fontSize: 16 / 1.2 },
        dropdownList: {
          marginTop: 6,
          borderWidth: 1,
          borderColor: border,
          borderRadius: 12,
          backgroundColor: inputBg,
          overflow: "hidden",
        },
        dropdownItem: {
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: isLight ? "rgba(30,64,175,0.2)" : "rgba(96,165,250,0.2)",
        },
        dropdownItemText: { color: textMain, fontWeight: "700" },
        segmentRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
        periodBtn: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
        /** Zaman dilimi kutusu ile Emtia/Borsa/Nasdaq/Kripto satırı arasında nefes payı */
        categoryRow: { flexDirection: "row", gap: 11, marginTop: 16, marginBottom: 10 },
        categoryBtn: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
        segmentBtn: {
          borderRadius: 10,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: panelBg,
          paddingVertical: 8,
          paddingHorizontal: 10,
          overflow: "hidden",
        },
        segmentBtnOn: { backgroundColor: "rgba(249,115,22,0.35)", borderColor: "rgba(249,115,22,0.95)" },
        segmentTxt: { color: textMain, fontSize: 11.5, fontWeight: "800", textAlign: "center" },
        periodDropdownList: {
          marginTop: 8,
          marginBottom: 4,
          borderWidth: 1,
          borderColor: border,
          borderRadius: 12,
          backgroundColor: inputBg,
          overflow: "hidden",
        },
        periodDropdownItem: {
          paddingHorizontal: 12,
          paddingVertical: 11,
          borderBottomWidth: 1,
          borderBottomColor: isLight ? "rgba(30,64,175,0.2)" : "rgba(96,165,250,0.2)",
        },
        trendHeader: {
          flexDirection: "row",
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: border,
          paddingBottom: 8,
          marginBottom: 4,
        },
        trendRow: {
          flexDirection: "row",
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: isLight ? "rgba(30,64,175,0.2)" : "rgba(96,165,250,0.2)",
          paddingVertical: 9,
        },
        trendName: { flex: 1.3, color: textMain, fontWeight: "800", fontSize: 12 },
        trendCol: { flex: 1, color: textMain, fontWeight: "700", fontSize: 11 },
      });
    },
    [palette, isLight],
  );

  const openDatePicker = (target: "selected" | "first" | "pesinat") => {
    if (Platform.OS !== "android") return;
    const cur = parseYmd(target === "selected" ? selectedIso : target === "first" ? ilkTaksitIso : pesinatIso);
    DateTimePickerAndroid.open({
      mode: "date",
      value: cur,
      onChange: (_e, selected) => {
        if (!selected) return;
        const iso = ymd(selected);
        if (target === "selected") setSelectedIso(iso);
        else if (target === "first") setIlkTaksitIso(iso);
        else setPesinatIso(iso);
      },
    });
  };

  const runCompare = async () => {
    const total = parseTryInput(totalTutar);
    const taksit = parseTryInput(aylikTaksit);
    const n = parseInt(taksitSayisi.replace(/\D/g, ""), 10);
    if (!Number.isFinite(total) || total <= 0) {
      Alert.alert("Error", t(lang, "down_payment_amount"));
      return;
    }
    if (selectedIso < pesinatIso) {
      Alert.alert("Error", "Comparison date cannot be before down payment date.");
      return;
    }
    if (!krediYok && selectedIso < ilkTaksitIso) {
      Alert.alert("Error", "Comparison date cannot be before first installment date.");
      return;
    }
    if (!krediYok && ((Number.isFinite(taksit) && taksit > 0) || (Number.isFinite(n) && n > 0))) {
      if (!Number.isFinite(taksit) || taksit <= 0) {
        Alert.alert("Error", t(lang, "monthly_installment_amount"));
        return;
      }
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert("Error", "Invalid installment count.");
        return;
      }
    }
    setBusy(true);
    setResultRows(null);
    try {
      const input: KiyaslaComputeInput = {
        pesinatIso,
        kiyasIso: selectedIso,
        pesinatTutarTry: total,
        krediYok: krediYok || !(Number.isFinite(taksit) && taksit > 0 && Number.isFinite(n) && n > 0),
        aylikTaksitTry: krediYok ? 0 : Number.isFinite(taksit) && taksit > 0 ? taksit : 0,
        ilkTaksitIso,
        taksitSayisi: krediYok ? 0 : Number.isFinite(n) && n > 0 ? n : 0,
      };
      const out = await computeKiyaslaRows(input);
      // sırayı tabloyla birebir koru
      const keyed = new Map(out.map((r) => [r.asset.key, r]));
      const ordered = KIYASLA_ASSETS.map(
        (a) =>
          keyed.get(a.key) ?? { asset: a, pesinatGetirisi: null, krediGetirisi: null, toplamTutar: null, error: "Veri yok" },
      );
      setResultRows(ordered);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Hata", msg);
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    if (!resultRows) return;
    try {
      const html = rowsToExcelHtml(resultRows, { total: totalTutar || "₺", selected: formatDateLabel(selectedIso) });
      const saved = await kaydetExcelHtmlDosyasi(html);
      Alert.alert("Excel Downloaded", undefined, [
        { text: t(lang, "close"), style: "cancel" },
        { text: "Open File", onPress: () => void indirilenDosyayiAc(saved.acmaUri, saved.mimeType) },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Hata", msg);
    }
  };

  const exportPdf = async () => {
    if (!resultRows) return;
    try {
      const html = rowsToExcelHtml(resultRows, { total: totalTutar || "₺", selected: formatDateLabel(selectedIso) });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const saved = await kaydetPdfYazdirmaCiktisi(uri);
      Alert.alert("PDF Downloaded", undefined, [
        { text: t(lang, "close"), style: "cancel" },
        { text: "Open File", onPress: () => void indirilenDosyayiAc(saved.acmaUri, saved.mimeType) },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Hata", msg);
    }
  };

  const runTrend = async (mode: "risers" | "fallers", p: PeriodKey, c: MarketCategory) => {
    const seq = ++trendFetchSeqRef.current;
    setTrendBusy(true);
    setTrendRows([]);
    try {
      const rows = await fetchRisersLosers({ mode, period: p, category: c });
      if (seq !== trendFetchSeqRef.current) return;
      setTrendRows(rows);
    } catch (e) {
      if (seq !== trendFetchSeqRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Hata", msg);
    } finally {
      if (seq === trendFetchSeqRef.current) {
        setTrendBusy(false);
        setTrendFetchedOnce(true);
      }
    }
  };

  useEffect(() => {
    if (!visible) return;
    setActiveTab(initialTopTab);
    if (initialTopTab === "risers" || initialTopTab === "fallers") {
      void runTrend(initialTopTab, period, category);
    }
  }, [visible, initialTopTab]);

  const periodOptions: Array<{ key: PeriodKey; label: string }> = [
    { key: "1W", label: t(lang, "period_weekly") },
    { key: "1M", label: t(lang, "period_monthly") },
    { key: "3M", label: t(lang, "period_3month") },
    { key: "6M", label: t(lang, "period_6month") },
    { key: "1Y", label: t(lang, "period_yearly") },
  ];
  const categoryOptions: Array<{ key: MarketCategory; label: string }> = [
    { key: "emtia", label: "Emtia" },
    { key: "borsa", label: "Borsa" },
    { key: "nasdaq", label: "Nasdaq" },
    { key: "kripto", label: "Kripto" },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Text style={styles.title}>{t(lang, "compare")}</Text>
          <Pressable onPress={onClose} style={styles.closeWrap}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.topTabsRow}>
            <Pressable
              style={({ pressed }) => [styles.topTabBtn, activeTab === "compare" && styles.topTabBtnOn, pressed && styles.pressOrange]}
              onPress={() => setActiveTab("compare")}
            >
              <Text style={styles.topTabTxt}>{t(lang, "kiyasla_title")}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.topTabBtn, activeTab === "risers" && styles.topTabBtnOn, pressed && styles.pressOrange]}
              onPress={() => {
                setActiveTab("risers");
                void runTrend("risers", period, category);
              }}
            >
              <Text style={styles.topTabTxtTrend}>{t(lang, "kiyasla_risers")}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.topTabBtn, activeTab === "fallers" && styles.topTabBtnOn, pressed && styles.pressOrange]}
              onPress={() => {
                setActiveTab("fallers");
                void runTrend("fallers", period, category);
              }}
            >
              <Text style={styles.topTabTxtTrend}>{t(lang, "kiyasla_fallers")}</Text>
            </Pressable>
          </View>

          {activeTab === "compare" ? (
            <>
              <View style={styles.card}>
            <Text style={styles.label}>Ürün Kategorisi</Text>
            <Pressable
              style={[styles.input, { justifyContent: "space-between", flexDirection: "row", alignItems: "center" }]}
              onPress={() => setKategoriOpen((v) => !v)}
            >
              <Text style={{ color: styles.td.color, fontWeight: "900" }}>{urunKategori}</Text>
              <Text style={{ color: "#93c5fd", fontWeight: "900" }}>{kategoriOpen ? "⌃" : "⌄"}</Text>
            </Pressable>
            {kategoriOpen ? (
              <View style={styles.dropdownList}>
                {URUN_KATEGORILERI.map((k, idx) => (
                  <Pressable
                    key={k}
                    style={[styles.dropdownItem, idx === URUN_KATEGORILERI.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => {
                      setUrunKategori(k);
                      setKategoriOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{k}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t(lang, "down_payment_amount")}</Text>
            <TextInput
              value={totalTutar}
              onChangeText={(t) => setTotalTutar(formatTryInput(t))}
              placeholder="₺"
              placeholderTextColor={palette.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t(lang, "down_payment_date")}</Text>
            <Pressable style={styles.input} onPress={() => openDatePicker("pesinat")}>
                <Text style={{ color: styles.td.color, fontWeight: "900" }}>{formatDateLabel(pesinatIso)}</Text>
            </Pressable>

            <View style={{ height: 10 }} />
            <Text style={styles.label}>{t(lang, "loan_payment_type")}</Text>
            <View style={[styles.input, { justifyContent: "space-between", flexDirection: "row", alignItems: "center" }]}>
              <Text style={{ color: styles.td.color, fontWeight: "900" }}>{krediYok ? t(lang, "no_option") : t(lang, "yes_option")}</Text>
              <Text style={{ color: "#93c5fd", fontWeight: "900" }}>⌄</Text>
            </View>
            <View style={{ height: 10 }} />
            <View style={[styles.rowInlineLabel, { justifyContent: "space-between" }]}>
              <Text style={styles.label}>{t(lang, "monthly_installment_amount")}</Text>
              <Pressable style={styles.rowInlineLabel} onPress={() => setKrediYok((v) => !v)}>
                <View style={[styles.checkbox, krediYok && styles.checkboxOn]}>
                  {krediYok ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.yokLabel}>{t(lang, "no_option")}</Text>
              </Pressable>
            </View>
            <TextInput
              value={aylikTaksit}
              onChangeText={(t) => setAylikTaksit(formatTryInput(t))}
              placeholder="₺"
              placeholderTextColor={palette.textMuted}
              keyboardType="number-pad"
              style={styles.input}
              editable={!krediYok}
            />
            <View style={{ height: 10 }} />
            <View style={styles.row2}>
              <View style={styles.col}>
                <Text style={[styles.label, styles.rowLabelFixed]}>{t(lang, "first_installment_date")}</Text>
                <Pressable style={styles.input} onPress={() => openDatePicker("first")}>
                  <Text style={{ color: styles.td.color, fontWeight: "900" }}>{formatDateLabel(ilkTaksitIso)}</Text>
                </Pressable>
              </View>
              <View style={styles.col}>
                <Text style={[styles.label, styles.rowLabelFixed]}>{t(lang, "installment_count_month")}</Text>
                <TextInput
                  value={taksitSayisi}
                  onChangeText={(t) => setTaksitSayisi(t.replace(/\D/g, ""))}
                  placeholder="Ay (yoksa 0)"
                  placeholderTextColor={palette.textMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                  editable={!krediYok}
                />
              </View>
            </View>
            <View style={{ height: 10 }} />
            <View>
              <Text style={styles.label}>{t(lang, "compare_date")}</Text>
              <Pressable style={styles.input} onPress={() => openDatePicker("selected")}>
                <Text style={{ color: styles.td.color, fontWeight: "900" }}>{formatDateLabel(selectedIso)}</Text>
              </Pressable>
            </View>

            <Text style={styles.hint}>
              Seçtiğiniz tarihteki (veya o güne kadar son bilinen) değerlere göre peşinat ve aylık birikimlerinizin
              altın, gümüş, dolar, euro vb. TL karşılığı hesaplanır. (Bazı kalemler API anahtarı gerektirebilir.)
            </Text>
            <Text style={[styles.label, { marginTop: 8 }]}>Toplam Tutar</Text>
            <TextInput
              value={toplamTutarLabel}
              placeholder="₺"
              placeholderTextColor={palette.textMuted}
              keyboardType="number-pad"
              style={styles.input}
              editable={false}
            />
              </View>

              <Pressable style={styles.primaryBtn} onPress={() => void runCompare()} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>KIYASLA</Text>}
              </Pressable>

              {resultRows ? (
                <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={[styles.label, { marginBottom: 8 }]}>{t(lang, "compare_results")}</Text>
              <View style={styles.tableHead}>
                <Text style={[styles.th, styles.wVar]}>{t(lang, "asset")}</Text>
                <Text style={[styles.th, styles.wCol]}>{t(lang, "down_payment_amount")}</Text>
                <Text style={[styles.th, styles.wCol]}>{t(lang, "loan_col")}</Text>
                <Text style={[styles.th, styles.wCol]}>{t(lang, "total")}</Text>
              </View>
              {resultRows.map((r) => (
                <View key={r.asset.key} style={styles.tr}>
                  <View style={[styles.wVar, styles.tableCellNoWrap]}>
                    <Text style={styles.td}>{r.asset.label}</Text>
                  </View>
                  <Text style={[styles.td, styles.tdNumber, styles.wCol]} numberOfLines={1} ellipsizeMode="tail">
                    {r.pesinatGetirisi == null ? "—" : formatTry(r.pesinatGetirisi)}
                  </Text>
                  <Text style={[styles.td, styles.tdNumber, styles.wCol]} numberOfLines={1} ellipsizeMode="tail">
                    {r.krediGetirisi == null ? "—" : formatTry(r.krediGetirisi)}
                  </Text>
                  <Text style={[styles.td, styles.tdNumber, styles.wCol]} numberOfLines={1} ellipsizeMode="tail">
                    {r.toplamTutar == null ? "—" : formatTry(r.toplamTutar)}
                  </Text>
                </View>
              ))}

              <View style={styles.bottomRow}>
                <Pressable style={[styles.bottomBtn, styles.bottomBtnGreen]} onPress={() => void exportExcel()}>
                  <Text style={styles.bottomTxt}>{t(lang, "excel_download")}</Text>
                </Pressable>
                <Pressable style={[styles.bottomBtn, styles.bottomBtnRed]} onPress={() => void exportPdf()}>
                  <Text style={styles.bottomTxt}>{t(lang, "pdf_download")}</Text>
                </Pressable>
              </View>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>{activeTab === "risers" ? t(lang, "kiyasla_risers") : t(lang, "kiyasla_fallers")}</Text>
                <Pressable
                  style={({ pressed }) => [styles.segmentBtn, pressed && styles.pressOrange]}
                  onPress={() => setPeriodOpen((v) => !v)}
                >
                  <Text style={styles.segmentTxt}>{periodOptions.find((p) => p.key === period)?.label ?? t(lang, "period_weekly")} {"\u25BE"}</Text>
                </Pressable>
                {periodOpen ? (
                  <View style={styles.periodDropdownList}>
                    {periodOptions.map((p, idx) => (
                      <Pressable
                        key={p.key}
                        style={({ pressed }) => [
                          styles.periodDropdownItem,
                          idx === periodOptions.length - 1 && { borderBottomWidth: 0 },
                          period === p.key && styles.segmentBtnOn,
                          pressed && styles.pressOrange,
                        ]}
                        onPress={() => {
                          setPeriod(p.key);
                          setPeriodOpen(false);
                          void runTrend(activeTab, p.key, category);
                        }}
                      >
                        <Text style={styles.segmentTxt}>{p.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <View style={styles.categoryRow}>
                  {categoryOptions.map((c) => (
                    <Pressable
                      key={c.key}
                      style={({ pressed }) => [
                        styles.segmentBtn,
                        styles.categoryBtn,
                        category === c.key && styles.segmentBtnOn,
                        pressed && styles.pressOrange,
                      ]}
                      onPress={() => {
                        setCategory(c.key);
                        void runTrend(activeTab, period, c.key);
                      }}
                    >
                      <Text style={styles.segmentTxt} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.trendHeader}>
                  <Text style={styles.trendName}>{t(lang, "product")}</Text>
                  <Text style={styles.trendCol}>{t(lang, "start")}</Text>
                  <Text style={styles.trendCol}>{t(lang, "end")}</Text>
                  <Text style={styles.trendCol}>%</Text>
                </View>
                {trendBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : trendRows.length ? (
                  trendRows.map((r) => (
                    <View key={r.key} style={styles.trendRow}>
                      {(() => {
                        const isUsdRow = r.name.includes("(USD/ons)");
                        const isTlNamed =
                          category === "emtia"
                            ? !isUsdRow
                            : r.name.includes("(TL)") || r.name.includes("gram TL");
                        const symbol: "₺" | "$" = isTlNamed
                          ? "₺"
                          : isUsdRow || category === "nasdaq" || category === "kripto"
                            ? "$"
                            : "₺";
                        return (
                          <>
                            <Text style={styles.trendName} numberOfLines={2}>
                              {r.name}
                            </Text>
                            <Text style={styles.trendCol} numberOfLines={1}>
                              {formatCurrency(r.startPrice, symbol, 2)}
                            </Text>
                            <Text style={styles.trendCol} numberOfLines={1}>
                              {formatCurrency(r.endPrice, symbol, 2)}
                            </Text>
                            <Text style={styles.trendCol} numberOfLines={1}>
                              %{r.changePct.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          </>
                        );
                      })()}
                    </View>
                  ))
                ) : trendFetchedOnce ? (
                  <Text style={styles.hint}>{t(lang, "kiyasla_trend_unavailable")}</Text>
                ) : (
                  <Text style={styles.hint}>{t(lang, "no_data_select")}</Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

