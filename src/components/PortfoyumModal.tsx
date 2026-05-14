import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useAppTheme } from "../theme/ThemeProvider";
import { createPortfoyumModalStyles } from "./portfoyumModalStyles";
import { indirilenDosyayiAc, kaydetPdfYazdirmaCiktisi } from "../lib/deviceExport";
import { loadYatirimlarMerged, saveYatirimlar, type StoredYatirim } from "../lib/yatirimStorage";
import { canonicalPortfolioFromStored } from "../lib/yatirimPortfolioCanonical";
import { fetchProductQuote, fetchUsdTry } from "../lib/livePrice";
import { t } from "../lib/i18n";

type Props = { visible: boolean; onClose: () => void; initialTab?: Tab };
type Tab = "gunluk" | "aylik" | "yillik";

const AYLAR = ["Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran", "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"];
const YILLAR = Array.from({ length: 71 }, (_, i) => String(2000 + i));
const SAVED_KEY = "portfoyum_kaydedilenler_v1";

type SavedView = {
  id: string;
  ad: string;
  tab: Tab;
  yil: string;
  ayAd: string;
  urunAra: string;
  createdAt: string;
};

type TableRow = {
  id: string;
  groupKey: string;
  sourceIds: string[];
  quoteKey: string;
  tarih: string;
  urun: string;
  miktar: number;
  isUsd: boolean;
  birimFiyat: number;
  usdTl: number;
  toplamIlkTutar: number;
  anlikBirimFiyat: number;
  toplamAnlikTutar: number;
  karZarar: number;
  yuzde: number;
};

