import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchMarketSnapshot } from "../lib/yahooFinance";
import { useThemeColors } from "../theme/ThemeProvider";
import { createPiyasalarModalStyles } from "./piyasalarModalStyles";
import type { YatirimPrefill } from "./YatirimEkleModal";
import { MarketTileCard } from "./MarketTileCard";
import { TradingViewChartModal } from "./TradingViewChartModal";
import { NASDAQ_100_SYMBOLS } from "../data/nasdaq100Symbols";
import type { EmtiaTvChartHint } from "../lib/yahooFinance";
import { BIST100_CODES, loadBistAllCards } from "./piyasalar/piyasalarBist";
import { loadDovizFxCards } from "./piyasalar/piyasalarDoviz";
import { getExtraEmtiaCardsDeduped } from "./piyasalar/piyasalarEmtia";
import { CRYPTO_CODES, koinTradingViewSymbol, loadKoinlerAllCards } from "./piyasalar/piyasalarKoinler";
import { emtiaActions, fxActions } from "./piyasalar/piyasalarModalCharts";
import { loadNasdaqAllCards } from "./piyasalar/piyasalarNasdaq";
import { orderNasdaqCardsForSearch } from "./piyasalar/piyasalarNasdaqSort";
import {
  formatPct,
  formatTry,
  formatUsd,
  numToBirimInput,
  parseDisplayNumber,
  type PiyasalarCardItem,
} from "./piyasalar/piyasalarShared";

type Slice = {
  price: number;
  change?: number | null;
  changePct?: number | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenYatirimEkle: (prefill: YatirimPrefill) => void;
  data: {
    altinTl: Slice;
    gumusTl: Slice;
    usdTl: Slice;
    eurTl: Slice;
    petrolUsd: Slice;
    bist100: Slice;
    emtiaTvChart?: EmtiaTvChartHint;
  };
};

type Tab = "emtialar" | "nasdaq" | "bist" | "koinler" | "doviz";

type YahooSnap = Awaited<ReturnType<typeof fetchMarketSnapshot>>;

/** Aynı Piyasalar penceresi açıkken: sekme önbelleği, Yahoo snapshot önbelleği ve arka plan yenileme (modal açık). */
const P_PIYASALAR_MODAL_LIVE_MS = 15 * 60 * 1000;
const P_TAB_LIST_CACHE_TTL_MS = P_PIYASALAR_MODAL_LIVE_MS;
const P_YAHOO_SNAP_CACHE_TTL_MS = P_PIYASALAR_MODAL_LIVE_MS;

function cacheFresh(at: number, ttlMs: number): boolean {
  return Date.now() - at < ttlMs;
}

