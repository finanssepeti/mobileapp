import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAppTheme } from "../theme/ThemeProvider";
import { createAnalizlerScreenStyles } from "./analizlerScreenStyles";
import { t } from "../lib/i18n";
import {
  fetchTradingViewSignal,
  searchTradingViewSymbols,
  tryResolveBinanceUsdtPair,
  normalizeTickerInput,
  type TvSymbolSearchItem,
  type TvTimeframe } from "../lib/analizService";

type Props = NativeStackScreenProps<RootStackParamList, "Analizler">;

const ALARM_KEY = "@finansepeti/analiz-alarms";
const TELEGRAM_KEY = "@finansepeti/telegram-link";
const TIMEFRAMES = ["1 dk", "1 saat", "2 saat", "4 saat", "1 gün", "1 hafta", "1 ay"] as const;

type AlarmItem = {
  id: string;
  inputSymbol: string;
  symbol: string; // Görünür ad
  ticker: string; // TV full ticker (BIST:XU100)
  market: string; // TV scanner market
  target: string;
  timeframe: string;
  direction: "up" | "down";
  active: boolean;
  lastSeenPrice?: number;
  triggeredAt?: number;
};

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Marker = { time: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowDown" | "arrowUp"; text: "SAT" | "AL" };

/** Web `teknik-sinyal.js` ile aynı dosya; `npm run sync-teknik-engine` ile senkron. */
type TeknikEngineMod = {
  analyze: (
    candles: Candle[],
    opts: { symbol?: string; interval?: string },
  ) => { signals?: Array<{ time: number; side: string }>; lastSignal?: unknown; summary?: string };
};
let finansTeknikSinyalEngine: TeknikEngineMod;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  finansTeknikSinyalEngine = require("../lib/teknikSinyalEngine.js");
} catch {
  finansTeknikSinyalEngine = {
    analyze: () => ({ signals: [], lastSignal: null, summary: "Teknik motor yüklenemedi" }),
  };
}

type BackendSignal = {
  signal: "AL" | "SAT";
  /** API `score` (0…scoreScale), web `teknik-analiz.js` ile aynı kaynak */
  score: number;
  scoreScale: number;
  close?: number | null;
} | null;
type TelegramLinkState = { code: string; chatId: string; linked: boolean };
type SectionTab = "signal" | "telegram" | "alarm";

const ROBOT_SIGNAL_ENDPOINT = "https://us-central1-finans-sepeti.cloudfunctions.net/getRobotSignal";
const MOBILE_TELEGRAM_LINK_ENDPOINT = "https://us-central1-finans-sepeti.cloudfunctions.net/mobileTelegramLink";
const MOBILE_TELEGRAM_NOTIFY_ENDPOINT = "https://us-central1-finans-sepeti.cloudfunctions.net/mobileTelegramNotify";

