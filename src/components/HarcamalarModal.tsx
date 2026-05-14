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
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppTheme } from "../theme/ThemeProvider";
import { createHarcamalarModalStyles, harcamalarDeepWellInputPlaceholderColor } from "./harcamalarModalStyles";
import { BRAND_LOGO_DATA_URI } from "../theme/brandLogo";
import type { HarcamaOpenAnchor } from "../lib/harcamaAnchors";
import { loadCuzdanSiteStateMerged, saveCuzdanSiteState } from "../lib/cuzdanSiteStorage";
import { donemBasiNakit, ebitdaTablosu, gelirToplamAy, giderAltAyToplam, nakitTablosu } from "../lib/cuzdanSiteMath";
import type { CuzdanSiteState, GelirKalem, GiderAlt } from "../lib/cuzdanSiteTypes";
import { GELIR_KALEMLERI, GIDER_ALTLARI, varsayilanCuzdanState } from "../lib/cuzdanSiteTypes";
import { indirilenDosyayiAc, kaydetPdfYazdirmaCiktisi } from "../lib/deviceExport";
import { loadKrediler, type StoredKredi } from "../lib/kredilerStorage";
import { loadYatirimlarMerged, type StoredYatirim } from "../lib/yatirimStorage";
import { TURKIYE_BANKALARI } from "../data/turkiyeBankalari";
import * as Print from "expo-print";
import { t, monthShortLabel, type AppLang } from "../lib/i18n";

type AnaTab = "gelirlerim" | "giderlerim" | "ebitda" | "nakit_akis";

type Props = {
  visible: boolean;
  onClose: () => void;
  initialAnchor?: HarcamaOpenAnchor;
};

type GiderDetayDef = { key: string; label: string; alt: GiderAlt };
type ChartSlice = { key: string; label: string; value: number; color: string };
type SavedReport = {
  id: string;
  createdAt: string;
  type: "ebitda" | "nakit_akis";
  seciliAy: string;
  seciliYil: string;
  filtreBaslangic: string;
  filtreBitis: string;
  donemBasiInput: string;
};
const GELIR_PASTA_RENKLER = ["#1e3a8a", "#facc15", "#fb7185", "#22c55e", "#38bdf8"];
const GIDER_ALT_RENK: Record<GiderAlt, string> = {
  fatura: "#60a5fa",
  genel: "#34d399",
  kredi: "#f59e0b",
  kredi_karti: "#f472b6",
};
const SAVED_REPORTS_KEY = "cuzdanim_saved_reports_v1";

const GIDER_DETAYLARI: Record<GiderAlt, GiderDetayDef[]> = {
  fatura: [
    { key: "elektrik", label: "⚡ Elektrik", alt: "fatura" },
    { key: "su", label: "💧 Su", alt: "fatura" },
    { key: "dogalgaz", label: "🔥 Doğalgaz", alt: "fatura" },
    { key: "cep_telefonu", label: "📲 Cep telefonu", alt: "fatura" },
    { key: "tv_platform", label: "📺 TV platform", alt: "fatura" },
    { key: "internet", label: "🌐 İnternet", alt: "fatura" },
    { key: "ev_telefonu", label: "☎️ Ev telefonu", alt: "fatura" },
    { key: "aidat", label: "🧾 Aidat", alt: "fatura" },
    { key: "diger_fatura", label: "📌 Diğer fatura", alt: "fatura" },
  ],
  genel: [
    { key: "okul", label: "🎓 Okul giderleri", alt: "genel" },
    { key: "kira", label: "🏠 Kira giderleri", alt: "genel" },
    { key: "servis", label: "🚌 Servis giderleri", alt: "genel" },
    { key: "yeme_icme", label: "🍽️ Yeme-içme", alt: "genel" },
    { key: "alisveris", label: "🛒 Alışveriş", alt: "genel" },
    { key: "kisisel", label: "🧴 Kişisel giderler", alt: "genel" },
    { key: "kiyafet", label: "👕 Kıyafet giderleri", alt: "genel" },
    { key: "arac_bakim", label: "🔧 Araç-bakım giderleri", alt: "genel" },
    { key: "diger_genel", label: "📌 Diğer giderler", alt: "genel" },
  ],
  kredi: [
    { key: "ihtiyac_kredi", label: "💳 İhtiyaç kredisi", alt: "kredi" },
    { key: "tasit_kredi", label: "🚗 Taşıt kredisi", alt: "kredi" },
    { key: "konut_kredi", label: "🏡 Konut kredisi", alt: "kredi" },
    { key: "nakit_avans_kredi", label: "💠 Taksitli nakit avans kredisi", alt: "kredi" },
    { key: "kobi_kredi", label: "🏬 Kobi kredisi", alt: "kredi" },
    { key: "ticari_kredi", label: "🏢 Ticari kredi", alt: "kredi" },
  ],
  kredi_karti: [
    { key: "kk_1", label: "💳 Kredi kartı 1", alt: "kredi_karti" },
    { key: "kk_2", label: "💳 Kredi kartı 2", alt: "kredi_karti" },
    { key: "kk_3", label: "💳 Kredi kartı 3", alt: "kredi_karti" },
    { key: "kk_4", label: "💳 Kredi kartı 4", alt: "kredi_karti" },
    { key: "kk_5", label: "💳 Kredi kartı 5", alt: "kredi_karti" },
    { key: "kk_6", label: "💳 Kredi kartı 6", alt: "kredi_karti" },
  ],
};

const LEGACY_GIDER_LABEL_TO_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const alt of ["fatura", "genel", "kredi", "kredi_karti"] as GiderAlt[]) {
    for (const d of GIDER_DETAYLARI[alt]) {
      m[d.label] = d.key;
    }
  }
  return m;
})();

function displayGiderAciklama(lang: AppLang, alt: GiderAlt, aciklama: string | undefined): string {
  if (!aciklama) return t(lang, "tab_expense");
  if (alt === "kredi_karti") return aciklama;
  const key = LEGACY_GIDER_LABEL_TO_KEY[aciklama] ?? aciklama;
  const tr = t(lang, `giderdet_${key}`);
  return tr !== `giderdet_${key}` ? tr : aciklama;
}

function displayExpenseLineLabel(lang: AppLang, aciklama: string): string {
  const key = LEGACY_GIDER_LABEL_TO_KEY[aciklama] ?? aciklama;
  const tr = t(lang, `giderdet_${key}`);
  return tr !== `giderdet_${key}` ? tr : aciklama;
}

function createBlankByKeys(keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = "";
  return out;
}

function createBoolByKeys(keys: readonly string[], initial = true): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = initial;
  return out;
}

