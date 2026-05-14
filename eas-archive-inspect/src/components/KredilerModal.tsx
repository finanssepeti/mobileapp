import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme, useThemeColors } from "../theme/ThemeProvider";
import { t } from "../lib/i18n";
import { createKredilerModalStyles, kredilerDeepWellPlaceholderColor } from "./kredilerModalStyles";
import { annuityPayment, buildAmortizationSchedule, monthlyRateFromPercent, type InterestMode } from "../lib/krediMath";
import { loadKrediler, saveKrediler, type StoredKredi } from "../lib/kredilerStorage";
import {
  scheduleToCsv,
  scheduleToPrintHtml,
  type KrediExportMeta,
  type AmortRow,
} from "../lib/krediExport";
import {
  KREDI_CHIP_ROW1,
  KREDI_CHIP_ROW2,
  type LoanProductKey,
  buildKrediExportLabels,
  loanChipLabel,
  loanProductLabel,
  parseStoredLoanType,
} from "../lib/krediLoanTypes";
import { TURKIYE_BANKALARI } from "../data/turkiyeBankalari";
import {
  indirilenDosyayiAc,
  kaydetCsvDosyasi,
  kaydetPdfYazdirmaCiktisi,
} from "../lib/deviceExport";
import * as Print from "expo-print";

type TabKey = "hesap" | "liste";

type Props = {
  visible: boolean;
  onClose: () => void;
};

function parseNum(s: string): number {
  const tx = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(tx);
  return Number.isFinite(n) ? n : NaN;
}

/** Sadece rakam; gösterimde tr-TR binlik nokta (örn. 250.000) */
function formatTutarInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function formatTry(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Kartta gösterilecek yıllık % — aylık girişte bileşik yıllığa çevrilir */
function toStoredAnnualFaizYuzde(ratePct: number, mode: InterestMode): number {
  if (mode === "yearly") return ratePct;
  const m = ratePct / 100;
  const eff = (Math.pow(1 + m, 12) - 1) * 100;
  return Math.round(eff * 10000) / 10000;
}

function interpolateN(template: string, n: number) {
  return template.replace(/\{\{n\}\}/g, String(n));
}

const PRINT_TIMEOUT_MS = 20000;
async function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let time: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        time = setTimeout(() => rej(new Error(msg)), ms);
      }),
    ]);
  } finally {
    if (time) clearTimeout(time);
  }
}