export function PiyasalarModal({ visible, onClose, onOpenYatirimEkle, data }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(() => createPiyasalarModalStyles(palette), [palette]);

  const listRef = useRef<FlatList<PiyasalarCardItem>>(null);
  /** Modal kapanınca artan; arka plan yanıtları eski oturuma yazmasın. */
  const piyasalarSessionGenRef = useRef(0);
  const tabRef = useRef<Tab>("emtialar");
  const listInflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const [yahooSnap, setYahooSnap] = useState<Awaited<ReturnType<typeof fetchMarketSnapshot>> | null>(null);
  const [tab, setTab] = useState<Tab>("emtialar");
  tabRef.current = tab;
  const [extraEmtiaCards, setExtraEmtiaCards] = useState<PiyasalarCardItem[]>([]);
  const [bistCards, setBistCards] = useState<PiyasalarCardItem[]>([]);
  const [bistSearch, setBistSearch] = useState("");
  const [nasdaqCards, setNasdaqCards] = useState<PiyasalarCardItem[]>([]);
  const [nasdaqSearch, setNasdaqSearch] = useState("");
  const [cryptoCards, setCryptoCards] = useState<PiyasalarCardItem[]>([]);
  const [cryptoSearch, setCryptoSearch] = useState("");
  const [fxCards, setFxCards] = useState<PiyasalarCardItem[]>([]);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState("");
  /** Gram TL grafikten (imleç) Geri ile kartta gösterilecek TRY/gram + günlük %. */
  const [gramChartTryOverride, setGramChartTryOverride] = useState<{
    gold?: { price: number; change?: number; changePct?: number };
    silver?: { price: number; change?: number; changePct?: number };
  }>({});
  const piyasalarSessionCacheRef = useRef<{
    yahoo?: { at: number; snap: YahooSnap };
    emtiaExtra?: { at: number; cards: PiyasalarCardItem[] };
    dovizFx?: { at: number; cards: PiyasalarCardItem[] };
    bist?: { at: number; cards: PiyasalarCardItem[] };
    nasdaq?: { at: number; cards: PiyasalarCardItem[] };
    koinler?: { at: number; cards: PiyasalarCardItem[] };
  }>({});

  const runListDeduped = useCallback((key: string, task: () => Promise<void>) => {
    const m = listInflightRef.current;
    const ex = m.get(key);
    if (ex) return ex;
    const p = task().finally(() => {
      m.delete(key);
    });
    m.set(key, p);
    return p;
  }, []);

  /** Modal açılınca döviz / NASDAQ / BIST / koin listeleri ön yüklenir. */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const genAtStart = piyasalarSessionGenRef.current;

    const syncIfActive = (t: Tab, fn: () => void) => {
      if (cancelled || genAtStart !== piyasalarSessionGenRef.current) return;
      if (tabRef.current === t) fn();
    };

    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      void Promise.all([
      runListDeduped("doviz", async () => {
        const hit = piyasalarSessionCacheRef.current.dovizFx;
        if (hit && cacheFresh(hit.at, P_TAB_LIST_CACHE_TTL_MS) && hit.cards.length > 0) return;
        const loaded = await loadDovizFxCards(piyasalarSessionCacheRef.current.yahoo?.snap?.dovizTvExtras);
        if (genAtStart !== piyasalarSessionGenRef.current) return;
        piyasalarSessionCacheRef.current.dovizFx = { at: Date.now(), cards: loaded };
        syncIfActive("doviz", () => setFxCards(loaded));
      }),
      runListDeduped("nasdaq", async () => {
        const hit = piyasalarSessionCacheRef.current.nasdaq;
        if (
          hit &&
          cacheFresh(hit.at, P_TAB_LIST_CACHE_TTL_MS) &&
          hit.cards.length >= NASDAQ_100_SYMBOLS.length - 1
        ) {
          return;
        }
        const loadedN = await loadNasdaqAllCards();
        if (genAtStart !== piyasalarSessionGenRef.current) return;
        piyasalarSessionCacheRef.current.nasdaq = { at: Date.now(), cards: loadedN };
        syncIfActive("nasdaq", () => setNasdaqCards(loadedN));
      }),
      runListDeduped("bist", async () => {
        const hit = piyasalarSessionCacheRef.current.bist;
        if (
          hit &&
          cacheFresh(hit.at, P_TAB_LIST_CACHE_TTL_MS) &&
          hit.cards.length >= BIST100_CODES.length - 1
        ) {
          return;
        }
        const loaded = await loadBistAllCards();
        if (genAtStart !== piyasalarSessionGenRef.current) return;
        piyasalarSessionCacheRef.current.bist = { at: Date.now(), cards: loaded };
        syncIfActive("bist", () => setBistCards(loaded));
      }),
      runListDeduped("koinler", async () => {
        const kHit = piyasalarSessionCacheRef.current.koinler;
        if (
          kHit &&
          cacheFresh(kHit.at, P_TAB_LIST_CACHE_TTL_MS) &&
          kHit.cards.length >= CRYPTO_CODES.length - 1 &&
          kHit.cards.some((c) => c.value !== "—")
        ) {
          return;
        }
        const loaded = await loadKoinlerAllCards();
        if (genAtStart !== piyasalarSessionGenRef.current) return;
        if (loaded.some((c) => c.value !== "—")) {
          piyasalarSessionCacheRef.current.koinler = { at: Date.now(), cards: loaded };
        }
        syncIfActive("koinler", () => setCryptoCards(loaded));
      }),
      ]).catch(() => {});
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [visible, runListDeduped]);

  useEffect(() => {
    if (!visible || tab !== "nasdaq") return;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [nasdaqSearch, tab, visible]);

  useEffect(() => {
    if (!visible) {
      piyasalarSessionGenRef.current += 1;
      listInflightRef.current = new Map();
      piyasalarSessionCacheRef.current = {};
      setYahooSnap(null);
      setExtraEmtiaCards([]);
      setFxCards([]);
      setNasdaqCards([]);
      setBistCards([]);
      setCryptoCards([]);
      setGramChartTryOverride({});
    }
  }, [visible]);

  /** TV/Yahoo birleşik snapshot: sekmeden bağımsız (ilk sekme geçişinde fiyat boş kalmasın). */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const yCached = piyasalarSessionCacheRef.current.yahoo;
    if (yCached && cacheFresh(yCached.at, P_YAHOO_SNAP_CACHE_TTL_MS)) {
      setYahooSnap(yCached.snap);
    }
    const loadYahooSnap = async () => {
      if (cancelled) return;
      const snap = await fetchMarketSnapshot();
      if (!cancelled) {
        setYahooSnap(snap);
        piyasalarSessionCacheRef.current.yahoo = { at: Date.now(), snap };
      }
    };
    if (!yCached || !cacheFresh(yCached.at, P_YAHOO_SNAP_CACHE_TTL_MS)) {
      void loadYahooSnap();
    }
    const snapPoll = setInterval(() => {
      if (!cancelled) void loadYahooSnap();
    }, P_PIYASALAR_MODAL_LIVE_MS);
    return () => {
      cancelled = true;
      clearInterval(snapPoll);
    };
  }, [visible]);

  /** Emtialar ek kartları: sekmeden bağımsız (modal açılır açılmaz); böylece Emtialar’a geçince ızgara boş kalmaz. */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const emHit = piyasalarSessionCacheRef.current.emtiaExtra;
    if (emHit && cacheFresh(emHit.at, P_TAB_LIST_CACHE_TTL_MS) && emHit.cards.length > 0) {
      setExtraEmtiaCards(emHit.cards);
    }
    const loadExtraEmtia = async (force: boolean) => {
      try {
        const cards = await getExtraEmtiaCardsDeduped(force);
        if (!cancelled) {
          setExtraEmtiaCards(cards);
          piyasalarSessionCacheRef.current.emtiaExtra = { at: Date.now(), cards };
        }
      } catch {
        /* ağ */
      }
    };
    if (!emHit || !cacheFresh(emHit.at, P_TAB_LIST_CACHE_TTL_MS) || emHit.cards.length === 0) {
      void loadExtraEmtia(false);
    }
    const emtiaPoll = setInterval(() => {
      if (!cancelled) void loadExtraEmtia(true);
    }, P_PIYASALAR_MODAL_LIVE_MS);
    return () => {
      cancelled = true;
      clearInterval(emtiaPoll);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || tab !== "doviz") return;
    const dHit = piyasalarSessionCacheRef.current.dovizFx;
    if (dHit && cacheFresh(dHit.at, P_TAB_LIST_CACHE_TTL_MS) && dHit.cards.length > 0) {
      setFxCards(dHit.cards);
      return;
    }
    const gen0 = piyasalarSessionGenRef.current;
    void runListDeduped("doviz", async () => {
      const loaded = await loadDovizFxCards(piyasalarSessionCacheRef.current.yahoo?.snap?.dovizTvExtras);
      if (gen0 !== piyasalarSessionGenRef.current) return;
      piyasalarSessionCacheRef.current.dovizFx = { at: Date.now(), cards: loaded };
    }).then(() => {
      if (gen0 !== piyasalarSessionGenRef.current || tabRef.current !== "doviz") return;
      const h = piyasalarSessionCacheRef.current.dovizFx?.cards;
      if (h?.length) setFxCards(h);
    });
  }, [visible, tab, runListDeduped]);

  useEffect(() => {
    if (!visible || tab !== "bist") return;
    const bHit = piyasalarSessionCacheRef.current.bist;
    if (
      bHit &&
      cacheFresh(bHit.at, P_TAB_LIST_CACHE_TTL_MS) &&
      bHit.cards.length >= BIST100_CODES.length - 1
    ) {
      setBistCards(bHit.cards);
      return;
    }
    const gen0 = piyasalarSessionGenRef.current;
    setBistCards(
      BIST100_CODES.map((code) => ({
        title: code,
        value: "—",
        pct: 0,
      })),
    );
    void runListDeduped("bist", async () => {
      const loaded = await loadBistAllCards();
      if (gen0 !== piyasalarSessionGenRef.current) return;
      piyasalarSessionCacheRef.current.bist = { at: Date.now(), cards: loaded };
    }).then(() => {
      if (gen0 !== piyasalarSessionGenRef.current || tabRef.current !== "bist") return;
      const h = piyasalarSessionCacheRef.current.bist?.cards;
      if (h?.length) setBistCards(h);
    });
  }, [visible, tab, runListDeduped]);

  useEffect(() => {
    if (!visible || tab !== "nasdaq") return;
    const nHit = piyasalarSessionCacheRef.current.nasdaq;
    if (
      nHit &&
      cacheFresh(nHit.at, P_TAB_LIST_CACHE_TTL_MS) &&
      nHit.cards.length >= NASDAQ_100_SYMBOLS.length - 1
    ) {
      setNasdaqCards(nHit.cards);
      return;
    }
    const gen0 = piyasalarSessionGenRef.current;
    setNasdaqCards(
      NASDAQ_100_SYMBOLS.map((t) => ({
        title: t,
        value: "—",
        pct: 0,
      })),
    );
    void runListDeduped("nasdaq", async () => {
      const loadedN = await loadNasdaqAllCards();
      if (gen0 !== piyasalarSessionGenRef.current) return;
      piyasalarSessionCacheRef.current.nasdaq = { at: Date.now(), cards: loadedN };
    }).then(() => {
      if (gen0 !== piyasalarSessionGenRef.current || tabRef.current !== "nasdaq") return;
      const h = piyasalarSessionCacheRef.current.nasdaq?.cards;
      if (h?.length) setNasdaqCards(h);
    });
  }, [visible, tab, runListDeduped]);

  useEffect(() => {
    if (!visible || tab !== "koinler") return;
    const kHit = piyasalarSessionCacheRef.current.koinler;
    if (
      kHit &&
      cacheFresh(kHit.at, P_TAB_LIST_CACHE_TTL_MS) &&
      kHit.cards.length >= CRYPTO_CODES.length - 1 &&
      kHit.cards.some((c) => c.value !== "—")
    ) {
      setCryptoCards(kHit.cards);
      return;
    }
    const gen0 = piyasalarSessionGenRef.current;
    setCryptoCards(
      CRYPTO_CODES.map((code) => ({
        title: code,
        value: "—",
        pct: 0,
      })),
    );
    let koinlerLoaded: PiyasalarCardItem[] | null = null;
    void runListDeduped("koinler", async () => {
      const loaded = await loadKoinlerAllCards();
      koinlerLoaded = loaded;
      if (gen0 !== piyasalarSessionGenRef.current) return;
      if (loaded.some((c) => c.value !== "—")) {
        piyasalarSessionCacheRef.current.koinler = { at: Date.now(), cards: loaded };
      }
    }).then(() => {
      if (gen0 !== piyasalarSessionGenRef.current || tabRef.current !== "koinler") return;
      if (koinlerLoaded) setCryptoCards(koinlerLoaded);
    });
  }, [visible, tab, runListDeduped]);

  const cards = useMemo(() => {
    if (tab === "emtialar") {
      const g = yahooSnap?.goldGramTry ?? data.altinTl;
      const s = yahooSnap?.silverGramTry ?? data.gumusTl;
      const og = gramChartTryOverride.gold;
      const os = gramChartTryOverride.silver;
      const gPrice = og?.price ?? g.price;
      const sPrice = os?.price ?? s.price;
      const gPct =
        gPrice > 0
          ? typeof og?.changePct === "number" && Number.isFinite(og.changePct)
            ? og.changePct
            : (g.changePct ?? 0)
          : 0;
      const sPct =
        sPrice > 0
          ? typeof os?.changePct === "number" && Number.isFinite(os.changePct)
            ? os.changePct
            : (s.changePct ?? 0)
          : 0;
      const tvGold = yahooSnap?.emtiaTvChart?.altinTl;
      const tvSilver = yahooSnap?.emtiaTvChart?.gumusTl;
      const o = yahooSnap?.oilUsd ?? data.petrolUsd;
      const tvHintPetrol = yahooSnap?.emtiaTvChart?.petrolUsd;
      const extraByTitle = new Map(extraEmtiaCards.map((item) => [item.title, item]));
      /** Veri gelene kadar yer tutucu; ızgara her zaman 10 kart (diğer sekmelerde arka planda yüklenir). */
      const withEmtiaExtra = (title: string, c?: PiyasalarCardItem): PiyasalarCardItem => {
        const row: PiyasalarCardItem = c ?? { title, value: "—", pct: 0 };
        const a = emtiaActions(row.title, row.value, row.tvChartSymbol);
        return a ? { ...row, actions: a } : row;
      };
      return [
        {
          title: "Altın / TL",
          value: gPrice > 0 ? formatTry(gPrice) : "—",
          pct: gPct,
          actions: emtiaActions("Altın / TL", gPrice > 0 ? formatTry(gPrice) : "—", tvGold),
        },
        withEmtiaExtra("Altın / Ons", extraByTitle.get("Altın / Ons")),
        {
          title: "Gümüş / TL",
          value: sPrice > 0 ? formatTry(sPrice) : "—",
          pct: sPct,
          actions: emtiaActions("Gümüş / TL", sPrice > 0 ? formatTry(sPrice) : "—", tvSilver),
        },
        withEmtiaExtra("Gümüş / Ons", extraByTitle.get("Gümüş / Ons")),
        {
          title: "Petrol / USD",
          value: formatUsd(o.price),
          pct: o.changePct ?? 0,
          actions: emtiaActions("Petrol / USD", formatUsd(o.price), tvHintPetrol),
        },
        withEmtiaExtra("Bakır / USD", extraByTitle.get("Bakır / USD")),
        withEmtiaExtra("Platin / TL", extraByTitle.get("Platin / TL")),
        withEmtiaExtra("Platin / Ons", extraByTitle.get("Platin / Ons")),
        withEmtiaExtra("Paladyum / TL", extraByTitle.get("Paladyum / TL")),
        withEmtiaExtra("Paladyum / Ons", extraByTitle.get("Paladyum / Ons")),
      ];
    }
    if (tab === "nasdaq") {
      const ordered = orderNasdaqCardsForSearch(nasdaqCards, nasdaqSearch);
      return ordered.map((c) => {
        const n = parseDisplayNumber(c.value);
        const sym = c.title;
        return {
          ...c,
          actions: {
            chartSymbol: `NASDAQ:${sym}`,
            prefill: {
              urun: sym,
              urunArama: sym,
              birimFiyat: n == null ? "" : numToBirimInput(n, true),
              quoteCurrency: "USD" as const,
              symbol: sym,
            },
          },
        };
      });
    }
    if (tab === "bist") {
      const q = bistSearch.trim().toUpperCase();
      const filteredBistCards = q ? bistCards.filter((item) => item.title.includes(q)) : bistCards;
      const bix = yahooSnap?.bist100 ?? data.bist100;
      const rows: PiyasalarCardItem[] = [
        {
          title: "BIST 100",
          value: bix.price.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          pct: bix.changePct ?? 0,
        },
        ...filteredBistCards,
      ];
      return rows.map((c) => {
        if (c.title === "BIST 100") {
          const n = parseDisplayNumber(c.value);
          return {
            ...c,
            actions: {
              chartSymbol: null,
              prefill: {
                urun: "BIST 100",
                urunArama: "BIST100.IS",
                birimFiyat: n == null ? "" : numToBirimInput(n, false),
                quoteCurrency: "TRY" as const,
                symbol: "BIST100.IS",
              },
            },
          };
        }
        const n = parseDisplayNumber(c.value);
        const code = c.title;
        return {
          ...c,
          actions: {
            chartSymbol: null,
            prefill: {
              urun: `BIST:${code}`,
              urunArama: `BIST:${code}`,
              birimFiyat: n == null ? "" : numToBirimInput(n, false),
              quoteCurrency: "TRY" as const,
              symbol: `${code}.IS`,
            },
          },
        };
      });
    }
    if (tab === "doviz") {
      const u = yahooSnap?.usdTry ?? data.usdTl;
      const e = yahooSnap?.eurTry ?? data.eurTl;
      const rows: PiyasalarCardItem[] = [
        { title: "🇺🇸 USD / TL", value: formatTry(u.price), pct: u.changePct ?? 0 },
        { title: "🇪🇺 EUR / TL", value: formatTry(e.price), pct: e.changePct ?? 0 },
        ...fxCards,
      ];
      return rows.map((c) => {
        const a = fxActions(c.title, c.value);
        return a ? { ...c, actions: a } : c;
      });
    }
    const q = cryptoSearch.trim().toUpperCase();
    const list = q ? cryptoCards.filter((item) => item.title.includes(q)) : cryptoCards;
    return list.map((c) => {
      const n = parseDisplayNumber(c.value);
      const code = c.title;
      const chart = koinTradingViewSymbol(code);
      return {
        ...c,
        actions: {
          chartSymbol: chart,
          prefill: {
            urun: code,
            urunArama: `${code}USD`,
            birimFiyat: n == null ? "" : numToBirimInput(n, true),
            quoteCurrency: "USD" as const,
            symbol: `${code}-USD`,
          },
        },
      };
    });
  }, [
    tab,
    data,
    yahooSnap,
    extraEmtiaCards,
    bistCards,
    bistSearch,
    nasdaqCards,
    nasdaqSearch,
    cryptoCards,
    cryptoSearch,
    fxCards,
    gramChartTryOverride,
  ]);

  const renderGridItem = useCallback(
    ({ item: c }: ListRenderItemInfo<PiyasalarCardItem>) => {
      const showChart = tab !== "bist" && !!c.actions?.chartSymbol;
      const showAdd = !!c.actions?.prefill;
      return (
        <View style={styles.cardWrapBist}>
          <MarketTileCard
            title={c.title}
            value={c.value}
            subtitle={c.subtitle}
            changeText={formatPct(undefined, c.pct)}
            positive={c.pct >= 0}
            showAdd={showAdd}
            showChart={showChart}
            expandInGrid
            onAdd={() => {
              if (c.actions?.prefill) onOpenYatirimEkle(c.actions.prefill);
            }}
            onChart={() => {
              if (c.actions?.chartSymbol) {
                setChartSymbol(c.actions.chartSymbol);
                setChartOpen(true);
              }
            }}
          />
        </View>
      );
    },
    [tab, onOpenYatirimEkle],
  );

  const gridKeyExtractor = useCallback(
    (item: PiyasalarCardItem, index: number) => `${tab}-${item.title}-${index}`,
    [tab],
  );

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
          <View style={styles.header}>
            <View style={styles.pad} />
            <Text style={styles.title}>Piyasalar</Text>
            <Pressable onPress={onClose} style={styles.pad}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.tabRowSplit}>
            <View style={styles.tabRowTop}>
              {(
                [
                  ["emtialar", "Emtialar"],
                  ["bist", "Borsa İstanbul"],
                ] as const
              ).map(([k, l]) => (
                <Pressable
                  key={k}
                  accessibilityRole="tab"
                  hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                  style={({ pressed }) => [
                    styles.tabBtnHalf,
                    tab === k && styles.tabBtnOn,
                    pressed && styles.tabBtnPressed,
                  ]}
                  onPress={() => startTransition(() => setTab(k as Tab))}
                >
                  <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{l}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.tabRowBottom}>
              {(
                [
                  ["nasdaq", "NASDAQ"],
                  ["doviz", "Döviz"],
                  ["koinler", "Koinler"],
                ] as const
              ).map(([k, l]) => (
                <Pressable
                  key={k}
                  accessibilityRole="tab"
                  hitSlop={{ top: 6, bottom: 6, left: 1, right: 1 }}
                  style={({ pressed }) => [
                    styles.tabBtnQuarter,
                    tab === k && styles.tabBtnOn,
                    pressed && styles.tabBtnPressed,
                  ]}
                  onPress={() => startTransition(() => setTab(k as Tab))}
                >
                  <Text
                    style={[styles.tabTextQuarter, tab === k && styles.tabTextOn]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.65}
                  >
                    {l}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {tab === "emtialar" || tab === "doviz" ? (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.grid}>
                {cards.map((c, idx) => {
                  const showChart = !!c.actions?.chartSymbol;
                  const showAdd = !!c.actions?.prefill;
                  return (
                    <View key={`${tab}-${idx}-${c.title}`} style={styles.cardWrap}>
                      <MarketTileCard
                        title={c.title}
                        value={c.value}
                        subtitle={c.subtitle}
                        changeText={formatPct(undefined, c.pct)}
                        positive={c.pct >= 0}
                        showAdd={showAdd}
                        showChart={showChart}
                        expandInGrid
                        onAdd={() => {
                          if (c.actions?.prefill) onOpenYatirimEkle(c.actions.prefill);
                        }}
                        onChart={() => {
                          if (c.actions?.chartSymbol) {
                            setChartSymbol(c.actions.chartSymbol);
                            setChartOpen(true);
                          }
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.listBody}>
              {tab === "bist" ? (
                <TextInput
                  value={bistSearch}
                  onChangeText={setBistSearch}
                  placeholder="Urun Ara"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.searchInput}
                />
              ) : null}
              {tab === "nasdaq" ? (
                <TextInput
                  value={nasdaqSearch}
                  onChangeText={setNasdaqSearch}
                  placeholder="Urun Ara"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.searchInput}
                />
              ) : null}
              {tab === "koinler" ? (
                <TextInput
                  value={cryptoSearch}
                  onChangeText={setCryptoSearch}
                  placeholder="Urun Ara"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.searchInput}
                />
              ) : null}
              <FlatList
                key={tab}
                ref={listRef}
                data={cards}
                numColumns={3}
                keyExtractor={gridKeyExtractor}
                renderItem={renderGridItem}
                style={styles.listFlex}
                contentContainerStyle={styles.contentFlat}
                columnWrapperStyle={styles.gridRow3}
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews={false}
              />
            </View>
          )}
        </SafeAreaView>
      </Modal>
      <TradingViewChartModal
        visible={chartOpen}
        symbol={chartSymbol}
        onClose={() => setChartOpen(false)}
        onGramChartPriceCommit={({ tvSymbol, priceTry, change, changePct }) => {
          const u = tvSymbol.toUpperCase();
          const slice = { price: priceTry, change, changePct };
          setGramChartTryOverride((prev) => {
            if (u.includes("XAUTRYG")) return { ...prev, gold: slice };
            if (u.includes("XAGTRYG")) return { ...prev, silver: slice };
            return prev;
          });
        }}
      />
    </>
  );
}