function suAnkiAy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ayKaydir(ayKey: string, delta: number): string {
  const [y, m] = ayKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function bugununTarihi(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseNum(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function formatTutarInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function formatTutarInputSigned(text: string): string {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return negative ? "-" : "";
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return negative ? "-" : "";
  const base = n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  return negative ? `-${base}` : base;
}

function formatTry(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDateInput(input: string): string {
  const t = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function dateToDisplay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${day}.${m}.${y}`;
}

function parseDisplayDate(input: string): Date | null {
  const iso = normalizeDateInput(input);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function anchorToTab(a: HarcamaOpenAnchor | undefined): AnaTab {
  if (a === "giderlerim" || a === "ebitda" || a === "nakit_akis") return a;
  return "gelirlerim";
}

function ayEtiketKisa(ayKey: string, lang: AppLang): string {
  const [y, m] = ayKey.split("-");
  const ayNo = Number(m);
  const ad = monthShortLabel(lang, Math.max(1, Math.min(12, ayNo)));
  return `${ad}.${String(y).slice(-2)}`;
}

function yilAySerisi(yil: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${yil}-${String(i + 1).padStart(2, "0")}`);
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function createArcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const startP = polarToCartesian(cx, cy, r, start);
  const endP = polarToCartesian(cx, cy, r, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startP.x} ${startP.y} A ${r} ${r} 0 ${largeArc} 1 ${endP.x} ${endP.y} Z`;
}

function darkenHex(hex: string, amount: number): string {
  const n = hex.replace("#", "");
  if (n.length !== 6) return hex;
  const r = Math.max(0, Math.min(255, parseInt(n.slice(0, 2), 16) - amount));
  const g = Math.max(0, Math.min(255, parseInt(n.slice(2, 4), 16) - amount));
  const b = Math.max(0, Math.min(255, parseInt(n.slice(4, 6), 16) - amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function Pie3D({ slices, size = 170 }: { slices: ChartSlice[]; size?: number }) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const depth = 9;
  let acc = -Math.PI / 2;
  const segments: { key: string; label: string; color: string; start: number; end: number; pct: number }[] = [];
  if (total > 0) {
    for (const s of slices) {
      const value = Math.max(0, s.value);
      const sweep = (value / total) * Math.PI * 2;
      const start = acc;
      const end = acc + sweep;
      const pct = Math.round((value / total) * 100);
      segments.push({ key: s.key, label: s.label, color: s.color, start, end, pct });
      acc = end;
    }
    acc = -Math.PI / 2;
  }
  if (total <= 0) {
    return (
      <Svg width={size} height={size + depth}>
        <Circle cx={cx} cy={cy + depth} r={r} fill="#0a1040" />
        <Circle cx={cx} cy={cy} r={r} fill="#16215e" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size + depth}>
      {slices.map((s) => {
        const value = Math.max(0, s.value);
        const sweep = (value / total) * Math.PI * 2;
        const start = acc;
        const end = acc + sweep;
        acc = end;
        const d = createArcPath(cx, cy + depth, r, start, end);
        return <Path key={`${s.key}-shadow`} d={d} fill={darkenHex(s.color, 50)} />;
      })}
      {segments.map((s) => {
        const d = createArcPath(cx, cy, r, s.start, s.end);
        return <Path key={s.key} d={d} fill={s.color} />;
      })}
      {segments
        .filter((s) => s.pct > 0)
        .map((s) => {
          const mid = (s.start + s.end) / 2;
          const rx = cx + (r * 0.58) * Math.cos(mid);
          const ry = cy + (r * 0.58) * Math.sin(mid);
          const fontSize = s.pct < 8 ? 6 : s.pct < 15 ? 7 : 8;
          const shortLabel = s.label.length > 12 ? `${s.label.slice(0, 10)}…` : s.label;
          return (
            <React.Fragment key={`${s.key}-label`}>
              <SvgText
                x={rx}
                y={ry - 2}
                fill="#ffffff"
                fontSize={fontSize}
                fontWeight="700"
                textAnchor="middle"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.6}
              >
                {shortLabel}
              </SvgText>
              <SvgText
                x={rx}
                y={ry + fontSize + 1}
                fill="#ffffff"
                fontSize={fontSize}
                fontWeight="800"
                textAnchor="middle"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.6}
              >
                %{s.pct}
              </SvgText>
            </React.Fragment>
          );
        })}
    </Svg>
  );
}

export function HarcamalarModal({ visible, onClose, initialAnchor }: Props) {
  const { palette, lang } = useAppTheme();
  const styles = useMemo(() => createHarcamalarModalStyles(palette), [palette]);

  const [anaTab, setAnaTab] = useState<AnaTab>("gelirlerim");
  const [giderAlt, setGiderAlt] = useState<GiderAlt>("fatura");
  const [seciliAy, setSeciliAy] = useState(suAnkiAy);
  const [state, setState] = useState<CuzdanSiteState>(() => varsayilanCuzdanState());
  const [hazir, setHazir] = useState(false);

  const [gelirTarih, setGelirTarih] = useState(() => bugununTarihi());
  const [gelirKutular, setGelirKutular] = useState<Record<string, string>>(
    createBlankByKeys(GELIR_KALEMLERI.map((k) => k.key)),
  );

  const [giderTarih, setGiderTarih] = useState(() => bugununTarihi());
  const [giderKutular, setGiderKutular] = useState<Record<string, string>>(
    createBlankByKeys(GIDER_DETAYLARI.fatura.map((x) => x.key)),
  );
  const [giderKalemAktif, setGiderKalemAktif] = useState<Record<string, boolean>>(
    createBoolByKeys(GIDER_DETAYLARI.fatura.map((x) => x.key)),
  );
  const [krediKartBankalari, setKrediKartBankalari] = useState<Record<string, string>>(
    createBlankByKeys(GIDER_DETAYLARI.kredi_karti.map((x) => x.key)),
  );
  const [bankaPickerOpen, setBankaPickerOpen] = useState(false);
  const [aktifKartKey, setAktifKartKey] = useState("");
  const [bankaArama, setBankaArama] = useState("");
  const [filtreBaslangic, setFiltreBaslangic] = useState("");
  const [filtreBitis, setFiltreBitis] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<"baslangic" | "bitis">("baslangic");
  const [datePickerValue, setDatePickerValue] = useState(new Date());
  const [nakitDonemBasiByYil, setNakitDonemBasiByYil] = useState<Record<string, string>>({});
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [savedModalType, setSavedModalType] = useState<"ebitda" | "nakit_akis">("ebitda");
  const [kredilerCache, setKredilerCache] = useState<StoredKredi[]>([]);
  const [yatirimlarCache, setYatirimlarCache] = useState<StoredYatirim[]>([]);

  useEffect(() => {
    setGiderKutular(createBlankByKeys(GIDER_DETAYLARI[giderAlt].map((x) => x.key)));
    setGiderKalemAktif(createBoolByKeys(GIDER_DETAYLARI[giderAlt].map((x) => x.key)));
  }, [giderAlt]);

  useEffect(() => {
    const slots = GIDER_DETAYLARI.kredi_karti.map((x) => x.key);
    setKrediKartBankalari((prev) => {
      const next = { ...prev };
      for (let i = 0; i < slots.length; i += 1) {
        const key = slots[i];
        if (!next[key]) next[key] = TURKIYE_BANKALARI[i] ?? TURKIYE_BANKALARI[0] ?? "";
      }
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const [s, ks, ys] = await Promise.all([loadCuzdanSiteStateMerged(), loadKrediler(), loadYatirimlarMerged()]);
    setState(s);
    setKredilerCache(ks);
    setYatirimlarCache(ys);
    setHazir(true);
  }, []);

  const persist = useCallback(async (next: CuzdanSiteState) => {
    setState(next);
    await saveCuzdanSiteState(next);
  }, []);

  useEffect(() => {
    if (!visible) return;
    void reload();
  }, [visible, reload]);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_REPORTS_KEY);
        if (!raw) {
          setSavedReports([]);
          return;
        }
        const parsed = JSON.parse(raw) as SavedReport[];
        setSavedReports(Array.isArray(parsed) ? parsed : []);
      } catch {
        setSavedReports([]);
      }
    })();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setAnaTab(anchorToTab(initialAnchor));
  }, [visible, initialAnchor]);

  const ayIcindeGelirler = useMemo(
    () => state.gelirler.filter((r) => r.tarih.startsWith(seciliAy)),
    [state.gelirler, seciliAy],
  );
  const ayIcindeGiderler = useMemo(
    () => state.giderler.filter((r) => r.tarih.startsWith(seciliAy) && r.alt === giderAlt),
    [state.giderler, seciliAy, giderAlt],
  );

  const ebitdaRows = useMemo(() => ebitdaTablosu(state, seciliAy), [state, seciliAy]);
  const donemBasi = useMemo(() => donemBasiNakit(state, seciliAy), [state, seciliAy]);
  const nakitRows = useMemo(() => nakitTablosu(state, seciliAy, donemBasi), [state, seciliAy, donemBasi]);
  const seciliYil = useMemo(() => seciliAy.slice(0, 4), [seciliAy]);
  const yilAyListesi = useMemo(() => yilAySerisi(seciliYil), [seciliYil]);
  const donemBasiManuel = useMemo(() => {
    const v = parseNum(nakitDonemBasiByYil[seciliYil] ?? "");
    return Number.isFinite(v) ? v : 0;
  }, [nakitDonemBasiByYil, seciliYil]);
  const ebitdaAylikProjeksiyon = useMemo(
    () =>
      yilAyListesi.map((ay) => {
        const gelir = gelirToplamAy(state, ay);
        const toplamFatura = giderAltAyToplam(state, ay, "fatura");
        const toplamGenel = giderAltAyToplam(state, ay, "genel");
        const toplamKrediKartlari = giderAltAyToplam(state, ay, "kredi_karti");
        const toplamKrediler = giderAltAyToplam(state, ay, "kredi");
        const toplamGider = toplamFatura + toplamGenel;
        const ebitda = gelir - toplamGider;
        return { ay, gelir, toplamFatura, toplamGenel, toplamKrediKartlari, toplamKrediler, toplamGider, ebitda };
      }),
    [state, yilAyListesi],
  );
  const seciliAyEbitda = useMemo(
    () => ebitdaAylikProjeksiyon.find((r) => r.ay === seciliAy) ?? ebitdaAylikProjeksiyon[0],
    [ebitdaAylikProjeksiyon, seciliAy],
  );
  const nakitAylikTablo = useMemo(() => {
    const kullanilanKrediByAy = new Map<string, number>();
    for (const k of kredilerCache) {
      const iso = normalizeDateInput(k.baslangic ?? "");
      if (!iso) continue;
      const ayKey = iso.slice(0, 7);
      kullanilanKrediByAy.set(ayKey, (kullanilanKrediByAy.get(ayKey) ?? 0) + Math.max(0, k.krediTutari));
    }
    const yatirimByAy = new Map<string, number>();
    for (const y of yatirimlarCache) {
      const iso = normalizeDateInput(y.tarih ?? "");
      if (!iso) continue;
      const ayKey = iso.slice(0, 7);
      yatirimByAy.set(ayKey, (yatirimByAy.get(ayKey) ?? 0) + Math.max(0, y.toplamTutar));
    }

    let kumulatifOnceki = donemBasiManuel;
    return yilAyListesi.map((ay) => {
      const donemBasiNakitAy = kumulatifOnceki;
      const kullandigimKrediler = kullanilanKrediByAy.get(ay) ?? 0;
      const ebitda = ebitdaTablosu(state, ay).find((x) => x.kod === "EB")?.tutar ?? 0;
      const toplamNakitGirisi = kullandigimKrediler + ebitda;
      const toplamKrediKarti = giderAltAyToplam(state, ay, "kredi_karti");
      const toplamKrediler = giderAltAyToplam(state, ay, "kredi");
      const yatirimlar = yatirimByAy.get(ay) ?? 0;
      const toplamNakitCikisi = toplamKrediKarti + toplamKrediler + yatirimlar;
      const donemselNakitFarki = toplamNakitGirisi - toplamNakitCikisi;
      const kumulatifNakitFarki = donemBasiNakitAy + donemselNakitFarki;
      kumulatifOnceki = kumulatifNakitFarki;
      return {
        ay,
        donemBasiNakitAy,
        kullandigimKrediler,
        ebitda,
        toplamNakitGirisi,
        toplamKrediKarti,
        toplamKrediler,
        yatirimlar,
        toplamNakitCikisi,
        donemselNakitFarki,
        kumulatifNakitFarki,
      };
    });
  }, [state, yilAyListesi, donemBasiManuel, kredilerCache, yatirimlarCache]);
  const filtreBasIso = useMemo(() => normalizeDateInput(filtreBaslangic), [filtreBaslangic]);
  const filtreBitIso = useMemo(() => normalizeDateInput(filtreBitis), [filtreBitis]);
  const hasValidFilter = Boolean(filtreBasIso && filtreBitIso && filtreBasIso <= filtreBitIso);
  const filterByDateRange = useCallback(
    <T extends { tarih: string }>(rows: T[]) =>
      rows.filter((r) => {
        if (!hasValidFilter) return true;
        return r.tarih >= filtreBasIso && r.tarih <= filtreBitIso;
      }),
    [filtreBasIso, filtreBitIso, hasValidFilter],
  );
  const filtreGelirRows = useMemo(() => filterByDateRange(state.gelirler), [state.gelirler, filterByDateRange]);
  const filtreGiderRows = useMemo(() => filterByDateRange(state.giderler), [state.giderler, filterByDateRange]);
  const filtreGelirToplam = useMemo(() => filtreGelirRows.reduce((a, r) => a + r.tutar, 0), [filtreGelirRows]);
  const filtreGiderToplam = useMemo(() => filtreGiderRows.reduce((a, r) => a + r.tutar, 0), [filtreGiderRows]);
  const filtreGiderKalemToplam = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtreGiderRows) m.set(r.aciklama ?? "Gider", (m.get(r.aciklama ?? "Gider") ?? 0) + r.tutar);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtreGiderRows]);
  const filtreEbitdaRows = useMemo(() => {
    const gelir = filtreGelirRows.filter((r) => state.gelirKalemAktif[r.kalem]).reduce((a, r) => a + r.tutar, 0);
    const fatura = filtreGiderRows.filter((r) => r.alt === "fatura").reduce((a, r) => a + r.tutar, 0);
    const genel = filtreGiderRows.filter((r) => r.alt === "genel").reduce((a, r) => a + r.tutar, 0);
    const kredi = filtreGiderRows.filter((r) => r.alt === "kredi").reduce((a, r) => a + r.tutar, 0);
    const kk = filtreGiderRows.filter((r) => r.alt === "kredi_karti").reduce((a, r) => a + r.tutar, 0);
    const ebitda = gelir - fatura - genel;
    return [
      { kod: "G1", aciklama: "Toplam gelir (filtre)", tutar: gelir },
      { kod: "G2", aciklama: "(-) Faturalarım", tutar: -fatura },
      { kod: "G3", aciklama: "(-) Genel giderler", tutar: -genel },
      { kod: "EB", aciklama: "EBITDA", tutar: ebitda },
      { kod: "F1", aciklama: "(-) Krediler", tutar: -kredi },
      { kod: "F2", aciklama: "(-) Kredi kartları", tutar: -kk },
      { kod: "NS", aciklama: "Nakit etkisi", tutar: ebitda - kredi - kk },
    ];
  }, [filtreGelirRows, filtreGiderRows, state.gelirKalemAktif]);
  const gelirPastaSlices = useMemo<ChartSlice[]>(
    () =>
      GELIR_KALEMLERI.map(({ key }, i) => {
        const label = t(lang, `gelir_kalem_${key}`);
        const value = state.gelirKalemAktif[key]
          ? state.gelirler.filter((r) => r.tarih.startsWith(seciliAy) && r.kalem === key).reduce((a, r) => a + r.tutar, 0)
          : 0;
        return { key, label, value, color: GELIR_PASTA_RENKLER[i % GELIR_PASTA_RENKLER.length] };
      }),
    [state.gelirKalemAktif, state.gelirler, seciliAy, lang],
  );
  const gelirPastaToplam = useMemo(() => gelirPastaSlices.reduce((a, s) => a + s.value, 0), [gelirPastaSlices]);
  const giderPastaByAlt = useMemo(() => {
    const out: Record<GiderAlt, ChartSlice[]> = { fatura: [], genel: [], kredi: [], kredi_karti: [] };
    const ayRows = state.giderler.filter((r) => r.tarih.startsWith(seciliAy));
    (["fatura", "genel", "kredi", "kredi_karti"] as GiderAlt[]).forEach((alt) => {
      const m = new Map<string, number>();
      const unk = t(lang, "tab_expense");
      ayRows
        .filter((r) => r.alt === alt)
        .forEach((r) => {
          const raw = r.aciklama ?? unk;
          const groupKey = raw;
          m.set(groupKey, (m.get(groupKey) ?? 0) + r.tutar);
        });
      out[alt] = [...m.entries()].map(([label, value], i) => ({
        key: `${alt}-${i}`,
        label: displayGiderAciklama(lang, alt, label),
        value,
        color: i === 0 ? GIDER_ALT_RENK[alt] : darkenHex(GIDER_ALT_RENK[alt], Math.min(110, i * 18)),
      }));
    });
    return out;
  }, [state.giderler, seciliAy, lang]);
  const giderAltToplamlari = useMemo(
    () =>
      (["fatura", "genel", "kredi_karti", "kredi"] as GiderAlt[]).map((alt) => ({
        alt,
        label: t(lang, `gider_cat_${alt}`),
        value: giderAltAyToplam(state, seciliAy, alt),
      })),
    [state, seciliAy, lang],
  );
  const giderGenelToplam = useMemo(() => giderAltToplamlari.reduce((a, x) => a + x.value, 0), [giderAltToplamlari]);
  const giderBarMax = useMemo(() => Math.max(1, giderGenelToplam), [giderGenelToplam]);
  const giderYTicks = useMemo(() => [1, 0.75, 0.5, 0.25, 0], []);

  const toggleKalem = (k: GelirKalem) => {
    const next = {
      ...state,
      gelirKalemAktif: { ...state.gelirKalemAktif, [k]: !state.gelirKalemAktif[k] },
    };
    void persist(next);
  };

  const gelirTopluKaydet = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gelirTarih.trim())) {
      Alert.alert("Eksik", "Tarih YYYY-AA-GG olmalı.");
      return;
    }
    const ts = Date.now();
    const yeniKayitlar: CuzdanSiteState["gelirler"] = [];
    for (const { key } of GELIR_KALEMLERI) {
      if (!state.gelirKalemAktif[key]) continue;
      const raw = gelirKutular[key] ?? "";
      const tutar = parseNum(raw);
      if (!Number.isFinite(tutar) || tutar <= 0) continue;
      yeniKayitlar.push({
        id: `g-toplu-${key}-${ts}`,
        tarih: gelirTarih.trim(),
        kalem: key,
        tutar,
      });
    }
    if (!yeniKayitlar.length) {
      Alert.alert("Bilgi", "Kaydedilecek en az bir gelir tutarı girin.");
      return;
    }
    const kayitAy = gelirTarih.trim().slice(0, 7);
    void persist({ ...state, gelirler: [...yeniKayitlar, ...state.gelirler] });
    setSeciliAy(kayitAy);
    setGelirKutular(createBlankByKeys(GELIR_KALEMLERI.map((k) => k.key)));
    Alert.alert("Kaydedildi", `${yeniKayitlar.length} gelir kalemi tek seferde kaydedildi.`);
  };

  const giderTopluKaydet = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giderTarih.trim())) {
      Alert.alert("Eksik", "Tarih YYYY-AA-GG olmalı.");
      return;
    }
    const detaylar = GIDER_DETAYLARI[giderAlt];
    const ts = Date.now();
    const yeniKayitlar: CuzdanSiteState["giderler"] = [];
    for (const d of detaylar) {
      const raw = giderKutular[d.key] ?? "";
      if (!giderKalemAktif[d.key]) continue;
      const tutar = parseNum(raw);
      if (!Number.isFinite(tutar) || tutar <= 0) continue;
      const aciklama =
        d.alt === "kredi_karti" ? krediKartBankalari[d.key] || t(lang, `giderdet_${d.key}`) : d.key;
      yeniKayitlar.push({
        id: `d-toplu-${giderAlt}-${d.key}-${ts}`,
        tarih: giderTarih.trim(),
        alt: giderAlt,
        tutar,
        aciklama,
      });
    }
    if (!yeniKayitlar.length) {
      Alert.alert("Bilgi", "Kaydedilecek en az bir gider tutarı girin.");
      return;
    }
    const kayitAy = giderTarih.trim().slice(0, 7);
    void persist({ ...state, giderler: [...yeniKayitlar, ...state.giderler] });
    setSeciliAy(kayitAy);
    setGiderKutular(createBlankByKeys(detaylar.map((x) => x.key)));
    setGiderKalemAktif(createBoolByKeys(detaylar.map((x) => x.key)));
    Alert.alert("Kaydedildi", `${yeniKayitlar.length} gider kalemi tek seferde kaydedildi.`);
  };

  const silGelir = (id: string) => {
    void persist({ ...state, gelirler: state.gelirler.filter((r) => r.id !== id) });
  };
  const silGider = (id: string) => {
    void persist({ ...state, giderler: state.giderler.filter((r) => r.id !== id) });
  };

  const kredilerdenAktar = () => {
    void (async () => {
      const ks = await loadKrediler();
      if (!ks.length) {
        Alert.alert("Kredi yok", "Önce Krediler bölümünden kredi kaydedin.");
        return;
      }
      const tarih = `${seciliAy}-15`;
      const ts = Date.now();
      const ek: CuzdanSiteState["giderler"] = ks.map((k, i) => ({
        id: `auto-kredi-${k.id}-${seciliAy}-${ts}-${i}`,
        tarih,
        alt: "kredi" as const,
        tutar: Math.max(0, k.aylikTaksit),
        aciklama: `${k.banka} · ${k.krediTuru} · taksit`,
      }));
      Alert.alert("Onay", `${ek.length} kredi taksiti bu ay (${seciliAy}) için gider olarak eklensin mi?`, [
        { text: "İptal", style: "cancel" },
        {
          text: "Ekle",
          onPress: () => void persist({ ...state, giderler: [...ek, ...state.giderler] }),
        },
      ]);
    })();
  };

  const buildFullReportHtml = (): string => {
    const now = new Date();
    const createdAt = now.toLocaleString("tr-TR");
    const raporId = `RPR-${seciliAy}-${now.getTime().toString().slice(-6)}`;
    /** PDF’te uzak logo URL’si (ağ/SSL) Android WebView’de yazdırma hatasına yol açabiliyor. */
    const pdfLogoAttr = BRAND_LOGO_DATA_URI;
    const gelirToplam = gelirPastaSlices.reduce((a, s) => a + s.value, 0);
    const gelirLegend = gelirPastaSlices
      .map((s) => {
        const pct = gelirToplam > 0 ? Math.round((s.value / gelirToplam) * 100) : 0;
        return `<div class="legend-item"><span class="dot" style="background:${s.color}"></span>${escapeHtml(s.label)} <b>%${pct}</b><span class="num">${escapeHtml(
          formatTry(s.value),
        )}</span></div>`;
      })
      .join("");
    const giderKartlar = (["fatura", "genel", "kredi", "kredi_karti"] as GiderAlt[])
      .map((alt) => {
        const slices = giderPastaByAlt[alt];
        const sliceTotal = slices.reduce((a, s) => a + s.value, 0);
        const legend = slices
          .map((s) => {
            const pct = sliceTotal > 0 ? Math.round((s.value / sliceTotal) * 100) : 0;
            return `<div class="legend-item"><span class="dot" style="background:${s.color}"></span>${escapeHtml(s.label)} <b>%${pct}</b><span class="num">${escapeHtml(
              formatTry(s.value),
            )}</span></div>`;
          })
          .join("");
        return `<div class="card"><h3>${escapeHtml(t(lang, `gider_cat_${alt}`))}</h3><div class="legend">${legend || `<div>${escapeHtml(t(lang, "no_record"))}</div>`}</div></div>`;
      })
      .join("");
    const giderBar = giderAltToplamlari
      .map((x) => {
        const max = Math.max(1, giderGenelToplam);
        const hAlt = Math.max(8, Math.round((x.value / max) * 120));
        return `<div class="bar-group"><div class="bars"><div class="bar total" style="height:120px"></div><div class="bar alt" style="height:${hAlt}px;background:${
          GIDER_ALT_RENK[x.alt]
        }"></div></div><div class="bar-label">${escapeHtml(t(lang, "total"))} / ${escapeHtml(x.label)}</div><div class="bar-val">${escapeHtml(
          formatTry(giderGenelToplam),
        )} / ${escapeHtml(formatTry(x.value))}</div></div>`;
      })
      .join("");
    const gelirRows = ayIcindeGelirler
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.tarih)}</td><td>${escapeHtml(t(lang, `gelir_kalem_${r.kalem}`))}</td><td class="num">${escapeHtml(
            formatTry(r.tutar),
          )}</td></tr>`,
      )
      .join("");
    const giderRows = state.giderler
      .filter((r) => r.tarih.startsWith(seciliAy))
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.tarih)}</td><td>${escapeHtml(displayGiderAciklama(lang, r.alt, r.aciklama))}</td><td class="num">${escapeHtml(formatTry(r.tutar))}</td></tr>`,
      )
      .join("");
    const ebitdaRowsHtml = ebitdaAylikProjeksiyon
      .map(
        (x) =>
          `<tr><td>${escapeHtml(ayEtiketKisa(x.ay, lang))}</td><td class="num">${escapeHtml(formatTry(x.gelir))}</td><td class="num">${escapeHtml(
            formatTry(x.toplamGider),
          )}</td><td class="num">${escapeHtml(formatTry(x.ebitda))}</td></tr>`,
      )
      .join("");
    const nakitRowsHtml = nakitAylikTablo
      .map(
        (x) =>
          `<tr><td>${escapeHtml(ayEtiketKisa(x.ay, lang))}</td><td class="num">${escapeHtml(formatTry(x.toplamNakitGirisi))}</td><td class="num">${escapeHtml(
            formatTry(x.toplamNakitCikisi),
          )}</td><td class="num">${escapeHtml(formatTry(x.kumulatifNakitFarki))}</td></tr>`,
      )
      .join("");
    const ebitdaGridHeader = yilAyListesi.map((ay) => `<th class="num">${escapeHtml(ayEtiketKisa(ay, lang))}</th>`).join("");
    const ebitdaGridRows = [
      {
        label: t(lang, "excel_row_income"),
        values: ebitdaAylikProjeksiyon.map((x) => x.gelir),
      },
      {
        label: t(lang, "excel_row_expense"),
        values: ebitdaAylikProjeksiyon.map((x) => x.toplamGider),
      },
      {
        label: t(lang, "ebitda_tab_label"),
        values: ebitdaAylikProjeksiyon.map((x) => x.ebitda),
      },
    ]
      .map(
        (r) =>
          `<tr><td><b>${escapeHtml(r.label)}</b></td>${r.values.map((v) => `<td class="num">${escapeHtml(formatTry(v))}</td>`).join("")}</tr>`,
      )
      .join("");
    const nakitRowsConfig: { key: keyof (typeof nakitAylikTablo)[number]; label: string; highlight?: "in" | "out" | "cum" }[] = [
      { key: "donemBasiNakitAy", label: t(lang, "opening_cash") },
      { key: "kullandigimKrediler", label: t(lang, "used_loans") },
      { key: "ebitda", label: t(lang, "ebitda_tab_label") },
      { key: "toplamNakitGirisi", label: t(lang, "total_cash_in"), highlight: "in" },
      { key: "toplamKrediKarti", label: t(lang, "total_credit_card") },
      { key: "toplamKrediler", label: t(lang, "total_loans") },
      { key: "yatirimlar", label: t(lang, "investments_long") },
      { key: "toplamNakitCikisi", label: t(lang, "total_cash_out"), highlight: "out" },
      { key: "donemselNakitFarki", label: t(lang, "period_cash_diff") },
      { key: "kumulatifNakitFarki", label: t(lang, "cumulative_cash_diff"), highlight: "cum" },
    ];
    const nakitGridHeader = yilAyListesi.map((ay) => `<th class="num">${escapeHtml(ayEtiketKisa(ay, lang))}</th>`).join("");
    const nakitGridRows = nakitRowsConfig
      .map((r) => {
        const vals = nakitAylikTablo.map((m) => m[r.key] as number);
        const total = r.key === "kumulatifNakitFarki" ? vals[vals.length - 1] ?? 0 : r.key === "donemBasiNakitAy" ? donemBasiManuel : vals.reduce((a, v) => a + v, 0);
        const rowCls = r.highlight ? ` class="row-${r.highlight}"` : "";
        return `<tr${rowCls}><td><b>${escapeHtml(r.label)}</b></td>${vals
          .map((v) => `<td class="num">${escapeHtml(formatTry(v))}</td>`)
          .join("")}<td class="num"><b>${escapeHtml(formatTry(total))}</b></td></tr>`;
      })
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"/><meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <style>@page{size:A4 landscape;margin:18px 12px;}body{font-family:Arial,sans-serif;background:#0f1f66;color:#e5edff;padding:10px;line-height:1.3}h1,h2,h3{margin:0 0 8px 0}h1{font-size:20px;letter-spacing:.2px}h2{font-size:15px;margin-top:14px;color:#f8fafc}h3{font-size:13px;color:#dbeafe}.section,.card{border:1px solid #355fc2;background:#152b78;border-radius:10px;padding:10px;margin-bottom:10px;box-shadow:0 3px 8px rgba(0,0,0,.18)}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #3b61b8;padding:5px 4px;font-size:10px;word-wrap:break-word}th{background:#1b2f7c;text-align:left;color:#f8fafc}tbody tr:nth-child(even){background:#10256a}.num{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.row{display:flex;gap:10px;align-items:flex-start}.legend{flex:1}.legend-item{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:4px}.dot{width:10px;height:10px;border-radius:999px;display:inline-block}.bars-wrap{display:flex;gap:12px;flex-wrap:wrap}.bar-group{width:150px}.bars{height:120px;display:flex;align-items:flex-end;gap:5px}.bar{width:26px;border:1px solid #1d2d66;border-top-left-radius:4px;border-top-right-radius:4px}.bar.total{background:#6366f1}.bar-label{font-size:10px;margin-top:5px;color:#dbeafe}.bar-val{font-size:10px;color:#bfdbfe;font-weight:700}.doc-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border:1px solid #355fc2;background:#132772;border-radius:10px;margin-bottom:10px}.doc-brand{display:flex;align-items:center;gap:8px}.doc-logo{width:34px;height:34px;border-radius:8px;object-fit:contain;background:#fff;padding:3px}.doc-logo-fallback{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#1d4ed8;color:#fff;font-weight:900}.doc-meta{text-align:right;font-size:10px;color:#bfdbfe}.doc-meta b{color:#fff}.doc-footer{margin-top:14px;padding-top:8px;border-top:1px solid #355fc2;color:#93c5fd;font-size:10px;text-align:center}.page-no:after{content:counter(page);}.row-in td{border-color:#34d399 !important;background:rgba(52,211,153,.11)}.row-out td{border-color:#fb7185 !important;background:rgba(251,113,133,.11)}.row-cum td{border-color:#facc15 !important;background:rgba(250,204,21,.11)}</style></head><body>
    <div class="doc-head">
      <div class="doc-brand">
        <img src="${pdfLogoAttr}" class="doc-logo" alt="FinansSepeti" />
        <div>
          <h1>Cüzdanım Raporu (${escapeHtml(seciliAy)})</h1>
          <div style="font-size:12px;color:#bfdbfe;">FinansSepeti · Gelir / Gider / EBITDA / Nakit Akış</div>
        </div>
      </div>
      <div class="doc-meta">
        <div><b>Rapor ID:</b> ${escapeHtml(raporId)}</div>
        <div><b>Oluşturulma:</b> ${escapeHtml(createdAt)}</div>
      </div>
    </div>
    <div class="section"><h2>Gelirlerim (özet)</h2><div class="row"><div class="legend">${gelirLegend || `<div>${escapeHtml(t(lang, "no_record"))}</div>`}</div></div></div>
    <div class="section"><h2>Gelirlerim Kayıtları</h2><table><thead><tr><th>Tarih</th><th>Kalem</th><th>Tutar</th></tr></thead><tbody>${gelirRows || "<tr><td>-</td><td>-</td><td class='num'>-</td></tr>"}</tbody></table></div>
    <div class="section"><h2>Giderlerim (dağılım özeti)</h2>${giderKartlar}</div>
    <div class="section"><h2>Toplam Gider Karşılaştırma Çubukları</h2><div class="bars-wrap">${giderBar}</div></div>
    <div class="section"><h2>Giderlerim Kayıtları</h2><table><thead><tr><th>Tarih</th><th>Kalem</th><th>Tutar</th></tr></thead><tbody>${giderRows || "<tr><td>-</td><td>-</td><td class='num'>-</td></tr>"}</tbody></table></div>
    <div class="section"><h2>EBITDA Aylık Tablo</h2><table><thead><tr><th>Kalem</th>${ebitdaGridHeader}</tr></thead><tbody>${ebitdaGridRows}</tbody></table></div>
    <div class="section"><h2>Nakit Akış Aylık Tablo</h2><table><thead><tr><th>Kalem</th>${nakitGridHeader}<th>Toplam</th></tr></thead><tbody>${nakitGridRows}</tbody></table></div>
    <div class="doc-footer">FinansSepeti Raporu · ${escapeHtml(createdAt)} · Sayfa <span class="page-no"></span></div>
    </body></html>`;
  };

  const indirPdfSection = async () => {
    try {
      const html = buildFullReportHtml();
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const sonuc = await kaydetPdfYazdirmaCiktisi(uri);
      Alert.alert("PDF indirildi", `${sonuc.dosyaAdi} telefona kaydedildi.`, [
        { text: "Kapat", style: "cancel" },
        {
          text: "Dosyayı aç",
          onPress: () => {
            void indirilenDosyayiAc(sonuc.acmaUri, sonuc.mimeType).catch((e) => {
              Alert.alert("Açılamadı", e instanceof Error ? e.message : String(e));
            });
          },
        },
      ]);
    } catch (e) {
      Alert.alert("PDF açılamadı", e instanceof Error ? e.message : String(e));
    }
  };

  const AyTakvim = (
    <View style={styles.ayRow}>
      <Pressable style={styles.ayBtn} onPress={() => setSeciliAy((a) => ayKaydir(a, -1))}>
        <Text style={styles.ayBtnText}>{"<"}</Text>
      </Pressable>
      <View style={styles.ayKutu}>
        <Text style={styles.ayLabel}>Takvim (ay)</Text>
        <Text style={styles.ayValue}>{seciliAy}</Text>
      </View>
      <Pressable style={styles.ayBtn} onPress={() => setSeciliAy((a) => ayKaydir(a, 1))}>
        <Text style={styles.ayBtnText}>{">"}</Text>
      </Pressable>
      <Pressable style={styles.ayBugun} onPress={() => setSeciliAy(suAnkiAy())}>
        <Text style={styles.ayBugunText}>Bu ay</Text>
      </Pressable>
    </View>
  );
  type PdfIndirButtonProps = { sectionEnd?: boolean };
  function PdfIndirButton({ sectionEnd }: PdfIndirButtonProps) {
    return (
      <View style={[styles.exportRow, sectionEnd ? styles.exportRowSectionEnd : undefined]}>
        <Pressable
          style={({ pressed }) => [styles.exportBtn, styles.pdfBtn, pressed && styles.exportBtnPressed]}
          onPress={() => void indirPdfSection()}
        >
          <Text style={styles.exportBtnText}>PDF indir</Text>
        </Pressable>
      </View>
    );
  }

  const giderDetayToplam = useMemo(
    () =>
      GIDER_DETAYLARI[giderAlt].reduce((acc, d) => {
        if (!giderKalemAktif[d.key]) return acc;
        const val = parseNum(giderKutular[d.key] ?? "");
        return acc + (Number.isFinite(val) && val > 0 ? val : 0);
      }, 0),
    [giderAlt, giderKutular, giderKalemAktif],
  );

  const bankalarFiltreli = useMemo(() => {
    const q = bankaArama.trim().toLocaleLowerCase("tr");
    if (!q) return TURKIYE_BANKALARI;
    return TURKIYE_BANKALARI.filter((b) => b.toLocaleLowerCase("tr").includes(q));
  }, [bankaArama]);

  const openFilterDatePicker = (target: "baslangic" | "bitis") => {
    const raw = target === "baslangic" ? filtreBaslangic : filtreBitis;
    const nextDate = parseDisplayDate(raw) ?? new Date();
    setDatePickerTarget(target);
    setDatePickerValue(nextDate);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: nextDate,
        maximumDate: new Date(2100, 11, 31),
        minimumDate: new Date(2000, 0, 1),
        onChange: onFilterDateChange,
      });
      return;
    }
    setDatePickerOpen(true);
  };

  const persistSavedReports = async (next: SavedReport[]) => {
    setSavedReports(next);
    await AsyncStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(next));
  };

  const kaydetRapor = (type: "ebitda" | "nakit_akis") => {
    const item: SavedReport = {
      id: `${type}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      type,
      seciliAy,
      seciliYil,
      filtreBaslangic,
      filtreBitis,
      donemBasiInput: nakitDonemBasiByYil[seciliYil] ?? "",
    };
    const next = [item, ...savedReports].slice(0, 100);
    void persistSavedReports(next);
    Alert.alert("Kaydedildi", `${type === "ebitda" ? "EBITDA" : "Nakit Akış"} görünümü kaydedildi.`);
  };

  const acKayit = (item: SavedReport) => {
    setSeciliAy(item.seciliAy);
    setFiltreBaslangic(item.filtreBaslangic);
    setFiltreBitis(item.filtreBitis);
    if (item.donemBasiInput) setNakitDonemBasiByYil((s) => ({ ...s, [item.seciliYil]: item.donemBasiInput }));
    setSavedModalOpen(false);
    Alert.alert("Açıldı", "Kayıtlı görünüm uygulandı.");
  };

  const duzenleKayit = (item: SavedReport) => {
    const next = savedReports.map((x) =>
      x.id === item.id
        ? {
            ...x,
            createdAt: new Date().toISOString(),
            seciliAy,
            seciliYil,
            filtreBaslangic,
            filtreBitis,
            donemBasiInput: nakitDonemBasiByYil[seciliYil] ?? "",
          }
        : x,
    );
    void persistSavedReports(next);
    Alert.alert("Güncellendi", "Kayıt güncellendi.");
  };

  const silKayit = (item: SavedReport) => {
    const next = savedReports.filter((x) => x.id !== item.id);
    void persistSavedReports(next);
  };

  const onFilterDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === "dismissed") {
      setDatePickerOpen(false);
      return;
    }
    const picked = selected ?? datePickerValue;
    setDatePickerValue(picked);
    const text = dateToDisplay(picked);
    if (datePickerTarget === "baslangic") setFiltreBaslangic(text);
    else setFiltreBitis(text);
    if (Platform.OS !== "ios") setDatePickerOpen(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>{t(lang, "wallet_title")}</Text>
          <Pressable style={styles.headerBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.headerCloseText}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.anaTabRow}>
          {(
            [
              ["gelirlerim", t(lang, "tab_income")],
              ["giderlerim", t(lang, "tab_expense")],
              ["ebitda", t(lang, "ebitda_tab_label")],
              ["nakit_akis", t(lang, "tab_cashflow")],
            ] as const
          ).map(([k, label]) => (
            <Pressable key={k} style={[styles.anaTab, anaTab === k && styles.anaTabOn]} onPress={() => setAnaTab(k)}>
              <Text style={[styles.anaTabText, anaTab === k && styles.anaTabTextOn]} numberOfLines={2}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!hazir ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={palette.accent} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
            {AyTakvim}

            {anaTab === "gelirlerim" ? (
              <View>
                <Text style={styles.bolumBaslik}>{t(lang, "wallet_income_section")}</Text>
                <Text style={styles.hint}>{t(lang, "wallet_income_hint")}</Text>
                <Text style={styles.filtreBaslik}>{t(lang, "filtering")}</Text>
                <View style={styles.filtreRow}>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("baslangic")}>
                    <Text style={filtreBaslangic ? styles.takvimValue : styles.takvimPlaceholder}>
                      {filtreBaslangic || t(lang, "start_date_select")}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("bitis")}>
                    <Text style={filtreBitis ? styles.takvimValue : styles.takvimPlaceholder}>{filtreBitis || t(lang, "end_date_select")}</Text>
                  </Pressable>
                </View>
                {hasValidFilter ? (
                  <Text style={styles.ozetMini}>
                    {t(lang, "wallet_filter_income_total")} {formatTry(filtreGelirToplam)}
                  </Text>
                ) : null}
                <Text style={styles.label}>{t(lang, "date_label")}</Text>
                <TextInput
                  value={gelirTarih}
                  onChangeText={setGelirTarih}
                  placeholder="YYYY-AA-GG"
                  placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                  style={styles.input}
                />
                <View style={styles.gelirGrid}>
                  {GELIR_KALEMLERI.map(({ key }) => {
                    const on = state.gelirKalemAktif[key];
                    return (
                      <View key={key} style={[styles.gelirCard, on && styles.gelirCardOn]}>
                        <View style={styles.gelirHead}>
                          <Text style={styles.gelirTitle}>{t(lang, `gelir_kalem_${key}`)}</Text>
                        </View>
                        <View style={styles.kalemAmountRow}>
                          <TextInput
                            editable={on}
                            value={gelirKutular[key] ?? ""}
                            onChangeText={(t) => setGelirKutular((s) => ({ ...s, [key]: formatTutarInput(t) }))}
                            keyboardType="number-pad"
                            placeholder="0"
                            placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                            style={[styles.input, styles.inputInKalemRow, !on && styles.inputDisabled]}
                          />
                          <Pressable style={styles.yokTap} onPress={() => toggleKalem(key)} hitSlop={8}>
                            <Text style={styles.yokText}>{t(lang, "no_option")}</Text>
                            <View style={styles.yokBox}>{!on ? <Text style={styles.yokTick}>✓</Text> : null}</View>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
                <Pressable style={styles.primaryBtn} onPress={gelirTopluKaydet}>
                  <Text style={styles.primaryBtnText}>{t(lang, "save_income")}</Text>
                </Pressable>

                <Text style={styles.bolumBaslik}>
                  {t(lang, "income_chart_title")} ({seciliAy})
                </Text>
                <View style={styles.pastaKutu}>
                  <Pie3D slices={gelirPastaSlices} />
                  <View style={styles.pastaSag}>
                    {gelirPastaSlices.map((s) => {
                      const pct = gelirPastaToplam > 0 ? Math.round((s.value / gelirPastaToplam) * 100) : 0;
                      return (
                        <View key={s.key} style={styles.pastaSatir}>
                          <View style={[styles.pastaRenk, { backgroundColor: s.color }]} />
                          <Text style={styles.pastaEtiket}>{s.label}</Text>
                          <Text style={styles.pastaPct}>%{pct}</Text>
                          <Text style={styles.pastaTutar}>{formatTry(s.value)}</Text>
                        </View>
                      );
                    })}
                    <View style={styles.pastaToplamSatir}>
                      <Text style={styles.pastaToplamEtiket}>{t(lang, "total")} {t(lang, "tab_income").toLowerCase()}</Text>
                      <Text style={styles.pastaToplamTutar}>{formatTry(gelirPastaToplam)}</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.bolumBaslik}>{t(lang, "wallet_records_month_income")}</Text>
                {ayIcindeGelirler.length === 0 ? (
                  <Text style={styles.empty}>{t(lang, "no_record")}</Text>
                ) : (
                  ayIcindeGelirler.map((r) => (
                    <View key={r.id} style={styles.kayitSatir}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kayitBaslik}>
                          {t(lang, `gelir_kalem_${r.kalem}`)}
                        </Text>
                        <Text style={styles.kayitMeta}>{r.tarih}</Text>
                      </View>
                      <Text style={styles.kayitTutar}>{formatTry(r.tutar)}</Text>
                      <Pressable onPress={() => silGelir(r.id)} hitSlop={8}>
                        <Text style={styles.sil}>{t(lang, "delete")}</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                <PdfIndirButton sectionEnd />
              </View>
            ) : null}

            {anaTab === "giderlerim" ? (
              <View>
                <Text style={styles.hint}>{t(lang, "wallet_expense_intro_hint")}</Text>
                <Text style={styles.filtreBaslik}>{t(lang, "filtering")}</Text>
                <View style={styles.filtreRow}>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("baslangic")}>
                    <Text style={filtreBaslangic ? styles.takvimValue : styles.takvimPlaceholder}>
                      {filtreBaslangic || t(lang, "start_date_select")}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("bitis")}>
                    <Text style={filtreBitis ? styles.takvimValue : styles.takvimPlaceholder}>{filtreBitis || t(lang, "end_date_select")}</Text>
                  </Pressable>
                </View>
                {hasValidFilter ? (
                  <Text style={styles.ozetMini}>
                    {t(lang, "wallet_filter_expense_total")} {formatTry(filtreGiderToplam)}
                  </Text>
                ) : null}
                {hasValidFilter
                  ? filtreGiderKalemToplam.slice(0, 6).map(([kalem, toplam]) => (
                      <Text key={kalem} style={styles.hint}>
                        {displayExpenseLineLabel(lang, kalem)}: {formatTry(toplam)}
                      </Text>
                    ))
                  : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.altTabRow}>
                  {GIDER_ALTLARI.map(({ key }) => (
                    <Pressable key={key} style={[styles.altTab, giderAlt === key && styles.altTabOn]} onPress={() => setGiderAlt(key)}>
                      <Text style={[styles.altTabText, giderAlt === key && styles.altTabTextOn]} numberOfLines={2}>
                        {t(lang, `gider_cat_${key}`)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {giderAlt === "kredi" ? (
                  <Pressable style={styles.secondaryBtn} onPress={kredilerdenAktar}>
                    <Text style={styles.secondaryBtnText}>{t(lang, "wallet_import_installments")}</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.bolumBaslik}>
                  {t(lang, "wallet_expense_detail_title")} ({t(lang, `gider_cat_${giderAlt}`)})
                </Text>
                <Text style={styles.label}>{t(lang, "date_label")}</Text>
                <TextInput
                  value={giderTarih}
                  onChangeText={setGiderTarih}
                  placeholder="YYYY-AA-GG"
                  placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                  style={styles.input}
                />
                <View style={styles.giderGrid}>
                  {GIDER_DETAYLARI[giderAlt].map((d) => (
                    <View key={d.key} style={styles.giderCard}>
                      <Text style={styles.giderTitle}>{t(lang, `giderdet_${d.key}`)}</Text>
                      {giderAlt === "kredi_karti" ? (
                        <Pressable
                          style={styles.bankSelectBtn}
                          onPress={() => {
                            setAktifKartKey(d.key);
                            setBankaArama("");
                            setBankaPickerOpen(true);
                          }}
                        >
                          <Text style={styles.bankSelectBtnText} numberOfLines={1}>
                            {krediKartBankalari[d.key] || t(lang, "bank_select")}
                          </Text>
                        </Pressable>
                      ) : null}
                      <View style={styles.kalemAmountRow}>
                        <TextInput
                          editable={!!giderKalemAktif[d.key]}
                          value={giderKutular[d.key] ?? ""}
                          onChangeText={(t) => setGiderKutular((s) => ({ ...s, [d.key]: formatTutarInput(t) }))}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                          style={[
                            styles.input,
                            styles.inputInKalemRow,
                            !giderKalemAktif[d.key] && styles.inputDisabled,
                          ]}
                        />
                        <Pressable
                          style={styles.yokTap}
                          onPress={() => setGiderKalemAktif((s) => ({ ...s, [d.key]: !s[d.key] }))}
                          hitSlop={8}
                        >
                          <Text style={styles.yokText}>{t(lang, "no_option")}</Text>
                          <View style={styles.yokBox}>
                            {!giderKalemAktif[d.key] ? <Text style={styles.yokTick}>✓</Text> : null}
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={styles.ozetMini}>Toplu gider toplamı: {formatTry(giderDetayToplam)}</Text>
                <Pressable style={styles.primaryBtn} onPress={giderTopluKaydet}>
                  <Text style={styles.primaryBtnText}>{t(lang, "save_expense")}</Text>
                </Pressable>
                <Text style={styles.bolumBaslik}>
                  {t(lang, "wallet_expense_charts_title")} ({seciliAy})
                </Text>
                {(["fatura", "genel", "kredi", "kredi_karti"] as GiderAlt[]).map((alt) => {
                  const slices = giderPastaByAlt[alt];
                  const toplam = slices.reduce((a, s) => a + s.value, 0);
                  return (
                    <View key={`pasta-${alt}`} style={styles.giderPastaBlok}>
                      <Text style={styles.giderPastaBaslik}>{t(lang, `gider_cat_${alt}`)}</Text>
                      <View style={styles.pastaKutu}>
                        <Pie3D slices={slices} size={146} />
                        <View style={styles.pastaSag}>
                          {slices.length === 0 ? (
                            <Text style={styles.empty}>{t(lang, "no_record")}</Text>
                          ) : (
                            slices.slice(0, 6).map((s) => {
                              const pct = toplam > 0 ? Math.round((s.value / toplam) * 100) : 0;
                              return (
                                <View key={s.key} style={styles.pastaSatir}>
                                  <View style={[styles.pastaRenk, { backgroundColor: s.color }]} />
                                  <Text style={styles.pastaEtiket} numberOfLines={1}>
                                    {s.label}
                                  </Text>
                                  <Text style={styles.pastaPct}>%{pct}</Text>
                                  <Text style={styles.pastaTutar}>{formatTry(s.value)}</Text>
                                </View>
                              );
                            })
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
                <Text style={styles.bolumBaslik}>{t(lang, "wallet_bar_subtitle")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.giderChartWrap}>
                    <View style={styles.giderYAxis}>
                      {giderYTicks.map((t) => (
                        <View key={`yt-${t}`} style={styles.giderYAxisRow}>
                          <Text style={styles.giderYAxisText}>{formatTry(giderBarMax * t)}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.giderPlotArea}>
                      <View style={styles.giderLegendRow}>
                        <View style={styles.giderLegendItem}>
                          <View style={[styles.giderLegendDot, styles.giderBarTotal]} />
                          <Text style={styles.giderLegendText}>{t(lang, "total")}</Text>
                        </View>
                        <View style={styles.giderLegendItem}>
                          <View style={[styles.giderLegendDot, { backgroundColor: "#34d399" }]} />
                          <Text style={styles.giderLegendText}>{t(lang, "wallet_legend_item")}</Text>
                        </View>
                      </View>
                      <View style={styles.giderGridOverlay}>
                        {giderYTicks.map((t) => (
                          <View key={`line-${t}`} style={styles.giderGridLine} />
                        ))}
                      </View>
                      <View style={styles.giderXAxis} />
                      <View style={styles.giderBarWrap}>
                    {giderAltToplamlari.map((x) => {
                      const totalH = 124;
                      const altH = Math.max(8, Math.round((x.value / giderBarMax) * 124));
                      const pct = giderGenelToplam > 0 ? Math.round((x.value / giderGenelToplam) * 100) : 0;
                      return (
                        <View key={`bar-${x.alt}`} style={styles.giderBarGroup}>
                          <View style={styles.giderBarPair}>
                            <View style={styles.giderBarColTight}>
                              <Text style={styles.giderBarPct}>%100</Text>
                              <View style={[styles.giderBar, styles.giderBarTotal, { height: totalH }]} />
                            </View>
                            <View style={styles.giderBarColTight}>
                              <Text style={styles.giderBarPct}>%{pct}</Text>
                              <View style={[styles.giderBar, { height: altH, backgroundColor: GIDER_ALT_RENK[x.alt] }]} />
                            </View>
                          </View>
                          <Text style={styles.giderGroupLabel} numberOfLines={2}>
                            {x.label}
                          </Text>
                          <Text style={styles.giderGroupVal}>
                            {formatTry(giderGenelToplam)} / {formatTry(x.value)}
                          </Text>
                        </View>
                      );
                    })}
                      </View>
                    </View>
                  </View>
                </ScrollView>

                <Text style={styles.bolumBaslik}>{t(lang, "wallet_this_month_heading")}</Text>
                {ayIcindeGiderler.length === 0 ? (
                  <Text style={styles.empty}>{t(lang, "no_record")}</Text>
                ) : (
                  ayIcindeGiderler.map((r) => (
                    <View key={r.id} style={styles.kayitSatir}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kayitBaslik}>{displayGiderAciklama(lang, r.alt, r.aciklama)}</Text>
                        <Text style={styles.kayitMeta}>{r.tarih}</Text>
                      </View>
                      <Text style={styles.kayitTutar}>{formatTry(r.tutar)}</Text>
                      <Pressable onPress={() => silGider(r.id)} hitSlop={8}>
                        <Text style={styles.sil}>{t(lang, "delete")}</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                <PdfIndirButton sectionEnd />
              </View>
            ) : null}

            {anaTab === "ebitda" ? (
              <View>
                <Text style={styles.bolumBaslik}>{t(lang, "ebitda_tab_label")}</Text>
                <Text style={styles.filtreBaslik}>{t(lang, "filtering")}</Text>
                <View style={styles.filtreRow}>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("baslangic")}>
                    <Text style={filtreBaslangic ? styles.takvimValue : styles.takvimPlaceholder}>
                      {filtreBaslangic || t(lang, "start_date_select")}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("bitis")}>
                    <Text style={filtreBitis ? styles.takvimValue : styles.takvimPlaceholder}>{filtreBitis || t(lang, "end_date_select")}</Text>
                  </Pressable>
                </View>
                <PdfIndirButton />
                <View style={styles.ebitdaUstKutu}>
                  <View style={styles.ebitdaKolon}>
                    <Text style={styles.ebitdaKolonBaslik}>{t(lang, "ebitda_block_income")}</Text>
                    <Text style={styles.ebitdaSatir}>
                      {t(lang, "ebitda_salary_other")} {formatTry(seciliAyEbitda?.gelir ?? 0)}
                    </Text>
                    <Text style={styles.ebitdaSatirToplam}>
                      {t(lang, "ebitda_total_income")} {formatTry(seciliAyEbitda?.gelir ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.ebitdaKolon}>
                    <Text style={styles.ebitdaKolonBaslik}>{t(lang, "ebitda_block_expense")}</Text>
                    <Text style={styles.ebitdaSatir}>
                      {t(lang, "ebitda_total_bills")} {formatTry(seciliAyEbitda?.toplamFatura ?? 0)}
                    </Text>
                    <Text style={styles.ebitdaSatir}>
                      {t(lang, "ebitda_total_general")} {formatTry(seciliAyEbitda?.toplamGenel ?? 0)}
                    </Text>
                    <Text style={styles.ebitdaSatirToplam}>
                      {t(lang, "ebitda_total_expenses")} {formatTry(seciliAyEbitda?.toplamGider ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.ebitdaKolon}>
                    <Text style={styles.ebitdaKolonBaslik}>{t(lang, "ebitda_block_credit")}</Text>
                    <Text style={styles.ebitdaSatir}>
                      {t(lang, "ebitda_total_cc")} {formatTry(seciliAyEbitda?.toplamKrediKartlari ?? 0)}
                    </Text>
                    <Text style={styles.ebitdaSatir}>
                      {t(lang, "ebitda_total_loans_line")} {formatTry(seciliAyEbitda?.toplamKrediler ?? 0)}
                    </Text>
                    <Text style={styles.ebitdaNot}>{t(lang, "ebitda_formula_note")}</Text>
                  </View>
                </View>
                <Text style={styles.bolumBaslik}>{t(lang, "ebitda_monthly_projection")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                  <View>
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelH, styles.excelColK]}>{t(lang, "excel_col_item")}</Text>
                      {yilAyListesi.map((ay) => (
                        <Text key={`h-${ay}`} style={[styles.excelH, styles.projCol]}>
                          {ayEtiketKisa(ay, lang)}
                        </Text>
                      ))}
                    </View>
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelC, styles.excelColK, styles.satirBaslik]}>{t(lang, "excel_row_income")}</Text>
                      {ebitdaAylikProjeksiyon.map((x) => (
                        <Text key={`g-${x.ay}`} style={[styles.excelC, styles.projCol, styles.projValue]}>
                          {formatTry(x.gelir)}
                        </Text>
                      ))}
                    </View>
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelC, styles.excelColK, styles.satirBaslik]}>{t(lang, "excel_row_expense")}</Text>
                      {ebitdaAylikProjeksiyon.map((x) => (
                        <Text key={`gd-${x.ay}`} style={[styles.excelC, styles.projCol, styles.projValue]}>
                          {formatTry(x.toplamGider)}
                        </Text>
                      ))}
                    </View>
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelC, styles.excelColK, styles.satirBaslik, styles.ebitdaSatirMavi]}>{t(lang, "ebitda_tab_label")}</Text>
                      {ebitdaAylikProjeksiyon.map((x) => (
                        <Text
                          key={`eb-${x.ay}`}
                          style={[styles.excelC, styles.projCol, styles.projValue, x.ebitda < 0 ? styles.neg : styles.pos]}
                        >
                          {formatTry(x.ebitda)}
                        </Text>
                      ))}
                    </View>
                  </View>
                </ScrollView>
                <View style={styles.saveActionsRow}>
                  <Pressable style={styles.secondaryBtn} onPress={() => kaydetRapor("ebitda")}>
                    <Text style={styles.secondaryBtnText}>{t(lang, "save")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => {
                      setSavedModalType("ebitda");
                      setSavedModalOpen(true);
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>{t(lang, "saved_items")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {anaTab === "nakit_akis" ? (
              <View>
                <Text style={styles.bolumBaslik}>{t(lang, "nakit_flow_heading")}</Text>
                <Text style={styles.filtreBaslik}>{t(lang, "filtering")}</Text>
                <View style={styles.filtreRow}>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("baslangic")}>
                    <Text style={filtreBaslangic ? styles.takvimValue : styles.takvimPlaceholder}>
                      {filtreBaslangic || t(lang, "start_date_select")}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.input, styles.filtreInput, styles.takvimBtn]} onPress={() => openFilterDatePicker("bitis")}>
                    <Text style={filtreBitis ? styles.takvimValue : styles.takvimPlaceholder}>{filtreBitis || t(lang, "end_date_select")}</Text>
                  </Pressable>
                </View>
                <PdfIndirButton />
                <Text style={styles.hint}>{t(lang, "cashflow_opening_note")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                  <View>
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelH, styles.excelColK]}>{t(lang, "cashflow_table")}</Text>
                      {yilAyListesi.map((ay) => (
                        <Text key={`nh-${ay}`} style={[styles.excelH, styles.projCol]}>
                          {ayEtiketKisa(ay, lang)}
                        </Text>
                      ))}
                      <Text style={[styles.excelH, styles.toplamCol]}>{t(lang, "cashflow_total_col")}</Text>
                    </View>
                    {[
                      { key: "donemBasiNakitAy", label: t(lang, "opening_cash") },
                      { key: "kullandigimKrediler", label: t(lang, "used_loans") },
                      { key: "ebitda", label: t(lang, "ebitda_tab_label") },
                      { key: "toplamNakitGirisi", label: t(lang, "total_cash_in") },
                      { key: "toplamKrediKarti", label: t(lang, "total_credit_card") },
                      { key: "toplamKrediler", label: t(lang, "total_loans") },
                      { key: "yatirimlar", label: t(lang, "investments_long") },
                      { key: "toplamNakitCikisi", label: t(lang, "total_cash_out") },
                      { key: "donemselNakitFarki", label: t(lang, "period_cash_diff") },
                      { key: "kumulatifNakitFarki", label: t(lang, "cumulative_cash_diff") },
                    ].map((row) => {
                      const toplam =
                        row.key === "donemBasiNakitAy"
                          ? donemBasiManuel
                          :
                        row.key === "kumulatifNakitFarki"
                          ? (nakitAylikTablo[nakitAylikTablo.length - 1]?.kumulatifNakitFarki ?? 0)
                          : nakitAylikTablo.reduce((a, m) => a + (m[row.key as keyof (typeof nakitAylikTablo)[number]] as number), 0);
                      const isHighlightIn = row.key === "toplamNakitGirisi";
                      const isHighlightOut = row.key === "toplamNakitCikisi";
                      const isHighlightCum = row.key === "kumulatifNakitFarki";
                      return (
                        <View
                          key={row.key}
                          style={[
                            styles.excelRow,
                            isHighlightIn ? styles.rowHighlightIn : null,
                            isHighlightOut ? styles.rowHighlightOut : null,
                            isHighlightCum ? styles.rowHighlightCum : null,
                          ]}
                        >
                          <Text style={[styles.excelC, styles.excelColK, styles.satirBaslik]}>{row.label}</Text>
                          {nakitAylikTablo.map((m, index) => {
                            const val = m[row.key as keyof typeof m] as number;
                            if (row.key === "donemBasiNakitAy" && index === 0) {
                              return (
                                <TextInput
                                  key={`${row.key}-${m.ay}`}
                                  value={nakitDonemBasiByYil[seciliYil] ?? ""}
                                  onChangeText={(t) => setNakitDonemBasiByYil((s) => ({ ...s, [seciliYil]: formatTutarInputSigned(t) }))}
                                  keyboardType="numbers-and-punctuation"
                                  placeholder="0"
                                  placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                                  style={[styles.excelInput, styles.projCol]}
                                />
                              );
                            }
                            return (
                              <Text key={`${row.key}-${m.ay}`} style={[styles.excelC, styles.projCol, styles.projValue, val < 0 ? styles.neg : null]}>
                                {formatTry(val)}
                              </Text>
                            );
                          })}
                          <Text style={[styles.excelC, styles.toplamCol, styles.toplamValue, toplam < 0 ? styles.neg : null]}>{formatTry(toplam)}</Text>
                        </View>
                      );
                    })}
                    <View style={styles.excelRow}>
                      <Text style={[styles.excelC, styles.excelColK, styles.satirBaslik]}>{t(lang, "cashflow_formula_block")}</Text>
                      <Text style={[styles.excelC, styles.formulSummary]}>{t(lang, "cashflow_formula_lines")}</Text>
                    </View>
                  </View>
                </ScrollView>
                <View style={styles.saveActionsRow}>
                  <Pressable style={styles.secondaryBtn} onPress={() => kaydetRapor("nakit_akis")}>
                    <Text style={styles.secondaryBtnText}>{t(lang, "save")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => {
                      setSavedModalType("nakit_akis");
                      setSavedModalOpen(true);
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>{t(lang, "saved_items")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}

        {datePickerOpen && Platform.OS === "ios" ? (
          <DateTimePicker
            mode="date"
            display="spinner"
            value={datePickerValue}
            onChange={onFilterDateChange}
            maximumDate={new Date(2100, 11, 31)}
            minimumDate={new Date(2000, 0, 1)}
          />
        ) : null}

        <Modal visible={bankaPickerOpen} transparent animationType="slide" onRequestClose={() => setBankaPickerOpen(false)}>
          <View style={styles.bankModalBackdrop}>
            <Pressable style={styles.bankModalDismiss} onPress={() => setBankaPickerOpen(false)} />
            <View style={styles.bankModalCard}>
              <View style={styles.bankModalHeader}>
                <Text style={styles.bankModalTitle}>{t(lang, "bank_select")}</Text>
                <Pressable hitSlop={12} onPress={() => setBankaPickerOpen(false)}>
                  <Text style={styles.bankModalClose}>✕</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.bankSearch}
                value={bankaArama}
                onChangeText={setBankaArama}
                placeholder={t(lang, "bank_search")}
                placeholderTextColor={harcamalarDeepWellInputPlaceholderColor}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ScrollView style={styles.bankList} keyboardShouldPersistTaps="handled">
                {bankalarFiltreli.map((b) => (
                  <Pressable
                    key={b}
                    style={styles.bankRow}
                    onPress={() => {
                      if (aktifKartKey) setKrediKartBankalari((s) => ({ ...s, [aktifKartKey]: b }));
                      setBankaPickerOpen(false);
                    }}
                  >
                    <Text style={styles.bankRowText}>{b}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={savedModalOpen} transparent animationType="slide" onRequestClose={() => setSavedModalOpen(false)}>
          <View style={styles.bankModalBackdrop}>
            <Pressable style={styles.bankModalDismiss} onPress={() => setSavedModalOpen(false)} />
            <View style={styles.bankModalCard}>
              <View style={styles.bankModalHeader}>
                <Text style={styles.bankModalTitle}>
                  {savedModalType === "ebitda" ? t(lang, "saved_ebitda_title") : t(lang, "saved_cashflow_title")}
                </Text>
                <Pressable hitSlop={12} onPress={() => setSavedModalOpen(false)}>
                  <Text style={styles.bankModalClose}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.bankList} keyboardShouldPersistTaps="handled">
                {savedReports.filter((x) => x.type === savedModalType).length === 0 ? (
                  <Text style={styles.empty}>{t(lang, "no_record")}</Text>
                ) : (
                  savedReports
                    .filter((x) => x.type === savedModalType)
                    .map((item) => (
                      <View key={item.id} style={styles.savedRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.kayitBaslik}>{item.seciliAy}</Text>
                          <Text style={styles.kayitMeta}>{new Date(item.createdAt).toLocaleString("tr-TR")}</Text>
                        </View>
                        <Pressable onPress={() => acKayit(item)} hitSlop={8}>
                          <Text style={styles.savedAction}>{t(lang, "open")}</Text>
                        </Pressable>
                        <Pressable onPress={() => duzenleKayit(item)} hitSlop={8}>
                          <Text style={styles.savedAction}>{t(lang, "edit")}</Text>
                        </Pressable>
                        <Pressable onPress={() => silKayit(item)} hitSlop={8}>
                          <Text style={styles.savedActionDanger}>{t(lang, "delete")}</Text>
                        </Pressable>
                      </View>
                    ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}


