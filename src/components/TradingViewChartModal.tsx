import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { buildGramTlChartHtmlWithSeries } from "../lib/gramTlChartHtml";
import { fetchYahooLineSeriesForGramChart, type YahooLinePoint } from "../lib/yahooFinance";
import { WEBVIEW_DESKTOP_CHROME_UA } from "../lib/webviewChromeUserAgent";
import { useThemeColors } from "../theme/ThemeProvider";
import { createTradingViewChartModalStyles } from "./tradingViewChartModalStyles";

export type GramChartPriceCommitPayload = {
  tvSymbol: string;
  priceTry: number;
  change?: number;
  changePct?: number;
};

function resolveBarIndex(series: YahooLinePoint[], time: string | null, price: number): number {
  if (!series.length) return -1;
  if (time) {
    const byTime = series.findIndex((p) => p.time === time);
    if (byTime >= 0) return byTime;
  }
  let best = series.length - 1;
  let bestD = Infinity;
  for (let i = 0; i < series.length; i++) {
    const d = Math.abs(series[i]!.value - price);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function deltaForBar(series: YahooLinePoint[], barIndex: number): { change?: number; changePct?: number } {
  if (barIndex <= 0 || barIndex >= series.length) return {};
  const prev = series[barIndex - 1]!.value;
  const cur = series[barIndex]!.value;
  if (!(prev > 0) || !Number.isFinite(cur)) return {};
  const change = cur - prev;
  const changePct = (change / prev) * 100;
  return { change, changePct };
}

type Props = {
  visible: boolean;
  symbol: string;
  onClose: () => void;
  /** Gram TL grafikten Geri: imleçteki TRY/gram + seçilen güne göre günlük değişim. */
  onGramChartPriceCommit?: (payload: GramChartPriceCommitPayload) => void;
};

function isGramTvSymbol(sym: string): boolean {
  return /XAUTRYG|XAGTRYG|XPTUSD|XPDUSD/i.test(sym);
}

export function TradingViewChartModal({ visible, symbol, onClose, onGramChartPriceCommit }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(() => createTradingViewChartModalStyles(palette), [palette]);

  const lastCrosshairTryRef = useRef<number | null>(null);
  const lastCrosshairTimeRef = useRef<string | null>(null);
  const [gramSeries, setGramSeries] = useState<YahooLinePoint[] | null>(null);
  const [gramLoadDone, setGramLoadDone] = useState(false);

  /** iframe içinde ikinci kez WebView = TV sık “Something went wrong” (mavi) veriyor; doğrudan URI daha stabil. */
  const chartUri = useMemo(() => {
    const enc = encodeURIComponent(symbol);
    return `https://www.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${enc}&interval=D&symboledit=0&saveimage=0&toolbarbg=1e2675&studies=%5B%5D&theme=dark&style=1&timezone=Europe%2FIstanbul&withdateranges=1&hideideas=1&locale=en`;
  }, [symbol]);

  const gramHtml = useMemo(() => {
    if (!gramSeries?.length) return null;
    return buildGramTlChartHtmlWithSeries(symbol, JSON.stringify(gramSeries));
  }, [symbol, gramSeries]);

  const [webMountId, setWebMountId] = useState(0);
  const bumpWebView = () => setWebMountId((n) => n + 1);

  useEffect(() => {
    if (!visible || !isGramTvSymbol(symbol)) {
      setGramSeries(null);
      setGramLoadDone(false);
      return;
    }
    let cancelled = false;
    setGramSeries(null);
    setGramLoadDone(false);
    void (async () => {
      const rows = await fetchYahooLineSeriesForGramChart(symbol);
      if (cancelled) return;
      if (rows?.length) setGramSeries(rows);
      setGramLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, symbol]);

  useEffect(() => {
    if (visible) bumpWebView();
  }, [visible, symbol]);

  useEffect(() => {
    if (visible) {
      lastCrosshairTryRef.current = null;
      lastCrosshairTimeRef.current = null;
    }
  }, [visible, symbol]);

  useEffect(() => {
    if (!gramSeries?.length) return;
    const last = gramSeries[gramSeries.length - 1]!;
    if (typeof last.value === "number" && Number.isFinite(last.value) && last.value > 0) {
      lastCrosshairTryRef.current = last.value;
      lastCrosshairTimeRef.current = last.time ?? null;
    }
  }, [gramSeries]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && visible) bumpWebView();
    });
    return () => sub.remove();
  }, [visible]);

  const closeModal = useCallback(() => {
    if (isGramTvSymbol(symbol) && gramSeries?.length && onGramChartPriceCommit) {
      const p = lastCrosshairTryRef.current;
      if (typeof p === "number" && Number.isFinite(p) && p > 0) {
        const idx = resolveBarIndex(gramSeries, lastCrosshairTimeRef.current, p);
        const { change, changePct } = idx >= 0 ? deltaForBar(gramSeries, idx) : {};
        onGramChartPriceCommit({ tvSymbol: symbol, priceTry: p, change, changePct });
      }
    }
    onClose();
  }, [symbol, gramSeries, onClose, onGramChartPriceCommit]);

  const useGramWebView = isGramTvSymbol(symbol) && !!gramHtml;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={closeModal}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={closeModal} style={styles.backBtn}>
            <Text style={styles.backText}>← Geri</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {symbol}
          </Text>
          <View style={styles.headerRight}>
            <Pressable onPress={bumpWebView} style={styles.refreshBtn} hitSlop={8}>
              <Text style={styles.browserBtnText}>Yenile</Text>
            </Pressable>
            <Pressable onPress={() => void Linking.openURL(chartUri)} style={styles.browserBtn} hitSlop={8}>
              <Text style={styles.browserBtnText}>Tarayıcı</Text>
            </Pressable>
          </View>
        </View>
        {isGramTvSymbol(symbol) && !gramLoadDone ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.fallbackText}>Grafik verisi yükleniyor…</Text>
          </View>
        ) : (
          <View style={styles.webWrap}>
            {isGramTvSymbol(symbol) && gramLoadDone && !gramHtml ? (
              <View style={styles.fallbackWrap}>
                <Text style={styles.fallbackText}>
                  Günlük seri açılamadı; aşağıda TradingView. Kart fiyatı için ana ekranı yenileyin.
                </Text>
              </View>
            ) : null}
            <WebView
              key={`tv-${symbol}-${useGramWebView ? "gram" : "embed"}-${webMountId}`}
              source={
                useGramWebView
                  ? { html: gramHtml!, baseUrl: "https://unpkg.com/" }
                  : { uri: chartUri }
              }
              style={styles.web}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled={Platform.OS === "android"}
              mixedContentMode="always"
              userAgent={WEBVIEW_DESKTOP_CHROME_UA}
              setSupportMultipleWindows={false}
              textZoom={100}
              onMessage={(e) => {
                try {
                  const j = JSON.parse(String(e.nativeEvent.data || "{}")) as {
                    source?: string;
                    event?: string;
                    price?: unknown;
                    time?: unknown;
                  };
                  if (j.source !== "gramTlTv" || j.event !== "crosshair") return;
                  const n = typeof j.price === "number" ? j.price : Number(j.price);
                  if (Number.isFinite(n) && n > 0) lastCrosshairTryRef.current = n;
                  if (j.time != null && String(j.time) !== "") lastCrosshairTimeRef.current = String(j.time);
                } catch {
                  /* ignore */
                }
              }}
              cacheMode={Platform.OS === "android" ? "LOAD_NO_CACHE" : undefined}
              cacheEnabled={Platform.OS === "android" ? undefined : false}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}