/** Web `teknik-analiz.js` → `teknikNormalizeRobotSymbol` ile aynı (getRobotSymbol isteği). */
function normalizeRobotSymbolForBackend(symbol: string): string {
  let s = String(symbol || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");
  if (!s) return "BINANCE:BTCUSDT";
  if (s === "BTCUSD") return "BINANCE:BTCUSDT";
  if (s === "ETHUSD" || s === "ETHERIUMUSD" || s === "ETHEREUMUSD") return "BINANCE:ETHUSDT";
  if (s === "SOLUSD" || s === "SOLANOUSD") return "BINANCE:SOLUSDT";
  if (/^[A-Z0-9]{2,12}USD$/i.test(s)) s = `BINANCE:${s.replace(/USD$/i, "USDT")}`;
  if (/^[A-Z0-9]{2,12}USDT$/i.test(s)) s = `BINANCE:${s}`;
  if (s.startsWith("BINANCE:")) {
    let pair = s.split(":")[1] || "";
    pair = pair.replace(/(USDT)+$/g, "USDT");
    if (pair && !pair.includes("USDT")) pair += "USDT";
    s = `BINANCE:${pair}`;
  }
  return s;
}

export function AnalizlerScreen({ navigation }: Props) {
  const { palette, lang } = useAppTheme();
  const styles = useMemo(() => createAnalizlerScreenStyles(palette), [palette]);
  /** Arka arkaya arama isteklerinde eski yanıtın sembolü ezmesini önler */
  const symbolSearchSeqRef = useRef(0);

  const [activeTf, setActiveTf] = useState<(typeof TIMEFRAMES)[number]>("1 saat");
  const [activeSymbol, setActiveSymbol] = useState<TvSymbolSearchItem>({
    symbol: "BTCUSDT",
    exchange: "BINANCE",
    type: "crypto",
    description: "Bitcoin / TetherUS",
    full: "BINANCE:BTCUSDT",
    market: "crypto",
  });
  const [query, setQuery] = useState("BTCUSDT");
  const [searchResults, setSearchResults] = useState<TvSymbolSearchItem[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [signalText, setSignalText] = useState(t(lang, "signal_waiting"));
  const [signalColor, setSignalColor] = useState<string>(palette.textMuted);
  /** Üst satır: web ile aynı teknik motor skoru (ham değer). */
  const [robotSkor, setRobotSkor] = useState(0);
  const [chartError, setChartError] = useState("");
  const [chartDataSource, setChartDataSource] = useState("bekleniyor");
  const [alarmSymbolInput, setAlarmSymbolInput] = useState("BTCUSD");
  const [alarmPrice, setAlarmPrice] = useState("");
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [lastPriceText, setLastPriceText] = useState("-");
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartMarkers, setChartMarkers] = useState<Marker[]>([]);
  const [scoreNote, setScoreNote] = useState(t(lang, "score_waiting"));
  /** Web `drawTeknikCryptoLwcChart`: önce motor özeti, sonra robot varsa üzerine yazılır. */
  const [engineSummary, setEngineSummary] = useState<{ label: "AL" | "SAT"; score: number } | null>(null);
  const [backendSummary, setBackendSummary] = useState<Exclude<BackendSignal, null> | null>(null);
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState("Telegram baglantisi bekleniyor.");
  const lastSignalNotifyRef = useRef("");
  const [activeTab, setActiveTab] = useState<SectionTab>("signal");

  const tfToBackendInterval = (tf: (typeof TIMEFRAMES)[number]) => {
    switch (tf) {
      case "1 dk":
        return "1m";
      case "1 saat":
        return "1h";
      case "2 saat":
        return "2h";
      case "4 saat":
        return "4h";
      case "1 hafta":
        return "1w";
      case "1 ay":
        return "1mo";
      default:
        return "1d";
    }
  };

  /** Web `teknikIntervalToBackend` / TradingView widget ile aynı kodlar (`teknik-sinyal.js` profilleri). */
  const tfToTeknikEngineInterval = (tf: (typeof TIMEFRAMES)[number]): string => {
    switch (tf) {
      case "1 dk":
        return "1";
      case "1 saat":
        return "60";
      case "2 saat":
        return "120";
      case "4 saat":
        return "240";
      case "1 hafta":
        return "W";
      case "1 ay":
        return "M";
      default:
        return "D";
    }
  };

  const fetchBackendSignal = async (): Promise<BackendSignal> => {
    try {
      const interval = tfToBackendInterval(activeTf);
      const symbol = normalizeRobotSymbolForBackend(activeSymbol.full);
      const url = `${ROBOT_SIGNAL_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = (await r.json()) as {
        ok?: boolean;
        signal?: string;
        score?: number;
        scoreScale?: number;
        close?: number | null;
      };
      if (!j?.ok) return null;
      const rawSig = String(j.signal || "")
        .trim()
        .toUpperCase();
      const sig = rawSig === "AL" ? "AL" : rawSig === "SAT" ? "SAT" : null;
      const sc = Number(j.score);
      if (!sig || !Number.isFinite(sc)) return null;
      const scale = Number(j.scoreScale);
      const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 14;
      return {
        signal: sig,
        score: Math.max(0, sc),
        scoreScale: safeScale,
        close: typeof j.close === "number" ? j.close : null,
      };
    } catch {
      return null;
    }
  };

  /** Web `fetchBackendRobotSignal` + panel: robot gelince üst satır buna geçer. */
  const applyBackendSignalIfAny = async () => {
    const data = await fetchBackendSignal();
    setBackendSummary(data);
    if (data && typeof data.close === "number") {
      setLastPriceText(data.close.toLocaleString("tr-TR", { maximumFractionDigits: 4 }));
    }
    return data;
  };

  const persistTelegramState = async (next: TelegramLinkState) => {
    setTelegramCode(next.code);
    setTelegramChatId(next.chatId);
    setTelegramLinked(next.linked);
    await AsyncStorage.setItem(TELEGRAM_KEY, JSON.stringify(next));
  };

  const ensureTelegramLinkCode = async () => {
    if (telegramCode.trim()) return telegramCode.trim();
    const r = await fetch(`${MOBILE_TELEGRAM_LINK_ENDPOINT}?mode=create`);
    if (!r.ok) throw new Error("telegram_link_create_failed");
    const j = (await r.json()) as { ok?: boolean; code?: string };
    if (!j?.ok || !j.code) throw new Error("telegram_link_create_failed");
    await persistTelegramState({ code: j.code, chatId: "", linked: false });
    return j.code;
  };

  const pollTelegramLinkStatus = async () => {
    const code = telegramCode.trim();
    if (!code) return;
    const r = await fetch(`${MOBILE_TELEGRAM_LINK_ENDPOINT}?mode=status&code=${encodeURIComponent(code)}`);
    if (!r.ok) return;
    const j = (await r.json()) as { ok?: boolean; linked?: boolean; chatId?: string };
    if (!j?.ok) return;
    const linked = !!j.linked;
    const chat = String(j.chatId || "");
    if (linked) {
      await persistTelegramState({ code, chatId: chat, linked: true });
      setTelegramStatus("Telegram baglandi. Robot ve alarm bildirimleri aktif.");
    }
  };

  const pushTelegramNotify = async (payload: {
    kind: "signal" | "alarm";
    symbol: string;
    interval?: string;
    signal?: "AL" | "SAT";
    score?: number;
    price?: number;
    targetPrice?: number;
    eventTime?: number;
    dedupeKey: string;
  }) => {
    const code = telegramCode.trim();
    if (!telegramLinked || !code) return;
    try {
      await fetch(MOBILE_TELEGRAM_NOTIFY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...payload,
        }),
      });
    } catch {}
  };

  const fetchAlarmLivePrice = async (alarm: AlarmItem): Promise<number | null> => {
    try {
      if (alarm.ticker.startsWith("BINANCE:")) {
        const pair = alarm.ticker.split(":")[1] || "";
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`);
        if (!r.ok) return null;
        const j = (await r.json()) as { price?: string };
        const p = Number(j?.price);
        return Number.isFinite(p) ? p : null;
      }
      const iv = tfToBackendInterval((alarm.timeframe as (typeof TIMEFRAMES)[number]) ?? "1 saat");
      const r = await fetch(
        `${ROBOT_SIGNAL_ENDPOINT}?symbol=${encodeURIComponent(normalizeRobotSymbolForBackend(alarm.ticker))}&interval=${encodeURIComponent(iv)}`,
      );
      if (!r.ok) return null;
      const j = (await r.json()) as { ok?: boolean; close?: number };
      if (!j?.ok || typeof j.close !== "number") return null;
      return j.close;
    } catch {
      return null;
    }
  };

  const runSymbolSearch = async () => {
    const seq = ++symbolSearchSeqRef.current;
    const q = query.trim();
    if (q.length < 2) return;
    const uAscii = normalizeTickerInput(q);

    const directMap: Record<string, TvSymbolSearchItem> = {
      BTCUSD: {
        symbol: "BTCUSDT",
        exchange: "BINANCE",
        type: "crypto",
        description: "Bitcoin / TetherUS",
        full: "BINANCE:BTCUSDT",
        market: "crypto",
      },
      ETHUSD: {
        symbol: "ETHUSDT",
        exchange: "BINANCE",
        type: "crypto",
        description: "Ethereum / TetherUS",
        full: "BINANCE:ETHUSDT",
        market: "crypto",
      },
      SOLUSD: {
        symbol: "SOLUSDT",
        exchange: "BINANCE",
        type: "crypto",
        description: "Solana / TetherUS",
        full: "BINANCE:SOLUSDT",
        market: "crypto",
      },
      METISUSD: {
        symbol: "METISUSDT",
        exchange: "BINANCE",
        type: "crypto",
        description: "Metis / TetherUS",
        full: "BINANCE:METISUSDT",
        market: "crypto",
      },
      XAUUSD: {
        symbol: "XAUUSD",
        exchange: "OANDA",
        type: "forex",
        description: "Gold Spot / US Dollar",
        full: "OANDA:XAUUSD",
        market: "forex",
      },
      "THYAO.IS": {
        symbol: "THYAO",
        exchange: "BIST",
        type: "stock",
        description: "Turk Hava Yollari",
        full: "BIST:THYAO",
        market: "turkey",
      },
      THYAO: {
        symbol: "THYAO",
        exchange: "BIST",
        type: "stock",
        description: "Turk Hava Yollari",
        full: "BIST:THYAO",
        market: "turkey",
      },
    };
    const directHit = directMap[uAscii];
    if (directHit) {
      if (seq !== symbolSearchSeqRef.current) return;
      setActiveSymbol(directHit);
      setQuery(directHit.symbol);
      setSearchResults([directHit]);
      return;
    }

    setSearchBusy(true);
    let rows = await searchTradingViewSymbols(uAscii);
    if (seq !== symbolSearchSeqRef.current) return;
    if (!rows.length && q !== uAscii) {
      rows = await searchTradingViewSymbols(q);
      if (seq !== symbolSearchSeqRef.current) return;
    }
    if (!rows.length) {
      const bin = await tryResolveBinanceUsdtPair(uAscii);
      if (seq !== symbolSearchSeqRef.current) return;
      if (bin) {
        setSearchResults([bin]);
        setActiveSymbol(bin);
        setQuery(bin.symbol);
        setSearchBusy(false);
        return;
      }
    }
    setSearchResults(rows);
    setSearchBusy(false);
    if (seq !== symbolSearchSeqRef.current) return;

    if (!rows.length) {
      if (/^[A-Z]{3,5}\.IS$/i.test(q.trim())) {
        const sym = q.trim().replace(/\.IS$/i, "").toUpperCase();
        const bistYahoo: TvSymbolSearchItem = {
          symbol: sym,
          exchange: "BIST",
          type: "stock",
          description: `BIST ${sym}`,
          full: `BIST:${sym}`,
          market: "turkey",
        };
        setActiveSymbol(bistYahoo);
        setQuery(bistYahoo.symbol);
        setSearchResults([bistYahoo]);
      }
      return;
    }
    const exact =
      rows.find((r) => r.symbol.toUpperCase() === uAscii || `${r.exchange}:${r.symbol}`.toUpperCase() === uAscii) ??
      rows[0];
    setActiveSymbol(exact);
    setQuery(exact.symbol);
  };

  const tvTf = useMemo<TvTimeframe>(() => {
    switch (activeTf) {
      case "1 dk":
        return "1m";
      case "1 saat":
        return "1h";
      case "2 saat":
        return "2h";
      case "4 saat":
        return "4h";
      case "1 hafta":
        return "1W";
      case "1 ay":
        return "1M";
      default:
        return "1d";
    }
  }, [activeTf]);

  const chartHtml = useMemo(() => {
    const candles = JSON.stringify(chartCandles);
    const markers = JSON.stringify(chartMarkers);
    const sourceLabel = chartDataSource;
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#000000; }
      #chartWrap { width:100%; height:100%; position:relative; }
      #chart { width:100%; height:100%; display:block; touch-action:none; }
      #empty {
        position:absolute; inset:0; display:none; align-items:center; justify-content:center;
        color:#bfdbfe; font-family:Arial,sans-serif; font-size:14px; text-align:center; padding:16px;
      }
      #meta {
        position:absolute; left:8px; bottom:6px; color:#93c5fd; font-size:11px; font-family:Arial,sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="chartWrap">
      <canvas id="chart"></canvas>
      <div id="empty">Grafik verisi bekleniyor...</div>
      <div id="meta">Kaynak: ${sourceLabel}</div>
    </div>
    <script>
      function run() {
        var candles = ${candles};
        var markers = ${markers};
        if (!Array.isArray(candles) || candles.length < 2) {
          var empty = document.getElementById("empty");
          if (empty) empty.style.display = "flex";
          return;
        }
        var wrap = document.getElementById("chartWrap");
        var canvas = document.getElementById("chart");
        if (!wrap || !canvas) return;
        var ctx = canvas.getContext("2d");
        if (!ctx) return;

        var width = wrap.clientWidth || 300;
        var height = wrap.clientHeight || 420;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        if (!window.__chartState) {
          window.__chartState = {
            viewCount: Math.min(candles.length, 180),
            endOffset: 0,
            pinchStartDist: null,
            pinchStartViewCount: null,
            panStartX: null,
            panStartOffset: 0
          };
        }
        var state = window.__chartState;
        state.viewCount = Math.max(24, Math.min(candles.length, state.viewCount || 180));
        state.endOffset = Math.max(0, Math.min(Math.max(0, candles.length - state.viewCount), state.endOffset || 0));

        var endIndex = candles.length - state.endOffset;
        var startIndex = Math.max(0, endIndex - state.viewCount);
        var vis = candles.slice(startIndex, endIndex);
        if (!Array.isArray(vis) || vis.length < 2) return;

        var left = 8, right = 96, top = 12, bottom = 20;
        var w = width - left - right, h = height - top - bottom;
        if (w < 40 || h < 40) return;

        var highs = vis.map(function(c){ return Number(c.high); });
        var lows = vis.map(function(c){ return Number(c.low); });
        var max = Math.max.apply(null, highs);
        var min = Math.min.apply(null, lows);
        var pad = Math.max((max - min) * 0.06, 1e-6);
        max += pad; min -= pad;
        var range = Math.max(max - min, 1e-6);
        var y = function(p){ return top + ((max - p) / range) * h; };
        var x = function(i){ return left + (i / Math.max(vis.length - 1, 1)) * w; };

        ctx.strokeStyle = "rgba(148,163,184,0.18)";
        ctx.lineWidth = 1;
        for (var gy = 0; gy <= 6; gy++) {
          var yy = top + (gy / 6) * h;
          ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(left + w, yy); ctx.stroke();
        }
        for (var gx = 0; gx <= 4; gx++) {
          var xx = left + (gx / 4) * w;
          ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, top + h); ctx.stroke();
        }

        ctx.font = "11px Arial";
        ctx.textAlign = "right";
        ctx.fillStyle = "#93c5fd";
        for (var py = 0; py <= 6; py++) {
          var yLine = top + (py / 6) * h;
          var priceVal = max - (py / 6) * (max - min);
          var dec = priceVal >= 1000 ? 0 : priceVal >= 1 ? 2 : 4;
          var label = priceVal.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
          ctx.fillText(label, width - 6, yLine + 4);
        }

        var step = w / Math.max(vis.length, 1);
        var bodyW = Math.max(2, Math.min(8, step * 0.66));
        for (var i = 0; i < vis.length; i++) {
          var c = vis[i];
          var o = Number(c.open), hi = Number(c.high), lo = Number(c.low), cl = Number(c.close);
          var color = cl >= o ? "#22c55e" : "#ef4444";
          var xx = x(i), yo = y(o), yh = y(hi), yl = y(lo), yc = y(cl);
          ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(xx, yh); ctx.lineTo(xx, yl); ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillRect(xx - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(Math.abs(yc - yo), 1));
        }

        var markerMap = {};
        for (var m = 0; m < markers.length; m++) markerMap[String(markers[m].time)] = markers[m];
        ctx.textAlign = "center";
        for (var k = 0; k < vis.length; k++) {
          var mk = markerMap[String(vis[k].time)];
          if (!mk) continue;
          var mx = x(k);
          var my = mk.position === "aboveBar" ? y(vis[k].high) - 18 : y(vis[k].low) + 18;
          ctx.fillStyle = mk.text === "SAT" ? "#ef4444" : "#22c55e";
          ctx.font = "bold 26px Arial";
          ctx.fillText(mk.text === "SAT" ? "↓" : "↑", mx, my);
          ctx.font = "bold 13px Arial";
          ctx.fillText(mk.text || "", mx, mk.position === "aboveBar" ? my - 11 : my + 14);
        }

        ctx.textAlign = "left";
        ctx.fillStyle = "#93c5fd";
        ctx.font = "11px Arial";
        ctx.fillText("Zoom: " + vis.length + " mum", 10, 14);
      }
      function touchDistance(a, b) {
        var dx = a.clientX - b.clientX;
        var dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }
      function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

      var canvasEl = document.getElementById("chart");
      if (canvasEl && !canvasEl.__fsBound) {
        canvasEl.__fsBound = true;
        canvasEl.addEventListener("touchstart", function(e) {
          var s = window.__chartState || {};
          if (e.touches.length === 2) {
            s.pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
            s.pinchStartViewCount = s.viewCount || 180;
          } else if (e.touches.length === 1) {
            s.panStartX = e.touches[0].clientX;
            s.panStartOffset = s.endOffset || 0;
          }
          window.__chartState = s;
        }, { passive: true });

        canvasEl.addEventListener("touchmove", function(e) {
          var s = window.__chartState || {};
          var candlesLen = ${candles}.length;
          if (e.touches.length === 2 && s.pinchStartDist) {
            e.preventDefault();
            var d = touchDistance(e.touches[0], e.touches[1]);
            var scale = d / Math.max(1, s.pinchStartDist);
            var nextCount = Math.round((s.pinchStartViewCount || 180) / scale);
            s.viewCount = clamp(nextCount, 24, Math.max(24, candlesLen));
            s.endOffset = clamp(s.endOffset || 0, 0, Math.max(0, candlesLen - s.viewCount));
            window.__chartState = s;
            run();
            return;
          }
          if (e.touches.length === 1 && typeof s.panStartX === "number") {
            e.preventDefault();
            var dx = e.touches[0].clientX - s.panStartX;
            var barsPerPx = (s.viewCount || 180) / Math.max(1, (canvasEl.clientWidth || 320));
            var shift = Math.round(-dx * barsPerPx);
            s.endOffset = clamp((s.panStartOffset || 0) + shift, 0, Math.max(0, candlesLen - (s.viewCount || 180)));
            window.__chartState = s;
            run();
          }
        }, { passive: false });

        canvasEl.addEventListener("touchend", function() {
          var s = window.__chartState || {};
          s.pinchStartDist = null;
          s.pinchStartViewCount = null;
          s.panStartX = null;
          s.panStartOffset = s.endOffset || 0;
          window.__chartState = s;
        }, { passive: true });
      }
      run();
      window.addEventListener("resize", run);
    </script>
  </body>