function KrediTuruSatirlari({
  styles,
  secili,
  onSec,
  row1,
  row2,
  labelFor,
}: {
  styles: ReturnType<typeof createKredilerModalStyles>;
  secili: LoanProductKey;
  onSec: (tur: LoanProductKey) => void;
  row1: readonly LoanProductKey[];
  row2: readonly LoanProductKey[];
  labelFor: (k: LoanProductKey) => string;
}) {
  const satir = (keys: readonly LoanProductKey[]) => (
    <View style={styles.chipRowThree}>
      {keys.map((k) => (
        <Pressable
          key={k}
          style={[styles.chip, styles.chipInGrid, styles.chipFlex, secili === k && styles.chipOn]}
          onPress={() => onSec(k)}
        >
          <Text
            style={[styles.chipText, styles.chipTextGrid, secili === k && styles.chipTextOn]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {labelFor(k)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View>
      {satir(row1)}
      <View style={styles.chipRowGap}>{satir(row2)}</View>
    </View>
  );
}

export function KredilerModal({ visible, onClose }: Props) {
  const { lang } = useAppTheme();
  const palette = useThemeColors();
  const styles = useMemo(() => createKredilerModalStyles(palette), [palette]);
  const exportLabels = useMemo(() => buildKrediExportLabels(lang), [lang]);

  const [tab, setTab] = useState<TabKey>("hesap");

  const [kturu, setKturu] = useState<LoanProductKey>("ihtiyac");
  const [tutarStr, setTutarStr] = useState(() => formatTutarInput("250000"));
  const [vadeStr, setVadeStr] = useState("36");
  const [faizStr, setFaizStr] = useState("3,49");
  const [faizModu, setFaizModu] = useState<InterestMode>("yearly");
  const [taksit, setTaksit] = useState<number | null>(null);
  const [toplamOdeme, setToplamOdeme] = useState<number | null>(null);
  const [toplamFaiz, setToplamFaiz] = useState<number | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRows, setPlanRows] = useState<ReturnType<typeof buildAmortizationSchedule>>([]);

  const [krediler, setKrediler] = useState<StoredKredi[]>([]);
  const [storageReady, setStorageReady] = useState(false);

  const [yBanka, setYBanka] = useState("");
  const [yKturu, setYKturu] = useState<LoanProductKey>("ihtiyac");
  const [yTutarStr, setYTutarStr] = useState(() => formatTutarInput("250000"));
  const [yVadeStr, setYVadeStr] = useState("36");
  const [yFaizStr, setYFaizStr] = useState("3,49");
  const [yFaizModu, setYFaizModu] = useState<InterestMode>("yearly");
  const [yTaksit, setYTaksit] = useState<number | null>(null);
  const [yToplamOdeme, setYToplamOdeme] = useState<number | null>(null);
  const [yToplamFaiz, setYToplamFaiz] = useState<number | null>(null);
  const [yPlanOpen, setYPlanOpen] = useState(false);
  const [yPlanRows, setYPlanRows] = useState<AmortRow[]>([]);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bankQuery, setBankQuery] = useState("");
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);

  const indirmeBasariliUyari = useCallback(
    (kind: "pdf" | "excel", acmaUri: string, mime: string) => {
      const title = kind === "pdf" ? t(lang, "pdf_download_success") : t(lang, "loan_excel_success_title");
      Alert.alert(title, undefined, [
        { text: t(lang, "close"), style: "cancel" },
        {
          text: t(lang, "open_file"),
          onPress: () => {
            void indirilenDosyayiAc(acmaUri, mime).catch((e) => {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert(t(lang, "loan_could_not_open"), msg);
            });
          },
        },
      ]);
    },
    [lang]
  );

  const bankalarFiltreli = useMemo(() => {
    const q = bankQuery.trim().toLocaleLowerCase("tr");
    if (!q) return TURKIYE_BANKALARI;
    return TURKIYE_BANKALARI.filter((b) => b.toLocaleLowerCase("tr").includes(q));
  }, [bankQuery]);

  const exportMeta = useMemo(() => {
    const P = parseNum(tutarStr);
    const n = Math.floor(parseNum(vadeStr));
    const ratePct = parseNum(faizStr);
    if (taksit == null || toplamOdeme == null || toplamFaiz == null || !(P > 0)) return null;
    const faizMetni =
      faizModu === "yearly"
        ? `${t(lang, "loan_export_annual_pct")} ${ratePct.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`
        : `${t(lang, "loan_export_monthly_pct")} ${ratePct.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`;
    return {
      kturu: loanProductLabel(lang, kturu),
      tutar: P,
      vadeAy: n,
      faizMetni,
      aylikTaksit: taksit,
      toplamOdeme,
      toplamFaiz,
    } satisfies KrediExportMeta;
  }, [kturu, tutarStr, vadeStr, faizStr, faizModu, taksit, toplamOdeme, toplamFaiz, lang]);

  const yExportMeta = useMemo(() => {
    const P = parseNum(yTutarStr);
    const n = Math.floor(parseNum(yVadeStr));
    const ratePct = parseNum(yFaizStr);
    if (yTaksit == null || yToplamOdeme == null || yToplamFaiz == null || !(P > 0)) return null;
    const faizMetni =
      yFaizModu === "yearly"
        ? `${t(lang, "loan_export_annual_pct")} ${ratePct.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`
        : `${t(lang, "loan_export_monthly_pct")} ${ratePct.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`;
    return {
      kturu: loanProductLabel(lang, yKturu),
      tutar: P,
      vadeAy: n,
      faizMetni,
      aylikTaksit: yTaksit,
      toplamOdeme: yToplamOdeme,
      toplamFaiz: yToplamFaiz,
    } satisfies KrediExportMeta;
  }, [yKturu, yTutarStr, yVadeStr, yFaizStr, yFaizModu, yTaksit, yToplamOdeme, yToplamFaiz, lang]);

  const runSharePdf = useCallback(
    async (meta: KrediExportMeta, rows: AmortRow[]) => {
      const html = scheduleToPrintHtml(rows, meta, exportLabels);
      const { uri } = await withTimeout(
        Print.printToFileAsync({ html, base64: false }),
        PRINT_TIMEOUT_MS,
        t(lang, "loan_pdf_timeout")
      );
      const sonuc = await withTimeout(kaydetPdfYazdirmaCiktisi(uri), PRINT_TIMEOUT_MS, t(lang, "loan_pdf_save_timeout"));
      indirmeBasariliUyari("pdf", sonuc.acmaUri, sonuc.mimeType);
    },
    [exportLabels, indirmeBasariliUyari, lang]
  );

  const runShareCsv = useCallback(
    async (meta: KrediExportMeta, rows: AmortRow[]) => {
      const csv = scheduleToCsv(rows, meta, exportLabels);
      const sonuc = await kaydetCsvDosyasi(csv);
      indirmeBasariliUyari("excel", sonuc.acmaUri, sonuc.mimeType);
    },
    [exportLabels, indirmeBasariliUyari]
  );

  const paylasPdf = useCallback(async () => {
    if (!exportMeta || planRows.length === 0) {
      Alert.alert(t(lang, "loan_error_no_table"), t(lang, "loan_error_calculate_first"));
      return;
    }
    setExportBusy("pdf");
    try {
      await runSharePdf(exportMeta, planRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t(lang, "error"), `${t(lang, "loan_error_pdf")}${msg}`);
    } finally {
      setExportBusy(null);
    }
  }, [exportMeta, planRows, runSharePdf, lang]);

  const paylasPdfListe = useCallback(async () => {
    if (!yExportMeta || yPlanRows.length === 0) {
      Alert.alert(t(lang, "loan_error_no_table"), t(lang, "loan_error_calculate_first"));
      return;
    }
    setExportBusy("pdf");
    try {
      await runSharePdf(yExportMeta, yPlanRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t(lang, "error"), `${t(lang, "loan_error_pdf")}${msg}`);
    } finally {
      setExportBusy(null);
    }
  }, [yExportMeta, yPlanRows, runSharePdf, lang]);

  const paylasExcel = useCallback(async () => {
    if (!exportMeta || planRows.length === 0) {
      Alert.alert(t(lang, "loan_error_no_table"), t(lang, "loan_error_calculate_first"));
      return;
    }
    setExportBusy("excel");
    try {
      await runShareCsv(exportMeta, planRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t(lang, "error"), `${t(lang, "loan_error_excel")}${msg}`);
    } finally {
      setExportBusy(null);
    }
  }, [exportMeta, planRows, runShareCsv, lang]);

  const paylasExcelListe = useCallback(async () => {
    if (!yExportMeta || yPlanRows.length === 0) {
      Alert.alert(t(lang, "loan_error_no_table"), t(lang, "loan_error_calculate_first"));
      return;
    }
    setExportBusy("excel");
    try {
      await runShareCsv(yExportMeta, yPlanRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t(lang, "error"), `${t(lang, "loan_error_excel")}${msg}`);
    } finally {
      setExportBusy(null);
    }
  }, [yExportMeta, yPlanRows, runShareCsv, lang]);

  const refreshListe = useCallback(async () => {
    const list = await loadKrediler();
    setKrediler(list);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      await refreshListe();
      if (!cancelled) setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, refreshListe]);

  const hesapla = useCallback(() => {
    const P = parseNum(tutarStr);
    const n = Math.floor(parseNum(vadeStr));
    const ratePct = parseNum(faizStr);
    if (!(P > 0) || !(n > 0) || !Number.isFinite(ratePct) || ratePct < 0) {
      Alert.alert(t(lang, "loan_error_incomplete"), t(lang, "loan_error_check_amount_term_rate"));
      return;
    }
    const r = monthlyRateFromPercent(ratePct, faizModu);
    const pay = annuityPayment(P, n, r);
    const total = pay * n;
    setTaksit(pay);
    setToplamOdeme(total);
    setToplamFaiz(Math.max(0, total - P));
    setPlanRows(buildAmortizationSchedule(P, n, r, pay));
    setPlanOpen(false);
  }, [tutarStr, vadeStr, faizStr, faizModu, lang]);

  const hesaplaListe = useCallback(() => {
    const P = parseNum(yTutarStr);
    const n = Math.floor(parseNum(yVadeStr));
    const ratePct = parseNum(yFaizStr);
    if (!(P > 0) || !(n > 0) || !Number.isFinite(ratePct) || ratePct < 0) {
      Alert.alert(t(lang, "loan_error_incomplete"), t(lang, "loan_error_check_amount_term_rate"));
      return;
    }
    const r = monthlyRateFromPercent(ratePct, yFaizModu);
    const pay = annuityPayment(P, n, r);
    const total = pay * n;
    setYTaksit(pay);
    setYToplamOdeme(total);
    setYToplamFaiz(Math.max(0, total - P));
    setYPlanRows(buildAmortizationSchedule(P, n, r, pay));
    setYPlanOpen(false);
  }, [yTutarStr, yVadeStr, yFaizStr, yFaizModu, lang]);

  const listeyiKaydet = useCallback(async () => {
    const P = parseNum(yTutarStr);
    const n = Math.floor(parseNum(yVadeStr));
    const ratePct = parseNum(yFaizStr);
    if (!yBanka.trim()) {
      Alert.alert(t(lang, "loan_error_bank_required"), t(lang, "loan_error_select_bank"));
      return;
    }
    if (yTaksit == null || !(P > 0) || !(n > 0) || !Number.isFinite(ratePct)) {
      Alert.alert(t(lang, "loan_error_calculate_before_save"), t(lang, "loan_error_tap_calculate_to_add"));
      return;
    }
    const fyDisplay = toStoredAnnualFaizYuzde(ratePct, yFaizModu);
    const item: StoredKredi = {
      id: `${Date.now()}`,
      banka: yBanka.trim(),
      krediTuru: yKturu,
      krediTutari: P,
      vadeAy: n,
      faizYillikYuzde: fyDisplay,
      aylikTaksit: yTaksit,
      baslangic: new Date().toISOString().slice(0, 10),
    };
    const next = [...krediler, item];
    setKrediler(next);
    await saveKrediler(next);
    setYBanka("");
    setYKturu("ihtiyac");
    setYTutarStr(formatTutarInput("250000"));
    setYVadeStr("36");
    setYFaizStr("3,49");
    setYFaizModu("yearly");
    setYTaksit(null);
    setYToplamOdeme(null);
    setYToplamFaiz(null);
    setYPlanRows([]);
    setYPlanOpen(false);
    Alert.alert(t(lang, "loan_saved_title"), t(lang, "loan_saved_body"));
  }, [yBanka, yTutarStr, yVadeStr, yFaizStr, yFaizModu, yTaksit, yKturu, krediler, lang]);

  const sil = useCallback(
    async (id: string) => {
      const next = krediler.filter((k) => k.id !== id);
      setKrediler(next);
      await saveKrediler(next);
    },
    [krediler]
  );

  const faizModLabel = useMemo(
    () => (faizModu === "yearly" ? t(lang, "loan_rate_label_yearly") : t(lang, "loan_rate_label_monthly")),
    [faizModu, lang]
  );

  const yFaizModLabel = useMemo(
    () => (yFaizModu === "yearly" ? t(lang, "loan_rate_label_yearly") : t(lang, "loan_rate_label_monthly")),
    [yFaizModu, lang]
  );

  const chipLabel = useCallback((k: LoanProductKey) => loanChipLabel(lang, k), [lang]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable style={styles.headerBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.headerBtnText}>← {t(lang, "back")}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{t(lang, "loans")}</Text>
          <Pressable style={styles.headerBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeX}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, tab === "hesap" && styles.tabBtnActive]}
            onPress={() => setTab("hesap")}
          >
            <Text style={[styles.tabBtnText, tab === "hesap" && styles.tabBtnTextActive]}>
              {t(lang, "loan_tab_calculator")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === "liste" && styles.tabBtnActive]}
            onPress={() => setTab("liste")}
          >
            <Text style={[styles.tabBtnText, tab === "liste" && styles.tabBtnTextActive]}>
              {t(lang, "loan_tab_my_loans")}
            </Text>
          </Pressable>
        </View>

        {tab === "hesap" ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionHint}>{t(lang, "loan_hint_calculator")}</Text>

            <Text style={styles.label}>{t(lang, "loan_type_label")}</Text>
            <KrediTuruSatirlari
              styles={styles}
              secili={kturu}
              onSec={setKturu}
              row1={KREDI_CHIP_ROW1}
              row2={KREDI_CHIP_ROW2}
              labelFor={chipLabel}
            />

            <Text style={styles.label}>{t(lang, "loan_amount_tl")}</Text>
            <TextInput
              style={styles.input}
              value={tutarStr}
              onChangeText={(x) => setTutarStr(formatTutarInput(x))}
              keyboardType="number-pad"
              placeholder="250.000"
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.label}>{t(lang, "loan_term_months")}</Text>
            <TextInput
              style={styles.input}
              value={vadeStr}
              onChangeText={setVadeStr}
              keyboardType="number-pad"
              placeholder="36"
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.label}>{t(lang, "loan_rate_entry_type")}</Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, faizModu === "yearly" && styles.chipOn]}
                onPress={() => setFaizModu("yearly")}
              >
                <Text style={[styles.chipText, faizModu === "yearly" && styles.chipTextOn]}>
                  {t(lang, "loan_rate_yearly_pct")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.chip, faizModu === "monthly" && styles.chipOn]}
                onPress={() => setFaizModu("monthly")}
              >
                <Text style={[styles.chipText, faizModu === "monthly" && styles.chipTextOn]}>
                  {t(lang, "loan_rate_monthly_pct")}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>{faizModLabel}</Text>
            <TextInput
              style={styles.input}
              value={faizStr}
              onChangeText={setFaizStr}
              keyboardType="decimal-pad"
              placeholder={faizModu === "yearly" ? "39,48" : "3,29"}
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.disclaimer}>{t(lang, "loan_disclaimer")}</Text>

            <Pressable style={styles.primaryBtn} onPress={hesapla}>
              <Text style={styles.primaryBtnText}>{t(lang, "loan_calculate")}</Text>
            </Pressable>

            {taksit != null && toplamOdeme != null && toplamFaiz != null ? (
              <View style={styles.resultCard}>
                <Text style={styles.resultLine}>
                  <Text style={styles.resultMuted}>{t(lang, "loan_selected_type")}</Text>
                  {loanProductLabel(lang, kturu)}
                </Text>
                <Text style={styles.resultBig}>
                  {t(lang, "loan_monthly_installment")}
                  {formatTry(taksit)}
                </Text>
                <Text style={styles.resultLine}>
                  {t(lang, "loan_total_repayment")}
                  {formatTry(toplamOdeme)}
                </Text>
                <Text style={styles.resultLine}>
                  {t(lang, "loan_total_interest")}
                  {formatTry(toplamFaiz)}
                </Text>
                {planRows.length > 0 && exportMeta ? (
                  <View style={styles.exportRow}>
                    <Pressable
                      style={[styles.exportBtn, exportBusy === "pdf" && styles.exportBtnDisabled]}
                      disabled={exportBusy !== null}
                      onPress={paylasPdf}
                    >
                      {exportBusy === "pdf" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.exportBtnText} numberOfLines={1}>
                          {t(lang, "pdf_download")}
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={[styles.exportBtn, styles.exportBtnSecondary, exportBusy === "excel" && styles.exportBtnDisabled]}
                      disabled={exportBusy !== null}
                      onPress={paylasExcel}
                    >
                      {exportBusy === "excel" ? (
                        <ActivityIndicator color={palette.accent} size="small" />
                      ) : (
                        <Text style={[styles.exportBtnText, styles.exportBtnTextSecondary]} numberOfLines={1}>
                          {t(lang, "excel_download")}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
                <Pressable style={styles.secondaryBtn} onPress={() => setPlanOpen((v) => !v)}>
                  <Text style={styles.secondaryBtnText}>
                    {planOpen ? t(lang, "loan_plan_hide") : interpolateN(t(lang, "loan_plan_show"), planRows.length)}
                  </Text>
                </Pressable>
                {planOpen && planRows.length > 0 ? (
                  <ScrollView
                    style={styles.planTableScroll}
                    contentContainerStyle={styles.planTableContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
                      <View>
                        <View style={styles.planHeaderRow}>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_month")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_installment")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_interest")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_principal")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_balance")}</Text>
                        </View>
                        {planRows.map((row) => (
                          <View key={row.month} style={styles.planRow}>
                            <Text style={styles.planCell}>{row.month}</Text>
                            <Text style={styles.planCell}>{formatTry(row.payment)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.interest)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.principal)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.balance)}</Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </ScrollView>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {!storageReady ? (
              <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} />
            ) : null}

            <Text style={styles.sectionHint}>{t(lang, "loan_hint_list_tab")}</Text>

            <Text style={styles.label}>{t(lang, "loan_bank_institution")}</Text>
            <Pressable
              style={styles.inputPressable}
              onPress={() => {
                setBankQuery("");
                setBankPickerOpen(true);
              }}
            >
              <Text style={yBanka ? styles.inputPressableText : styles.inputPressablePlaceholder} numberOfLines={2}>
                {yBanka || t(lang, "loan_bank_tap")}
              </Text>
            </Pressable>

            <Text style={styles.label}>{t(lang, "loan_type_label")}</Text>
            <KrediTuruSatirlari
              styles={styles}
              secili={yKturu}
              onSec={setYKturu}
              row1={KREDI_CHIP_ROW1}
              row2={KREDI_CHIP_ROW2}
              labelFor={chipLabel}
            />

            <Text style={styles.label}>{t(lang, "loan_amount_tl")}</Text>
            <TextInput
              style={styles.input}
              value={yTutarStr}
              onChangeText={(x) => setYTutarStr(formatTutarInput(x))}
              keyboardType="number-pad"
              placeholder="250.000"
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.label}>{t(lang, "loan_term_months")}</Text>
            <TextInput
              style={styles.input}
              value={yVadeStr}
              onChangeText={setYVadeStr}
              keyboardType="number-pad"
              placeholder="36"
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.label}>{t(lang, "loan_rate_entry_type")}</Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, yFaizModu === "yearly" && styles.chipOn]}
                onPress={() => setYFaizModu("yearly")}
              >
                <Text style={[styles.chipText, yFaizModu === "yearly" && styles.chipTextOn]}>
                  {t(lang, "loan_rate_yearly_pct")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.chip, yFaizModu === "monthly" && styles.chipOn]}
                onPress={() => setYFaizModu("monthly")}
              >
                <Text style={[styles.chipText, yFaizModu === "monthly" && styles.chipTextOn]}>
                  {t(lang, "loan_rate_monthly_pct")}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>{yFaizModLabel}</Text>
            <TextInput
              style={styles.input}
              value={yFaizStr}
              onChangeText={setYFaizStr}
              keyboardType="decimal-pad"
              placeholder={yFaizModu === "yearly" ? "39,48" : "3,29"}
              placeholderTextColor={kredilerDeepWellPlaceholderColor}
            />

            <Text style={styles.disclaimer}>{t(lang, "loan_disclaimer")}</Text>

            <Pressable style={styles.primaryBtn} onPress={hesaplaListe}>
              <Text style={styles.primaryBtnText}>{t(lang, "loan_calculate")}</Text>
            </Pressable>

            {yTaksit != null && yToplamOdeme != null && yToplamFaiz != null ? (
              <View style={styles.resultCard}>
                {yBanka ? (
                  <Text style={styles.resultLine}>
                    <Text style={styles.resultMuted}>{t(lang, "loan_bank_colon")}</Text>
                    {yBanka}
                  </Text>
                ) : null}
                <Text style={styles.resultLine}>
                  <Text style={styles.resultMuted}>{t(lang, "loan_selected_type")}</Text>
                  {loanProductLabel(lang, yKturu)}
                </Text>
                <Text style={styles.resultBig}>
                  {t(lang, "loan_monthly_installment")}
                  {formatTry(yTaksit)}
                </Text>
                <Text style={styles.resultLine}>
                  {t(lang, "loan_total_repayment")}
                  {formatTry(yToplamOdeme)}
                </Text>
                <Text style={styles.resultLine}>
                  {t(lang, "loan_total_interest")}
                  {formatTry(yToplamFaiz)}
                </Text>
                {yPlanRows.length > 0 && yExportMeta ? (
                  <View style={styles.exportRow}>
                    <Pressable
                      style={[styles.exportBtn, exportBusy === "pdf" && styles.exportBtnDisabled]}
                      disabled={exportBusy !== null}
                      onPress={paylasPdfListe}
                    >
                      {exportBusy === "pdf" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.exportBtnText} numberOfLines={1}>
                          {t(lang, "pdf_download")}
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={[styles.exportBtn, styles.exportBtnSecondary, exportBusy === "excel" && styles.exportBtnDisabled]}
                      disabled={exportBusy !== null}
                      onPress={paylasExcelListe}
                    >
                      {exportBusy === "excel" ? (
                        <ActivityIndicator color={palette.accent} size="small" />
                      ) : (
                        <Text style={[styles.exportBtnText, styles.exportBtnTextSecondary]} numberOfLines={1}>
                          {t(lang, "excel_download")}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
                <Pressable style={styles.secondaryBtn} onPress={() => setYPlanOpen((v) => !v)}>
                  <Text style={styles.secondaryBtnText}>
                    {yPlanOpen ? t(lang, "loan_plan_hide") : interpolateN(t(lang, "loan_plan_show"), yPlanRows.length)}
                  </Text>
                </Pressable>
                {yPlanOpen && yPlanRows.length > 0 ? (
                  <ScrollView
                    style={styles.planTableScroll}
                    contentContainerStyle={styles.planTableContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                  >
                    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
                      <View>
                        <View style={styles.planHeaderRow}>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_month")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_installment")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_interest")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_principal")}</Text>
                          <Text style={styles.planHCell}>{t(lang, "loan_plan_col_balance")}</Text>
                        </View>
                        {yPlanRows.map((row) => (
                          <View key={row.month} style={styles.planRow}>
                            <Text style={styles.planCell}>{row.month}</Text>
                            <Text style={styles.planCell}>{formatTry(row.payment)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.interest)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.principal)}</Text>
                            <Text style={styles.planCell}>{formatTry(row.balance)}</Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </ScrollView>
                ) : null}
                <Pressable style={styles.listeKaydetBtn} onPress={listeyiKaydet}>
                  <Text style={styles.primaryBtnText}>{t(lang, "loan_list_save")}</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.subTitle}>{interpolateN(t(lang, "loan_records_title"), krediler.length)}</Text>
            {krediler.length === 0 ? (
              <Text style={styles.emptyText}>{t(lang, "loan_empty_list")}</Text>
            ) : (
              krediler.map((k) => (
                <View key={k.id} style={styles.loanCard}>
                  <View style={styles.loanCardTop}>
                    <Text style={styles.loanBank}>{k.banka}</Text>
                    <Pressable onPress={() => sil(k.id)} hitSlop={8}>
                      <Text style={styles.loanSil}>{t(lang, "loan_remove")}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.loanMeta}>{loanProductLabel(lang, parseStoredLoanType(k.krediTuru))}</Text>
                  <Text style={styles.loanLine}>
                    {t(lang, "loan_amount_colon")}
                    {formatTry(k.krediTutari)}
                  </Text>
                  <Text style={styles.loanLine}>
                    {k.vadeAy}
                    {t(lang, "loan_months_abbr")} · %{k.faizYillikYuzde.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.loanLine}>
                    {t(lang, "loan_installment_colon")}
                    {formatTry(k.aylikTaksit)}
                  </Text>
                  <Text style={styles.loanDate}>
                    {t(lang, "loan_recorded")}
                    {k.baslangic}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        )}

        <Modal
          visible={bankPickerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setBankPickerOpen(false)}
        >
          <View style={styles.bankModalBackdrop}>
            <Pressable style={styles.bankModalDismiss} onPress={() => setBankPickerOpen(false)} />
            <View style={styles.bankModalCard}>
              <View style={styles.bankModalHeader}>
                <Text style={styles.bankModalTitle}>{t(lang, "loan_bank_modal_title")}</Text>
                <Pressable hitSlop={12} onPress={() => setBankPickerOpen(false)}>
                  <Text style={styles.bankModalClose}>✕</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.bankSearch}
                value={bankQuery}
                onChangeText={setBankQuery}
                placeholder={t(lang, "bank_search")}
                placeholderTextColor={kredilerDeepWellPlaceholderColor}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ScrollView
                style={styles.bankList}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {bankalarFiltreli.map((b) => (
                  <Pressable
                    key={b}
                    style={styles.bankRow}
                    onPress={() => {
                      setYBanka(b);
                      setBankPickerOpen(false);
                      setBankQuery("");
                    }}
                  >
                    <Text style={styles.bankRowText}>{b}</Text>
                  </Pressable>
                ))}
                {bankalarFiltreli.length === 0 ? (
                  <Text style={styles.bankEmpty}>{t(lang, "loan_no_results")}</Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}