function formatTry(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return `₺${safe.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Binlik: nokta, ondalık: virgül (örn. 7.104,30). */
function formatPfBandDecimal(n: number, minFrac: number, maxFrac: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

function parsePfBandDecimalInput(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  return Number(t.replace(/\./g, "").replace(",", "."));
}

function monthNameToNo(ad: string): string {
  const idx = AYLAR.findIndex((x) => x === ad);
  return String(Math.max(1, idx + 1)).padStart(2, "0");
}

function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function bugunIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** Aynı ürünü gruplamak (Piyasalar + / Yatırım Ekle farklı sembol; BIST / NASDAQ kısaltmaları). */
function portfolioGroupKey(r: StoredYatirim): string {
  return canonicalPortfolioFromStored(r).groupKey;
}

function displayPortfolioName(r: StoredYatirim): string {
  return canonicalPortfolioFromStored(r).displayLabel;
}

function quoteKeyForRow(r: StoredYatirim): string {
  return canonicalPortfolioFromStored(r).quoteKey;
}

// Canli veri entegrasyonu gelene kadar deterministik anlik fiyat simulasyonu.
function simulatedLivePrice(urun: string, birimFiyat: number): number {
  if (!(birimFiyat > 0)) return 0;
  let h = 0;
  for (let i = 0; i < urun.length; i += 1) h = (h * 31 + urun.charCodeAt(i)) % 997;
  const ratio = 0.92 + (h % 17) * 0.01; // 0.92 - 1.08
  return birimFiyat * ratio;
}

export function PortfoyumModal({ visible, onClose, initialTab }: Props) {
  const { palette, lang } = useAppTheme();
  const styles = useMemo(() => createPortfoyumModalStyles(palette), [palette]);

  const [tab, setTab] = useState<Tab>("gunluk");
  const [rows, setRows] = useState<StoredYatirim[]>([]);
  const [yil, setYil] = useState(String(new Date().getFullYear()));
  const [ayAd, setAyAd] = useState(AYLAR[new Date().getMonth()]);
  const [ayMenuOpen, setAyMenuOpen] = useState(false);
  const [yilMenuOpen, setYilMenuOpen] = useState(false);
  const [urunAra, setUrunAra] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<StoredYatirim | null>(null);
  const [editUrun, setEditUrun] = useState("");
  const [editMiktar, setEditMiktar] = useState("");
  const [editBirim, setEditBirim] = useState("");
  const [anlikFiyatInputById, setAnlikFiyatInputById] = useState<Record<string, string>>({});
  const [currentUsdTry, setCurrentUsdTry] = useState<number>(0);
  const [gunlukTarih, setGunlukTarih] = useState(bugunIso());
  const [filtreBaslangic, setFiltreBaslangic] = useState(`${new Date().getFullYear()}-01-01`);
  const [filtreBitis, setFiltreBitis] = useState(bugunIso());
  const [pickerTarget, setPickerTarget] = useState<"gunluk" | "bas" | "bit">("gunluk");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState<Date>(parseIsoDate(bugunIso()));
  const [expandedPf, setExpandedPf] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const loaded = await loadYatirimlarMerged();
      setRows(loaded);
      setCurrentUsdTry((await fetchUsdTry()) ?? 0);
      const init: Record<string, string> = {};
      for (const r of loaded) {
        const anlik = simulatedLivePrice(r.urun, r.birimFiyat);
        const qk = quoteKeyForRow(r);
        const usd =
          r.quoteCurrency === "USD" ||
          (r.symbol ?? "").toUpperCase().includes("-USD") ||
          r.urun.toUpperCase().includes("USD");
        init[qk] = formatPfBandDecimal(Math.round(anlik * 100) / 100, 2, usd ? 4 : 2);
      }
      setAnlikFiyatInputById(init);
      const raw = await AsyncStorage.getItem(SAVED_KEY);
      if (!raw) {
        setSavedViews([]);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SavedView[];
        setSavedViews(Array.isArray(parsed) ? parsed : []);
      } catch {
        setSavedViews([]);
      }
    })();
  }, [visible]);

  useEffect(() => {
    if (!visible || !initialTab) return;
    setTab(initialTab);
  }, [visible, initialTab]);

  useEffect(() => {
    if (!visible || tab !== "yillik") return;
    const yearlyBase = rows.filter((r) => r.tarih.startsWith(`${yil}-`));
    if (!yearlyBase.length) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        yearlyBase.map(async (r) => {
          const q = await fetchProductQuote(quoteKeyForRow(r));
          const key = quoteKeyForRow(r);
          if (!q?.price || !Number.isFinite(q.price)) return [key, ""] as const;
          const price = q.quoteCurrency === "USD" ? q.price : q.price;
          if (!Number.isFinite(price) || price <= 0) return [key, ""] as const;
          const usdRow =
            r.quoteCurrency === "USD" ||
            (r.symbol ?? "").toUpperCase().includes("-USD") ||
            r.urun.toUpperCase().includes("USD");
          const usdQuote = q.quoteCurrency === "USD" || q.usdBased;
          const maxFrac = usdRow || usdQuote ? 4 : 2;
          return [key, formatPfBandDecimal(price, 2, maxFrac)] as const;
        }),
      );
      if (cancelled) return;
      setAnlikFiyatInputById((prev) => {
        const next = { ...prev };
        for (const [id, val] of entries) {
          if (val) next[id] = val;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tab, yil, rows]);

  useEffect(() => {
    setAyMenuOpen(false);
    setYilMenuOpen(false);
  }, [tab]);

  const ayNo = useMemo(() => monthNameToNo(ayAd), [ayAd]);
  const aylikKey = `${yil}-${ayNo}`;
  const isUsdStored = (r: StoredYatirim) =>
    r.quoteCurrency === "USD" || (r.symbol ?? "").toUpperCase().includes("-USD") || r.urun.toUpperCase().includes("USD");
  const usdKurForRow = (r: StoredYatirim) => (r.usdTryAtBuy && r.usdTryAtBuy > 0 ? r.usdTryAtBuy : currentUsdTry);

  /**
   * Günlük görünüm: sadece seçili günün kayıtlarını göster.
   * O gün hiç kayıt yoksa geçmişten ürün taşınmaz.
   */
  const gunlukRows = useMemo(() => rows.filter((r) => r.tarih === gunlukTarih), [rows, gunlukTarih]);
  const aylikRows = useMemo(() => rows.filter((r) => r.tarih.startsWith(aylikKey)), [rows, aylikKey]);
  const yillikRows = useMemo(() => {
    const q = urunAra.trim().toLocaleLowerCase("tr");
    const base = rows.filter((r) => r.tarih.startsWith(`${yil}-`));
    const ranged = base.filter((r) => r.tarih >= filtreBaslangic && r.tarih <= filtreBitis);
    return q
      ? ranged.filter((r) => {
          const c = canonicalPortfolioFromStored(r);
          return (
            r.urun.toLocaleLowerCase("tr").includes(q) ||
            (r.symbol ?? "").toLocaleLowerCase("tr").includes(q) ||
            c.displayLabel.toLocaleLowerCase("tr").includes(q) ||
            c.quoteKey.toLocaleLowerCase("tr").includes(q)
          );
        })
      : ranged;
  }, [rows, yil, urunAra, filtreBaslangic, filtreBitis]);

  const toTableRows = useMemo(() => {
    const source = tab === "gunluk" ? gunlukRows : tab === "aylik" ? aylikRows : yillikRows;
    const buckets = new Map<string, StoredYatirim[]>();
    for (const r of source) {
      const k = portfolioGroupKey(r);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const rowsOut: TableRow[] = [];
    for (const [gKey, list] of buckets) {
      const sorted = [...list].sort((a, b) => a.tarih.localeCompare(b.tarih));
      const ref = sorted[sorted.length - 1]!;
      const isUsd = isUsdStored(ref);
      const usdTl = isUsd ? safeNumber(usdKurForRow(ref)) : 0;
      let totalMiktar = 0;
      let toplamIlkTutar = 0;
      let sumUsdUnitQty = 0;
      for (const r of sorted) {
        totalMiktar += r.miktar;
        if (isUsdStored(r)) {
          const kur = usdKurForRow(r);
          toplamIlkTutar += safeNumber(r.miktar * r.birimFiyat * kur);
          sumUsdUnitQty += r.miktar * r.birimFiyat;
        } else {
          toplamIlkTutar += safeNumber(r.toplamTutar);
        }
      }
      const qk = quoteKeyForRow(ref);
      const anlikInput = anlikFiyatInputById[qk] ?? "";
      const parsed = parsePfBandDecimalInput(anlikInput);
      const anlikBirimFiyat =
        Number.isFinite(parsed) && parsed > 0 ? parsed : safeNumber(simulatedLivePrice(ref.urun, ref.birimFiyat));
      const toplamAnlikTutar = isUsd
        ? safeNumber(totalMiktar * anlikBirimFiyat * usdTl)
        : safeNumber(totalMiktar * anlikBirimFiyat);
      const karZarar = safeNumber(toplamAnlikTutar - toplamIlkTutar);
      const yuzde = toplamIlkTutar > 0 ? safeNumber((karZarar / toplamIlkTutar) * 100) : 0;
      const avgBirimTry = totalMiktar > 0 ? safeNumber(toplamIlkTutar / totalMiktar) : 0;
      const avgBirimUsd = totalMiktar > 0 && isUsd ? safeNumber(sumUsdUnitQty / totalMiktar) : ref.birimFiyat;
      rowsOut.push({
        id: `grp:${gKey}`,
        groupKey: gKey,
        sourceIds: sorted.map((x) => x.id),
        quoteKey: qk,
        tarih: ref.tarih,
        urun: displayPortfolioName(ref),
        miktar: totalMiktar,
        isUsd,
        birimFiyat: isUsd ? avgBirimUsd : avgBirimTry,
        usdTl,
        toplamIlkTutar,
        anlikBirimFiyat,
        toplamAnlikTutar,
        karZarar,
        yuzde });
    }
    rowsOut.sort((a, b) => a.urun.localeCompare(b.urun, "tr", { sensitivity: "base" }));
    return rowsOut;
  }, [tab, gunlukRows, aylikRows, yillikRows, anlikFiyatInputById, currentUsdTry]);

  const aylikToplamYatirim = useMemo(() => aylikRows.reduce((a, r) => a + r.toplamTutar, 0), [aylikRows]);
  const aylikToplamFiyat = useMemo(() => aylikRows.reduce((a, r) => a + r.birimFiyat, 0), [aylikRows]);
  const yillikToplamYatirim = useMemo(() => safeNumber(toTableRows.reduce((a, r) => a + safeNumber(r.toplamIlkTutar), 0)), [toTableRows]);
  const yillikToplamFiyat = useMemo(() => safeNumber(toTableRows.reduce((a, r) => a + safeNumber(r.toplamAnlikTutar), 0)), [toTableRows]);
  const yillikToplamKarZarar = useMemo(() => safeNumber(yillikToplamFiyat - yillikToplamYatirim), [yillikToplamFiyat, yillikToplamYatirim]);
  const yillikToplamKarZararPct = useMemo(
    () => (yillikToplamYatirim > 0 ? (yillikToplamKarZarar / yillikToplamYatirim) * 100 : 0),
    [yillikToplamKarZarar, yillikToplamYatirim],
  );
  const aktifToplamTutar = useMemo(() => safeNumber(toTableRows.reduce((a, r) => a + safeNumber(r.toplamIlkTutar), 0)), [toTableRows]);
  const aktifAnlikToplam = useMemo(
    () => safeNumber(toTableRows.reduce((a, r) => a + safeNumber(r.toplamAnlikTutar), 0)),
    [toTableRows],
  );
  const aktifKarZarar = useMemo(
    () => safeNumber(toTableRows.reduce((a, r) => a + safeNumber(r.karZarar), 0)),
    [toTableRows],
  );
  const aktifKarZararPct = useMemo(
    () => (aktifToplamTutar > 0 ? safeNumber((aktifKarZarar / aktifToplamTutar) * 100) : 0),
    [aktifKarZarar, aktifToplamTutar],
  );
  const aktifRows = tab === "gunluk" ? gunlukRows : tab === "aylik" ? aylikRows : yillikRows;
  const aktifSavedViews = useMemo(() => savedViews.filter((x) => x.tab === tab), [savedViews, tab]);
  const ozetToplamTutar = tab === "yillik" ? yillikToplamYatirim : aktifToplamTutar;
  const ozetAnlikToplam = tab === "yillik" ? yillikToplamFiyat : aktifAnlikToplam;
  const ozetKarZarar = tab === "yillik" ? yillikToplamKarZarar : aktifKarZarar;
  const ozetKarZararPct = tab === "yillik" ? yillikToplamKarZararPct : aktifKarZararPct;

  const silSatir = async (id: string) => {
    const removed = rows.find((x) => x.id === id);
    const next = rows.filter((x) => x.id !== id);
    setRows(next);
    if (removed) {
      const qk = quoteKeyForRow(removed);
      const still = next.some((x) => quoteKeyForRow(x) === qk);
      if (!still) {
        setAnlikFiyatInputById((prev) => {
          const p = { ...prev };
          delete p[qk];
          return p;
        });
      }
    }
    await saveYatirimlar(next);
  };

  const silGrubu = async (ids: string[]) => {
    const next = rows.filter((x) => !ids.includes(x.id));
    setRows(next);
    const keys = new Set(rows.filter((x) => ids.includes(x.id)).map((x) => quoteKeyForRow(x)));
    setAnlikFiyatInputById((prev) => {
      const p = { ...prev };
      for (const k of keys) {
        if (!next.some((x) => quoteKeyForRow(x) === k)) delete p[k];
      }
      return p;
    });
    await saveYatirimlar(next);
  };

  const duzenleAc = (r: StoredYatirim) => {
    setEditRow(r);
    setEditUrun(r.urun);
    setEditMiktar(String(r.miktar).replace(".", ","));
    setEditBirim(String(r.birimFiyat).replace(".", ","));
    setEditOpen(true);
  };

  const duzenleKaydet = async () => {
    if (!editRow) return;
    const miktar = Number(editMiktar.replace(/\./g, "").replace(",", "."));
    const birim = Number(editBirim.replace(/\./g, "").replace(",", "."));
    if (!editUrun.trim() || !Number.isFinite(miktar) || !Number.isFinite(birim) || miktar <= 0 || birim <= 0) {
      Alert.alert(t(lang, "error"), t(lang, "check_fields"));
      return;
    }
    const next = rows.map((r) =>
      r.id === editRow.id
        ? { ...r, urun: editUrun.trim(), miktar, birimFiyat: birim, toplamTutar: miktar * birim }
        : r,
    );
    setRows(next);
    await saveYatirimlar(next);
    setAnlikFiyatInputById((prev) => ({
      ...prev,
      [quoteKeyForRow(editRow)]:
        prev[quoteKeyForRow(editRow)] ??
        formatPfBandDecimal(birim, 2, isUsdStored(editRow) ? 4 : 2),
    }));
    setEditOpen(false);
    setEditRow(null);
  };

  const kaydetGorunum = async () => {
    const baseName =
      tab === "aylik"
        ? `${ayAd} ${yil}`
        : tab === "yillik"
          ? yil
          : `Gunluk ${yil}`;
    const sameNames = savedViews.filter((x) => x.ad === baseName || x.ad.startsWith(`${baseName}/`));
    const ad = sameNames.length === 0 ? baseName : `${baseName}/${sameNames.length + 1}`;

    const v: SavedView = {
      id: `pf-${Date.now()}`,
      ad,
      tab,
      yil,
      ayAd,
      urunAra,
      createdAt: new Date().toISOString(),
    };
    const next = [v, ...savedViews];
    setSavedViews(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
    Alert.alert(t(lang, "saved_ok"), t(lang, "view_saved"));
  };

  const openDatePicker = (target: "gunluk" | "bas" | "bit") => {
    const current = target === "gunluk" ? gunlukTarih : target === "bas" ? filtreBaslangic : filtreBitis;
    const cur = parseIsoDate(current);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: cur,
        onChange: (_e, selected) => {
          if (!selected) return;
          const iso = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
          if (target === "gunluk") {
            setGunlukTarih(iso);
            setFiltreBaslangic(iso);
            setFiltreBitis(iso);
          }
          if (target === "bas") setFiltreBaslangic(iso);
          if (target === "bit") setFiltreBitis(iso);
        },
      });
      return;
    }
    setPickerTarget(target);
    setPickerValue(cur);
    setPickerOpen(true);
  };

  const onIosDate = (_event: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    const iso = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
    if (pickerTarget === "gunluk") {
      setGunlukTarih(iso);
      setFiltreBaslangic(iso);
      setFiltreBitis(iso);
    }
    if (pickerTarget === "bas") setFiltreBaslangic(iso);
    if (pickerTarget === "bit") setFiltreBitis(iso);
    setPickerValue(selected);
  };

  const kayitSil = async (id: string) => {
    const next = savedViews.filter((x) => x.id !== id);
    setSavedViews(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  const kayitDuzenle = async (id: string) => {
    const next = savedViews.map((x) =>
      x.id === id ? { ...x, tab, yil, ayAd, urunAra, createdAt: new Date().toISOString() } : x,
    );
    setSavedViews(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  const kayitAc = (v: SavedView) => {
    setTab(v.tab);
    setYil(v.yil);
    setAyAd(v.ayAd);
    setUrunAra(v.urunAra);
    setSavedOpen(false);
  };

  const pdfIndir = async () => {
    try {
      setBusyPdf(true);
      const head =
        "<tr><th>Ürün</th><th>Adet</th><th>İlk Yatırılan Toplam (TL)</th><th>Ortalama Maliyet</th><th>Anlık Birim</th><th>Toplam Varlık (TL)</th><th>Kar/Zarar (TL)</th><th>%</th></tr>";
      const body = toTableRows
        .map((r) => {
          const mal = r.isUsd
            ? `$${r.birimFiyat.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
            : formatTry(r.birimFiyat);
          return `<tr><td>${r.urun}</td><td>${r.miktar.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}</td><td>${r.toplamIlkTutar.toFixed(2)}</td><td>${mal}</td><td>${r.anlikBirimFiyat.toFixed(4)}</td><td>${r.toplamAnlikTutar.toFixed(2)}</td><td>${r.karZarar.toFixed(2)}</td><td>${r.yuzde.toFixed(2)}%</td></tr>`;
        })
        .join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><style>body{font-family:Arial;padding:16px}h2{margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}th:nth-child(2),td:nth-child(2){text-align:left}</style></head><body><h2>Portföyüm - ${tab.toUpperCase()}</h2><table>${head}${body}</table></body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const sonuc = await kaydetPdfYazdirmaCiktisi(uri);
      Alert.alert(t(lang, "pdf_download_success"), undefined, [
        { text: t(lang, "close"), style: "cancel" },
        { text: t(lang, "open_file"), onPress: () => void indirilenDosyayiAc(sonuc.acmaUri, sonuc.mimeType) },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Hata", msg);
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <View style={styles.headerPad} />
          <Text style={styles.title}>{t(lang, "portfolio")}</Text>
          <Pressable onPress={onClose} style={styles.headerPad}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.tabRow}>
          {[
            ["gunluk", t(lang, "period_daily")],
            ["aylik", t(lang, "period_monthly")],
            ["yillik", t(lang, "period_yearly")],
          ].map(([k, l]) => (
            <Pressable key={k} style={[styles.tabBtn, tab === k && styles.tabBtnOn]} onPress={() => setTab(k as Tab)}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{l}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "gunluk" ? (
          <View style={styles.filterColumn}>
            <Text style={styles.filterBlockTitle}>{t(lang, "selected_day_calendar")}</Text>
            <Text style={styles.filterHelp}>{t(lang, "single_day_fast_help")}</Text>
            <Pressable style={[styles.input, styles.singleDayPick]} onPress={() => openDatePicker("gunluk")}>
              <Text style={styles.ayText}>{formatDateLabel(gunlukTarih)}</Text>
            </Pressable>
            <Text style={[styles.filterBlockTitle, styles.filterBlockTitleSpaced]}>{t(lang, "transaction_date_range_filter")}</Text>
            <Text style={styles.filterHelp}>{t(lang, "cards_show_between_dates")}</Text>
            <View style={styles.rangeRow}>
              <View style={styles.rangeItem}>
                <Text style={styles.rangeHint}>{t(lang, "start")}</Text>
                <Pressable style={[styles.input, styles.rangeDateBtn]} onPress={() => openDatePicker("bas")}>
                  <Text style={styles.ayText}>{formatDateLabel(filtreBaslangic)}</Text>
                </Pressable>
              </View>
              <Text style={styles.rangeDash}>—</Text>
              <View style={styles.rangeItem}>
                <Text style={styles.rangeHint}>{t(lang, "end")}</Text>
                <Pressable style={[styles.input, styles.rangeDateBtn]} onPress={() => openDatePicker("bit")}>
                  <Text style={styles.ayText}>{formatDateLabel(filtreBitis)}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {tab === "aylik" ? (
          <View style={styles.filterRow}>
            <Pressable style={[styles.input, styles.yilInput]} onPress={() => setYilMenuOpen((v) => !v)}>
              <Text style={styles.ayText}>{yil}</Text>
            </Pressable>
            <Pressable style={[styles.input, styles.ayInput]} onPress={() => setAyMenuOpen((v) => !v)}>
              <Text style={styles.ayText}>{ayAd}</Text>
            </Pressable>
          </View>
        ) : null}

        {tab === "yillik" ? (
          <View style={styles.filterYearWrap}>
            <View style={styles.filterYearCol}>
              <Text style={styles.filterBlockTitle}>{t(lang, "year")}</Text>
              <Pressable style={[styles.input, styles.yilInputWide]} onPress={() => setYilMenuOpen((v) => !v)}>
                <Text style={styles.ayText}>{yil}</Text>
              </Pressable>
            </View>
            <View style={styles.filterYearRangeCol}>
              <Text style={styles.filterBlockTitle}>{t(lang, "transaction_date_range_filter")}</Text>
              <Text style={styles.filterHelp}>Seçili yıl içinde, yalnızca bu iki tarih arasındaki işlemler listelenir.</Text>
              <View style={styles.rangeRow}>
                <View style={styles.rangeItem}>
                  <Text style={styles.rangeHint}>{t(lang, "start")}</Text>
                  <Pressable style={[styles.input, styles.rangeDateBtn]} onPress={() => openDatePicker("bas")}>
                    <Text style={styles.ayText}>{formatDateLabel(filtreBaslangic)}</Text>
                  </Pressable>
                </View>
                <Text style={styles.rangeDash}>—</Text>
                <View style={styles.rangeItem}>
                  <Text style={styles.rangeHint}>{t(lang, "end")}</Text>
                  <Pressable style={[styles.input, styles.rangeDateBtn]} onPress={() => openDatePicker("bit")}>
                    <Text style={styles.ayText}>{formatDateLabel(filtreBitis)}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {tab === "yillik" ? (
          <TextInput
            style={[styles.input, { marginHorizontal: 14 }]}
            value={urunAra}
            onChangeText={setUrunAra}
            placeholder={t(lang, "search_product")}
            placeholderTextColor={palette.textMuted}
          />
        ) : null}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {toTableRows.length === 0 ? (
            <Text style={styles.pfEmpty}>{t(lang, "no_record_in_period")}</Text>
          ) : null}
          {toTableRows.map((r) => {
            const kar = r.karZarar;
            const yuzde = r.yuzde;
            const pnlColor = kar >= 0 ? "#4ade80" : "#fb7185";
            const agirlikPct = aktifAnlikToplam > 0 ? Math.min(100, (r.toplamAnlikTutar / aktifAnlikToplam) * 100) : 0;
            const maliyetStr = r.isUsd
              ? `$${r.birimFiyat.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
              : formatTry(r.birimFiyat);
            const expanded = !!expandedPf[r.groupKey];
            const altSatirlar = rows.filter((x) => r.sourceIds.includes(x.id));
            return (
              <View key={r.id} style={styles.pfCard}>
                <View style={styles.pfCardTop}>
                  <View style={styles.pfCardTitleRow}>
                    <Text style={styles.pfSymbol}>{r.urun}</Text>
                    <Text style={styles.pfTopValue}>{formatTry(r.toplamAnlikTutar)}</Text>
                  </View>
                  <Text style={styles.pfOrtMaliyet}>Ortalama maliyet: {maliyetStr}</Text>
                  <View style={styles.pfPnlRow}>
                    <Text style={[styles.pfPnlPct, { color: pnlColor }]}>
                      {yuzde >= 0 ? "▲" : "▼"} {yuzde >= 0 ? "+" : ""}
                      {yuzde.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                    </Text>
                    <Text style={[styles.pfPnlTl, { color: pnlColor }]}>
                      ({kar >= 0 ? "+" : ""}
                      {formatTry(kar)})
                    </Text>
                  </View>
                  <View style={styles.pfBarOuter}>
                    <View style={[styles.pfBarInner, { width: `${agirlikPct}%` }]} />
                  </View>
                  <Text style={styles.pfBarPct}>%{agirlikPct.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</Text>
                </View>
                <View style={styles.pfCardBand}>
                  <View style={styles.pfBandCol}>
                    <Text style={styles.pfBandLabel}>Satılabilir adet</Text>
                    <Text style={styles.pfBandVal}>{formatPfBandDecimal(r.miktar, 0, 4)}</Text>
                  </View>
                  <View style={styles.pfBandCol}>
                    <Text style={styles.pfBandLabel}>Maliyet</Text>
                    <Text style={styles.pfBandVal}>{maliyetStr}</Text>
                  </View>
                  <View style={styles.pfBandCol}>
                    <Text style={styles.pfBandLabel}>Son işlem fiyatı</Text>
                    <TextInput
                      style={styles.pfAnlikInput}
                      value={anlikFiyatInputById[r.quoteKey] ?? ""}
                      onChangeText={(v) => setAnlikFiyatInputById((prev) => ({ ...prev, [r.quoteKey]: v }))}
                      onBlur={() => {
                        setAnlikFiyatInputById((prev) => {
                          const raw = prev[r.quoteKey] ?? "";
                          const p = parsePfBandDecimalInput(raw);
                          if (!Number.isFinite(p) || p <= 0) return prev;
                          return { ...prev, [r.quoteKey]: formatPfBandDecimal(p, 2, r.isUsd ? 4 : 2) };
                        });
                      }}
                      keyboardType="decimal-pad"
                      placeholder={r.isUsd ? "0,00 $" : "0,00"}
                      placeholderTextColor="rgba(255,255,255,0.45)"
                    />
                    {r.isUsd ? (
                      <Text style={styles.pfKurHint}>
                        USD/TL {r.usdTl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.pfCardActions}>
                  <Pressable
                    style={styles.pfExpandHit}
                    onPress={() => setExpandedPf((p) => ({ ...p, [r.groupKey]: !p[r.groupKey] }))}
                    hitSlop={6}
                  >
                    <Text style={styles.pfChevron}>{expanded ? "▼" : "▶"}</Text>
                    <Text style={styles.pfDetayTxt}>{r.sourceIds.length} işlem</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        t(lang, "delete_all"),
                        `${r.urun} için ${r.sourceIds.length} kayıt silinsin mi?`,
                        [
                          { text: t(lang, "cancel"), style: "cancel" },
                          { text: "Sil", style: "destructive", onPress: () => void silGrubu(r.sourceIds) },
                        ],
                      )
                    }
                  >
                    <Text style={styles.pfSilGrup}>Tümünü sil</Text>
                  </Pressable>
                </View>
                {expanded
                  ? altSatirlar.map((line) => (
                      <View key={line.id} style={styles.pfSubRow}>
                        <View style={styles.pfSubLeft}>
                          <Text style={styles.pfSubDate}>{formatDateLabel(line.tarih)}</Text>
                          <Text style={styles.pfSubMeta}>
                            {line.miktar.toLocaleString("tr-TR")} × {isUsdStored(line) ? "$" : "₺"}
                            {line.birimFiyat.toLocaleString("tr-TR")}
                          </Text>
                        </View>
                        <View style={styles.pfSubActions}>
                          <Pressable onPress={() => duzenleAc(line)} hitSlop={6}>
                            <Text style={styles.editBtn}>✎</Text>
                          </Pressable>
                          <Pressable onPress={() => void silSatir(line.id)} hitSlop={6}>
                            <Text style={styles.delBtn}>🗑</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  : null}
              </View>
            );
          })}

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t(lang, "first_invested_total")}</Text>
              <Text style={styles.summaryValue}>{formatTry(ozetToplamTutar)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t(lang, "profit_loss")}</Text>
              <Text style={[styles.summaryValue, { color: ozetKarZarar >= 0 ? "#4ade80" : "#fb7185" }]}>
                {formatTry(ozetKarZarar)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t(lang, "total_assets")}</Text>
              <Text style={styles.summaryValue}>{formatTry(ozetAnlikToplam)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t(lang, "percentage_rate")}</Text>
              <Text style={[styles.summaryValue, { color: ozetKarZararPct >= 0 ? "#4ade80" : "#fb7185" }]}>
                {`${ozetKarZararPct >= 0 ? "+" : ""}${ozetKarZararPct.toLocaleString("tr-TR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`}
              </Text>
            </View>
          </View>

          <View style={styles.bottomActions}>
            <Pressable style={styles.bottomBtn} onPress={() => void kaydetGorunum()}>
              <Text style={styles.bottomBtnText}>{t(lang, "save")}</Text>
            </Pressable>
            <Pressable style={styles.bottomBtn} onPress={() => setSavedOpen(true)}>
              <Text style={styles.bottomBtnText}>{t(lang, "saved_items")}</Text>
            </Pressable>
            <Pressable style={[styles.bottomBtn, styles.pdfBtn]} onPress={() => void pdfIndir()} disabled={busyPdf}>
              {busyPdf ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.bottomBtnText}>{t(lang, "pdf_download")}</Text>}
            </Pressable>
          </View>
        </ScrollView>

        {/* Ay secimi sadece Aylik sekmesinde, overlay olarak acilir */}
        <Modal visible={ayMenuOpen && tab === "aylik"} transparent animationType="fade" onRequestClose={() => setAyMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setAyMenuOpen(false)}>
            <View style={styles.menuCard}>
              <ScrollView>
                {AYLAR.map((m) => (
                  <Pressable
                    key={m}
                    style={styles.menuItem}
                    onPress={() => {
                      setAyAd(m);
                      setAyMenuOpen(false);
                    }}
                  >
                    <Text style={styles.menuText}>{m}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        {/* Yil secimi Yillik sekmede 2000-2070 */}
        <Modal visible={yilMenuOpen} transparent animationType="fade" onRequestClose={() => setYilMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setYilMenuOpen(false)}>
            <View style={styles.menuCard}>
              <ScrollView>
                {YILLAR.map((y) => (
                  <Pressable
                    key={y}
                    style={styles.menuItem}
                    onPress={() => {
                      setYil(y);
                      setYilMenuOpen(false);
                    }}
                  >
                    <Text style={styles.menuText}>{y}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        <Modal visible={savedOpen} transparent animationType="fade" onRequestClose={() => setSavedOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setSavedOpen(false)}>
            <View style={styles.savedCard}>
              <Text style={styles.savedTitle}>{t(lang, "saved_items")}</Text>
              <ScrollView>
                {aktifSavedViews.map((v) => (
                  <View key={v.id} style={styles.savedRow}>
                    <Pressable style={styles.savedMain} onPress={() => kayitAc(v)}>
                      <Text style={styles.savedName}>{v.ad}</Text>
                      <Text style={styles.savedMeta}>{`${v.tab} | ${v.yil} ${v.ayAd}`}</Text>
                    </Pressable>
                    <Pressable onPress={() => void kayitDuzenle(v.id)}><Text style={styles.editBtn}>✎</Text></Pressable>
                    <Pressable onPress={() => void kayitSil(v.id)}><Text style={styles.delBtn}>🗑</Text></Pressable>
                  </View>
                ))}
                {aktifSavedViews.length === 0 ? <Text style={styles.savedMeta}>{t(lang, "no_record")}</Text> : null}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setEditOpen(false)}>
            <View style={styles.savedCard}>
              <Text style={styles.savedTitle}>{t(lang, "edit")}</Text>
              <TextInput style={styles.input} value={editUrun} onChangeText={setEditUrun} placeholder={t(lang, "product")} placeholderTextColor={palette.textMuted} />
              <TextInput style={styles.input} value={editMiktar} onChangeText={setEditMiktar} placeholder={t(lang, "quantity")} placeholderTextColor={palette.textMuted} />
              <TextInput style={styles.input} value={editBirim} onChangeText={setEditBirim} placeholder={t(lang, "unit_price")} placeholderTextColor={palette.textMuted} />
              <Pressable style={[styles.bottomBtn, { marginTop: 10 }]} onPress={() => void duzenleKaydet()}>
                <Text style={styles.bottomBtnText}>{t(lang, "edit")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
        {Platform.OS === "ios" && pickerOpen ? (
          <View style={styles.iosWrap}>
            <View style={styles.iosHead}>
              <Text style={styles.menuText}>{t(lang, "date_label")}</Text>
              <Pressable onPress={() => setPickerOpen(false)}>
                <Text style={styles.iosDone}>{t(lang, "save")}</Text>
              </Pressable>
            </View>
            <DateTimePicker value={pickerValue} mode="date" display="spinner" onChange={onIosDate} />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