</html>`;
  }, [chartCandles, chartMarkers, chartDataSource]);

  const chartSource = useMemo(() => ({ html: chartHtml }), [chartHtml]);

  const toBinanceInterval = (tf: (typeof TIMEFRAMES)[number]) => {
    switch (tf) {
      case "1 dk":
        return "1m";
      case "1 saat":
        return "1h";
      case "2 saat":
        return "2h";
      case "4 saat":
        return "4h";
      case "1 hafta":
        return "1w";
      case "1 ay":
        return "1M";
      default:
        return "1d";
    }
  };

  const toBinanceSymbol = (s: TvSymbolSearchItem) => {
    const x = s.symbol.toUpperCase();
    if (x.endsWith("USDT")) return x;
    if (x === "BTCUSD") return "BTCUSDT";
    if (x === "ETHUSD") return "ETHUSDT";
    if (x === "BNBUSD") return "BNBUSDT";
    return x;
  };

  const toCoinGeckoId = (s: TvSymbolSearchItem) => {
    const x = s.symbol.toUpperCase();
    if (x.startsWith("BTC")) return "bitcoin";
    if (x.startsWith("ETH")) return "ethereum";
    if (x.startsWith("BNB")) return "binancecoin";
    if (x.startsWith("SOL")) return "solana";
    if (x.startsWith("XRP")) return "ripple";
    return "";
  };

  const toYahooCryptoSymbol = (s: TvSymbolSearchItem) => {
    const x = s.symbol.toUpperCase();
    if (x.includes("BTC")) return "BTC-USD";
    if (x.includes("ETH")) return "ETH-USD";
    if (x.includes("BNB")) return "BNB-USD";
    if (x.includes("SOL")) return "SOL-USD";
    if (x.includes("XRP")) return "XRP-USD";
    return "";
  };

  const toYahooSymbol = (s: TvSymbolSearchItem) => {
    if (s.exchange?.toUpperCase() === "BIST" || s.full?.toUpperCase().startsWith("BIST:")) {
      return `${s.symbol.toUpperCase()}.IS`;
    }
    return "";
  };

  const toYahooParams = (tf: (typeof TIMEFRAMES)[number]) => {
    switch (tf) {
      case "1 dk":
        return { interval: "1m", range: "5d" };
      case "1 saat":
        return { interval: "60m", range: "1mo" };
      case "2 saat":
        return { interval: "60m", range: "3mo" };
      case "4 saat":
        return { interval: "60m", range: "6mo" };
      case "1 hafta":
        return { interval: "1wk", range: "5y" };
      case "1 ay":
        return { interval: "1mo", range: "10y" };
      default:
        return { interval: "1d", range: "2y" };
    }
  };

  const engineSignalsToMarkers = (signals: Array<{ time: number; side: string }>): Marker[] =>
    signals
      .filter((s) => s && (s.side === "buy" || s.side === "sell"))
      .slice(-1200)
      .map((s) => ({
        time: s.time,
        position: s.side === "sell" ? "aboveBar" : "belowBar",
        color: s.side === "sell" ? "#ef4444" : "#22c55e",
        shape: s.side === "sell" ? "arrowDown" : "arrowUp",
        text: (s.side === "sell" ? "SAT" : "AL") as "SAT" | "AL",
      }));

  useEffect(() => {
    if (!chartCandles.length || chartCandles.length < 80) {
      setChartMarkers([]);
      setEngineSummary(null);
      return;
    }
    try {
      const iv = tfToTeknikEngineInterval(activeTf);
      const forEngine = chartCandles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
      const result = finansTeknikSinyalEngine.analyze(forEngine, {
        symbol: activeSymbol.full,
        interval: iv,
      });
      setChartMarkers(engineSignalsToMarkers(result.signals || []));
      const ls = result.lastSignal as { label?: string; score?: number } | null | undefined;
      const lab = ls?.label === "AL" || ls?.label === "SAT" ? ls.label : null;
      const sc = Number(ls?.score);
      if (lab && Number.isFinite(sc)) setEngineSummary({ label: lab, score: Math.round(sc) });
      else setEngineSummary(null);
    } catch {
      setChartMarkers([]);
      setEngineSummary(null);
    }
  }, [chartCandles, activeTf, activeSymbol.full]);

  /**
   * Web `drawTeknikCryptoLwcChart` ile aynı: üst satırı teknik motor (oklar) belirler.
   * Backend robot satırı sadece referans olarak notta gösterilir.
   */
  useEffect(() => {
    if (engineSummary) {
      setSignalText(engineSummary.label);
      setRobotSkor(engineSummary.score);
      setSignalColor(engineSummary.label === "AL" ? palette.success : palette.error);
      if (backendSummary) {
        const raw = Math.round(backendSummary.score);
        setScoreNote(
          `Grafik motoru (web ile aynı): ${engineSummary.label} · ${engineSummary.score} | Backend robot: ${backendSummary.signal} · ${raw}/${backendSummary.scoreScale}`,
        );
      } else {
        setScoreNote("Grafik motoru (web ile aynı): sinyal ve skor doğrudan teknik motor kurallarından üretiliyor.");
      }
      return;
    }
    if (backendSummary) {
      const raw = Math.round(backendSummary.score);
      setSignalText(backendSummary.signal);
      setRobotSkor(raw);
      setSignalColor(backendSummary.signal === "AL" ? palette.success : palette.error);
      setScoreNote(`Backend robot: ${backendSummary.signal} · ${raw}/${backendSummary.scoreScale}`);
      return;
    }
    setSignalText(t(lang, "signal_waiting"));
    setRobotSkor(0);
    setSignalColor(palette.textMuted);
    setScoreNote(t(lang, "score_no_data"));
  }, [backendSummary, engineSummary, lang]);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(ALARM_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as AlarmItem[];
        if (Array.isArray(parsed)) setAlarms(parsed);
      } catch {}
      try {
        const rawTg = await AsyncStorage.getItem(TELEGRAM_KEY);
        if (!rawTg) return;
        const tg = JSON.parse(rawTg) as TelegramLinkState;
        if (tg?.code) {
          setTelegramCode(String(tg.code || ""));
          setTelegramChatId(String(tg.chatId || ""));
          setTelegramLinked(!!tg.linked);
          if (tg.linked) setTelegramStatus("Telegram baglandi. Robot ve alarm bildirimleri aktif.");
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setChartError("");
        const fullU = activeSymbol.full.toUpperCase();
        const preferBinanceKlines =
          activeSymbol.market === "crypto" ||
          fullU.startsWith("BINANCE:") ||
          fullU.startsWith("BITSTAMP:") ||
          fullU.startsWith("COINBASE:");
        if (preferBinanceKlines) {
          const symbol = toBinanceSymbol(activeSymbol);
          const interval = toBinanceInterval(activeTf);
          const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=600`;
          const r = await fetch(url);
          if (r.ok) {
            const arr = (await r.json()) as Array<[number, string, string, string, string, string]>;
            if (Array.isArray(arr) && arr.length) {
              const candles: Candle[] = arr.map((k) => ({
                time: Math.floor(k[0] / 1000),
                open: Number(k[1]),
                high: Number(k[2]),
                low: Number(k[3]),
                close: Number(k[4]),
                volume: Number(k[5]) || 0,
              }));
              if (candles.length) {
                setChartCandles(candles);
                setChartDataSource(`binance:${symbol}`);
                return;
              }
            }
          }
        }

        const yahooSymbol = toYahooSymbol(activeSymbol);
        if (yahooSymbol) {
          const yi = toYahooParams(activeTf);
          const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(yi.interval)}&range=${encodeURIComponent(yi.range)}`;
          const yr = await fetch(yUrl);
          if (yr.ok) {
            const yj = (await yr.json()) as {
              chart?: {
                result?: Array<{
                  timestamp?: number[];
                  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
                }>;
              };
            };
            const result = yj?.chart?.result?.[0];
            const ts = result?.timestamp ?? [];
            const q0 = result?.indicators?.quote?.[0];
            const opens = q0?.open ?? [];
            const highs = q0?.high ?? [];
            const lows = q0?.low ?? [];
            const closes = q0?.close ?? [];
            const yc: Candle[] = [];
            for (let i = 0; i < ts.length; i += 1) {
              const o = Number(opens[i]);
              const h = Number(highs[i]);
              const l = Number(lows[i]);
              const c = Number(closes[i]);
              if (![o, h, l, c].every((n) => Number.isFinite(n))) continue;
              yc.push({ time: Number(ts[i]), open: o, high: h, low: l, close: c, volume: 0 });
            }
            if (yc.length) {
              setChartCandles(yc);
              setChartDataSource(`yahoo:${yahooSymbol}`);
              return;
            }
          }
        }

        if (!preferBinanceKlines) {
          const symbol = toBinanceSymbol(activeSymbol);
          const interval = toBinanceInterval(activeTf);
          const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=600`;
          const r = await fetch(url);
          if (r.ok) {
            const arr = (await r.json()) as Array<[number, string, string, string, string, string]>;
            if (Array.isArray(arr) && arr.length) {
              const candles: Candle[] = arr.map((k) => ({
                time: Math.floor(k[0] / 1000),
                open: Number(k[1]),
                high: Number(k[2]),
                low: Number(k[3]),
                close: Number(k[4]),
                volume: Number(k[5]) || 0,
              }));
              if (candles.length) {
                setChartCandles(candles);
                setChartDataSource(`binance:${symbol}`);
                return;
              }
            }
          }
        }

        // Binance ulasilamazsa kripto icin CoinGecko OHLC fallback
        const cgId = toCoinGeckoId(activeSymbol);
        if (cgId) {
          const days = activeTf === "1 dk" || activeTf === "1 saat" ? "1" : activeTf === "2 saat" || activeTf === "4 saat" ? "7" : "30";
          const cgUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/ohlc?vs_currency=usd&days=${days}`;
          const cgr = await fetch(cgUrl);
          if (cgr.ok) {
            const carr = (await cgr.json()) as Array<[number, number, number, number, number]>;
            if (Array.isArray(carr) && carr.length) {
              const candles: Candle[] = carr.map((k) => ({
                time: Math.floor(Number(k[0]) / 1000),
                open: Number(k[1]),
                high: Number(k[2]),
                low: Number(k[3]),
                close: Number(k[4]),
                volume: 0,
              }));
              if (candles.length) {
                setChartCandles(candles);
                setChartDataSource(`coingecko:${cgId}`);
                return;
              }
            }
          }
        }

        // Son fallback: Yahoo crypto OHLC
        const yCrypto = toYahooCryptoSymbol(activeSymbol);
        if (yCrypto) {
          const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yCrypto)}?interval=60m&range=1mo`;
          const yr = await fetch(yUrl);
          if (yr.ok) {
            const yj = (await yr.json()) as {
              chart?: {
                result?: Array<{
                  timestamp?: number[];
                  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
                }>;
              };
            };
            const result = yj?.chart?.result?.[0];
            const ts = result?.timestamp ?? [];
            const q0 = result?.indicators?.quote?.[0];
            const opens = q0?.open ?? [];
            const highs = q0?.high ?? [];
            const lows = q0?.low ?? [];
            const closes = q0?.close ?? [];
            const yc: Candle[] = [];
            for (let i = 0; i < ts.length; i += 1) {
              const o = Number(opens[i]);
              const h = Number(highs[i]);
              const l = Number(lows[i]);
              const c = Number(closes[i]);
              if (![o, h, l, c].every((n) => Number.isFinite(n))) continue;
              yc.push({ time: Number(ts[i]), open: o, high: h, low: l, close: c, volume: 0 });
            }
            if (yc.length) {
              setChartCandles(yc);
              setChartDataSource(`yahoo:${yCrypto}`);
              return;
            }
          }
        }

        setChartCandles([]);
        setChartDataSource("veri_yok");
        setChartError("Grafik verisi alinmadi (binance/coingecko/yahoo).");
      } catch {
        setChartCandles([]);
        setChartDataSource("hata");
        setChartError("Grafik verisi alinirken hata olustu.");
      }
    })();
  }, [activeSymbol, activeTf]);

  useEffect(() => {
    void (async () => {
      setBackendSummary(null);
      try {
        const backend = await applyBackendSignalIfAny();
        if (!backend || typeof backend.close !== "number") {
          const tv = await fetchTradingViewSignal(activeSymbol.full, activeSymbol.market, tvTf);
          if (typeof tv.close === "number") {
            setLastPriceText(tv.close.toLocaleString("tr-TR", { maximumFractionDigits: 4 }));
          }
        }
      } catch {
        setBackendSummary(null);
        setLastPriceText("-");
      }
    })();
  }, [activeSymbol, activeTf, tvTf]);

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        try {
          const backend = await applyBackendSignalIfAny();
          if (!backend || typeof backend.close !== "number") {
            const tv = await fetchTradingViewSignal(activeSymbol.full, activeSymbol.market, tvTf);
            if (typeof tv.close === "number") {
              setLastPriceText(tv.close.toLocaleString("tr-TR", { maximumFractionDigits: 4 }));
            }
          }
        } catch {}
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [activeSymbol, activeTf, tvTf]);

  useEffect(() => {
    if (!telegramCode || telegramLinked) return;
    const t = setInterval(() => {
      void pollTelegramLinkStatus();
    }, 5000);
    return () => clearInterval(t);
  }, [telegramCode, telegramLinked]);

  useEffect(() => {
    if (!telegramLinked || !telegramCode) return;
    if (signalText !== "AL" && signalText !== "SAT") return;
    const price = Number(String(lastPriceText).replace(/\./g, "").replace(",", ".")) || 0;
    const side = signalText;
    const slot = Math.trunc(Date.now() / 60000);
    const dedupeKey = `${activeSymbol.full}|${activeTf}|${slot}|${side}|${robotSkor}`;
    if (lastSignalNotifyRef.current === dedupeKey) return;
    lastSignalNotifyRef.current = dedupeKey;
    void pushTelegramNotify({
      kind: "signal",
      symbol: activeSymbol.full,
      interval: activeTf,
      signal: side,
      score: robotSkor,
      price,
      eventTime: Date.now(),
      dedupeKey,
    });
  }, [signalText, robotSkor, lastPriceText, activeSymbol, activeTf, telegramLinked, telegramCode]);

  useEffect(() => {
    if (!telegramLinked || !telegramCode) return;
    const t = setInterval(() => {
      void (async () => {
        const activeAlarms = alarms.filter((a) => a.active);
        if (!activeAlarms.length) return;
        const updates = [...alarms];
        let changed = false;
        for (const a of activeAlarms) {
          const target = Number(String(a.target).replace(",", "."));
          if (!Number.isFinite(target)) continue;
          try {
            const live = await fetchAlarmLivePrice(a);
            if (live == null || !Number.isFinite(live)) continue;
            const prevSeen = Number(a.lastSeenPrice);
            const hasPrev = Number.isFinite(prevSeen);
            const crossedUp = hasPrev && prevSeen < target && live >= target;
            const crossedDown = hasPrev && prevSeen > target && live <= target;
            const hit = a.direction === "up" ? crossedUp : crossedDown;
            const idx = updates.findIndex((x) => x.id === a.id);
            if (idx < 0) continue;
            if (!hit) {
              updates[idx] = { ...updates[idx], lastSeenPrice: live };
              changed = true;
              continue;
            }
            const eventTime = Date.now();
            updates[idx] = { ...updates[idx], active: false, triggeredAt: eventTime, lastSeenPrice: live };
            changed = true;
            const dedupeKey = `alarm|${a.id}|${Math.trunc(eventTime / 1000)}`;
            await pushTelegramNotify({
              kind: "alarm",
              symbol: a.inputSymbol || a.ticker,
              interval: a.timeframe,
              price: live,
              targetPrice: target,
              eventTime,
              dedupeKey,
            });
          } catch {}
        }
        if (changed) {
          setAlarms(updates);
          await AsyncStorage.setItem(ALARM_KEY, JSON.stringify(updates));
        }
      })();
    }, 12000);
    return () => clearInterval(t);
  }, [alarms, telegramLinked, telegramCode]);

  const handleOpenTelegram = () => {
    void (async () => {
      try {
        setTelegramBusy(true);
        const code = await ensureTelegramLinkCode();
        setTelegramStatus("Telegram acildi. Botta /start ile baglantiyi tamamlayin.");
        await Linking.openURL(`https://t.me/Finanssepetibot?start=${encodeURIComponent(code)}`);
      } catch {
        Alert.alert("Telegram", "Bot baglantisi olusturulamadi. Tekrar deneyin.");
      } finally {
        setTelegramBusy(false);
      }
    })();
  };

  const handleSaveTelegram = () => {
    void (async () => {
      await persistTelegramState({ code: telegramCode.trim(), chatId: telegramChatId.trim(), linked: telegramLinked });
      Alert.alert("Telegram", telegramLinked ? "Telegram baglantisi kaydedildi." : "Kod kaydedildi. Botu acip /start ile baglayin.");
    })();
  };

  const saveAlarm = async () => {
    const alarmSymbolRaw = alarmSymbolInput.trim().toUpperCase();
    if (!alarmPrice.trim()) {
      Alert.alert("Eksik bilgi", "Lütfen alarm fiyatı girin.");
      return;
    }
    if (!alarmSymbolRaw) {
      Alert.alert("Eksik bilgi", "Lutfen urun kodu girin (orn: BTCUSD).");
      return;
    }
    const directMap: Record<string, TvSymbolSearchItem> = {
      BTCUSD: { symbol: "BTCUSDT", exchange: "BINANCE", type: "crypto", description: "Bitcoin / TetherUS", full: "BINANCE:BTCUSDT", market: "crypto" },
      ETHUSD: { symbol: "ETHUSDT", exchange: "BINANCE", type: "crypto", description: "Ethereum / TetherUS", full: "BINANCE:ETHUSDT", market: "crypto" },
      SOLUSD: { symbol: "SOLUSDT", exchange: "BINANCE", type: "crypto", description: "Solana / TetherUS", full: "BINANCE:SOLUSDT", market: "crypto" },
      XAUUSD: { symbol: "XAUUSD", exchange: "OANDA", type: "forex", description: "Gold Spot / US Dollar", full: "OANDA:XAUUSD", market: "forex" },
    };
    const selected = directMap[alarmSymbolRaw] ?? activeSymbol;
    const targetNum = Number(alarmPrice.trim().replace(",", "."));
    if (!Number.isFinite(targetNum)) {
      Alert.alert("Hata", "Hedef fiyat sayisal olmalidir.");
      return;
    }
    const live = Number(String(lastPriceText).replace(/\./g, "").replace(",", "."));
    const direction: "up" | "down" = Number.isFinite(live) && live > targetNum ? "down" : "up";
    const item: AlarmItem = {
      id: `${Date.now()}`,
      inputSymbol: alarmSymbolRaw,
      symbol: `${selected.exchange}:${selected.symbol}`,
      ticker: selected.full,
      market: selected.market,
      target: alarmPrice.trim(),
      timeframe: activeTf,
      direction,
      active: true,
      lastSeenPrice: Number.isFinite(live) ? live : undefined,
    };
    const next = [item, ...alarms].slice(0, 20);
    setAlarms(next);
    await AsyncStorage.setItem(ALARM_KEY, JSON.stringify(next));
    setAlarmPrice("");
    Alert.alert("Alarm kaydedildi", `${item.symbol} icin ${item.target} hedefi eklendi.`);
  };

  const removeAlarm = async (id: string) => {
    const next = alarms.filter((a) => a.id !== id);
    setAlarms(next);
    await AsyncStorage.setItem(ALARM_KEY, JSON.stringify(next));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>{t(lang, "back")}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {t(lang, "analyses")}
        </Text>
      </View>
      <View style={styles.tabRow}>
        <Pressable style={[styles.tabBtn, activeTab === "signal" && styles.tabBtnActive]} onPress={() => setActiveTab("signal")}>
          <Text style={[styles.tabBtnText, activeTab === "signal" && styles.tabBtnTextActive]}>{t(lang, "signal_tab")}</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, activeTab === "telegram" && styles.tabBtnActive]} onPress={() => setActiveTab("telegram")}>
          <Text style={[styles.tabBtnText, activeTab === "telegram" && styles.tabBtnTextActive]}>{t(lang, "telegram_tab")}</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, activeTab === "alarm" && styles.tabBtnActive]} onPress={() => setActiveTab("alarm")}>
          <Text style={[styles.tabBtnText, activeTab === "alarm" && styles.tabBtnTextActive]}>{t(lang, "alarm_tab")}</Text>
        </Pressable>
      </View>

      {activeTab === "signal" ? (
        <View style={styles.signalPage}>
          <View style={[styles.card, styles.signalCard]}>
          <Text style={styles.cardTitle}>{t(lang, "signal_tab")} — teknik grafik</Text>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t(lang, "search_placeholder")}
              placeholderTextColor={palette.textMuted}
              style={[styles.input, styles.searchInputInline]}
              autoCapitalize="characters"
              cursorColor="#ffffff"
              selectionColor="#ffffff"
              onSubmitEditing={() => {
                void runSymbolSearch();
              }}
              returnKeyType="search"
            />
            <Pressable style={styles.searchBtnInline} onPress={() => void runSymbolSearch()}>
              <Text style={styles.searchBtnText}>{t(lang, "search_button")}</Text>
            </Pressable>
          </View>
          {searchBusy ? <Text style={styles.hint}>Aranıyor...</Text> : null}
          <View style={styles.tfBox}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tfRow}>
              {TIMEFRAMES.map((tf) => (
                <Pressable
                  key={tf}
                  style={[styles.chip, activeTf === tf && styles.chipActive]}
                  onPress={() => setActiveTf(tf)}
                >
                  <Text style={[styles.chipText, activeTf === tf && styles.chipTextActive]}>{tf}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.scoreBar}>
            <Text style={[styles.scoreBarText, { color: signalColor }]}>
              Son sinyal: {signalText} | Skor: {robotSkor}
            </Text>
            <Text style={styles.scoreBarSubText}>{scoreNote}</Text>
          </View>
          <View style={styles.chartCard}>
            <View style={styles.chartViewport}>
              <WebView
                key={`${activeSymbol.full}-${activeTf}`}
                source={chartSource}
                style={styles.webChart}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                allowsInlineMediaPlayback
                thirdPartyCookiesEnabled
                setSupportMultipleWindows={false}
                androidLayerType="software"
                onLoadStart={() => setChartError("")}
                onError={(e) => setChartError(`Grafik yuklenemedi: ${e.nativeEvent.description || "WebView hata"}`)}
                onHttpError={(e) => setChartError(`Grafik HTTP hatasi: ${e.nativeEvent.statusCode}`)}
              />
            </View>
          </View>
          <Text style={styles.hint}>Grafik kaynak: {chartDataSource}</Text>
          {chartError ? <Text style={styles.hint}>{chartError}</Text> : null}
          <View style={styles.bottomInfoBox}>
            <Text style={styles.bottomInfoText}>Seçilen ürün: {activeSymbol.full}</Text>
            <Text style={styles.bottomInfoText}>Son fiyat: {lastPriceText}</Text>
          </View>
        </View>
        </View>
      ) : null}

      {activeTab === "telegram" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
          <Text style={styles.cardTitle}>Telegram Bot</Text>
          <TextInput value={telegramChatId} editable={false} style={styles.chatIdInput} />
          <Pressable style={styles.telegramSaveBtn} onPress={handleSaveTelegram}>
            <Text style={styles.telegramSaveBtnText}>Telegram Kaydet</Text>
          </Pressable>
          <View style={styles.telegramInfoCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.telegramInfoTitle}>Telegram Bot: @Finanssepetibot</Text>
              <Text style={styles.telegramInfoText}>
                Aktivasyon: Botu Ac'a basin, Telegram'da /start yazin. Chat ID otomatik kaydedilir.
              </Text>
              <Text style={styles.telegramInfoText}>Durum: {telegramBusy ? "Baglaniyor..." : telegramStatus}</Text>
              {telegramCode ? <Text style={styles.telegramInfoText}>Link kodu: {telegramCode}</Text> : null}
            </View>
            <Pressable style={styles.botOpenBtn} onPress={handleOpenTelegram}>
              <Text style={styles.botOpenBtnText}>Botu Ac</Text>
            </Pressable>
          </View>
        </View>
        </ScrollView>
      ) : null}

      {activeTab === "alarm" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
          <Text style={styles.cardTitle}>Alarm Kur</Text>
          <Text style={styles.hint}>Istediginiz urunu yazin, hedef fiyat girip Kaydet'e basin.</Text>
          <View style={styles.alarmInputRow}>
            <TextInput
              value={alarmSymbolInput}
              onChangeText={setAlarmSymbolInput}
              placeholder="Urun kodu (orn: BTCUSD)"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, styles.alarmInputLeft]}
              autoCapitalize="characters"
            />
            <TextInput
              value={alarmPrice}
              onChangeText={setAlarmPrice}
              placeholder="Hedef fiyat"
              placeholderTextColor={palette.textMuted}
              keyboardType="numeric"
              style={[styles.input, styles.alarmInputRight]}
            />
          </View>
          <Pressable style={styles.saveBtn} onPress={saveAlarm}>
            <Text style={styles.saveBtnText}>Kaydet</Text>
          </Pressable>

          <Text style={styles.subTitle}>Kaydedilen alarmlar</Text>
          {alarms.length === 0 ? <Text style={styles.hint}>Kaydedilen alarm yok.</Text> : null}
          {alarms.map((a) => (
            <View key={a.id} style={styles.alarmRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{a.symbol}</Text>
                <Text style={styles.hint}>
                  {a.target} - {a.timeframe} - {a.ticker} - {a.active ? "Aktif" : "Tetiklendi"}
                </Text>
              </View>
              <Pressable onPress={() => void removeAlarm(a.id)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Sil</Text>
              </Pressable>
            </View>
          ))}
        </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}


