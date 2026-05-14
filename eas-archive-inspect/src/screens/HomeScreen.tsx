import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Platform,
  AppState,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAppTheme } from "../theme/ThemeProvider";
import { createHomeStyles } from "./homeScreenStyles";
import { t } from "../lib/i18n";
import { resolveBrandLogoImageSource } from "../theme/brandLogo";
import type { RootStackParamList } from "../navigation/types";
import {
  formatTryCompact,
  formatUsdCompact,
  formatDelta,
  type EmtiaQuotes,
} from "../lib/emtiaQuotes";
import { fetchMarketSnapshot } from "../lib/yahooFinance";
import { clearSession } from "../lib/authSession";
import type { HarcamaOpenAnchor } from "../lib/harcamaAnchors";
import { fetchProductQuote, fetchUsdTry } from "../lib/livePrice";
import { loadYatirimlarMerged, type StoredYatirim } from "../lib/yatirimStorage";
import { YatirimEkleModal, type YatirimPrefill } from "../components/YatirimEkleModal";
import { MarketTileCard } from "../components/MarketTileCard";
import { KredilerModal } from "../components/KredilerModal";
import { HarcamalarModal } from "../components/HarcamalarModal";
import { PortfoyumModal } from "../components/PortfoyumModal";
import { PiyasalarModal } from "../components/PiyasalarModal";
import { prefetchExtraEmtiaCards } from "../components/piyasalar/piyasalarEmtia";
import { TradingViewChartModal } from "../components/TradingViewChartModal";
import { HaberlerModal } from "../components/HaberlerModal";
import { SiteMenuModal } from "../components/SiteMenuModal";
import { SiteAyarlarModal, type SiteAyarlarSectionId } from "../components/SiteAyarlarModal";
import { ProfilimModal, type ProfilimContentSectionKey } from "../components/ProfilimModal";
import { MesajlarimModal } from "../components/MesajlarimModal";
import { KisiAraModal } from "../components/KisiAraModal";
import { YorumYazModal } from "../components/YorumYazModal";
import { YorumlarimModal } from "../components/YorumlarimModal";
import { ForumModal } from "../components/ForumModal";
import { KiyaslaGayrimenkulModal } from "../components/KiyaslaGayrimenkulModal";
import type { SiteMenuEntry } from "../lib/siteMenuContent";
import {
  DEFAULT_PROFILE,
  loadProfile,
  rememberProfileSnapshot,
  resolveAvatarUriForHome,
  saveProfile,
  type StoredProfile,
} from "../lib/profileStorage";
import { pullProfileFromFirestore } from "../lib/profileFirestore";
import {
  getIncomingFollowRequests,
  respondFollowRequest,
  type FollowRequestItem,
  type KisiAraPerson,
} from "../lib/kisiAraFirestore";
import {
  canUseMessagesFirestore,
  markConversationRead,
  subscribeIncomingMessageAlerts,
  type IncomingMessageAlert,
} from "../lib/messagesFirestore";
import {
  canUseCommentsFirestore,
  deleteSocialNotificationDoc,
  subscribeCommentUserNotifications,
  type CommentUserNotification,
} from "../lib/commentsFirestore";
import { registerPushForCurrentUser, removePushDeviceForCurrentUser } from "../lib/pushNotifications";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Home">;
};

/** Bildirimler modalı — satır bazlı sil / reddet / okundu. */
type HomeNotificationListItem =
  | {
      key: string;
      title: string;
      detail: string;
      count: number;
      target: "messages";
      peerUserId: string;
    }
  | {
      key: string;
      title: string;
      detail: string;
      count: number;
      target: "follow_requests";
      followRequest: FollowRequestItem;
    }
  | {
      key: string;
      title: string;
      detail: string;
      count: number;
      target: "comment_mentions";
      commentType: CommentUserNotification["type"];
      topic?: string;
      socialNotificationId: string;
    };

/** Canlı veri yokken fiyat "—"; değişim satırı da `formatDelta` ile "—" (0 yazdırma). */
const FALLBACK_EMITA: Required<EmtiaQuotes> = {
  goldGramTry: { price: 0 },
  silverGramTry: { price: 0 },
  oilUsd: { price: 83.91, change: 0.76, changePct: 0.91 },
};

const FALLBACK_FX_BIST = {
  usdTry: { price: 44.61117, change: 0.05967, changePct: 0.13 },
  eurTry: { price: 51.60464, change: 0.13584, changePct: 0.26 },
  bist100: { price: 9842.18, change: 112.4, changePct: 1.16 },
};

function numToBirimInput(n: number, isUsd: boolean): string {
  const d = isUsd ? (Math.abs(n) >= 1 ? 2 : 6) : 2;
  return n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function slicePositive(s: { change?: number; changePct?: number }): boolean {
  return !((s.change ?? 0) < 0 || (s.changePct ?? 0) < 0);
}

export function HomeScreen({ navigation }: Props) {
  const { palette: themePalette, isLight, lang } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(themePalette), [themePalette]);
  const brandLogoSource = resolveBrandLogoImageSource(process.env.EXPO_PUBLIC_LOGO_URL);

  /** Erkek cüzdanı (minimal bifold) — ek paket yok, Expo her ortamda açılır. */
  function WalletMenGlyph({ active }: { active: boolean }) {
    const stroke = active
      ? "#ffffff"
      : isLight
        ? themePalette.textMuted
        : "#A1887F";
    const fill = active
      ? "rgba(255,255,255,0.14)"
      : isLight
        ? "rgba(26,35,126,0.06)"
        : "rgba(62, 39, 35, 0.5)";
    return (
      <View style={[styles.walletMenOuter, { borderColor: stroke, backgroundColor: fill }]}>
        <View style={[styles.walletMenBar, { backgroundColor: stroke }]} />
        <View style={[styles.walletMenBar, { backgroundColor: stroke, marginTop: 3, opacity: 0.72, width: 12 }]} />
      </View>
    );
  }

  function TopNavLabel({ label, active }: { label: string; active: boolean }) {
    return (
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        maxFontSizeMultiplier={1.05}
        style={[styles.tileLabel, active && styles.tileLabelActive]}
      >
        {label}
      </Text>
    );
  }

  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [profilimOpen, setProfilimOpen] = useState(false);
  const [mesajlarimOpen, setMesajlarimOpen] = useState(false);
  const [mesajlarimInitialCompose, setMesajlarimInitialCompose] = useState(false);
  const [mesajlarimPrefillLabel, setMesajlarimPrefillLabel] = useState("");
  const [mesajlarimPrefillEmail, setMesajlarimPrefillEmail] = useState("");
  const [kisiAraOpen, setKisiAraOpen] = useState(false);
  const [kisiAraInitialTab, setKisiAraInitialTab] = useState<"following" | "followers" | "notifications" | "results">("following");
  const [yorumYazOpen, setYorumYazOpen] = useState(false);
  const [yorumlarimOpen, setYorumlarimOpen] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState("");
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [incomingAlerts, setIncomingAlerts] = useState<IncomingMessageAlert[]>([]);
  const [commentMentions, setCommentMentions] = useState<CommentUserNotification[]>([]);
  const [followRequests, setFollowRequests] = useState<FollowRequestItem[]>([]);
  const [composerMenuVisible, setComposerMenuVisible] = useState(false);
  const [forumOpen, setForumOpen] = useState(false);
  const [forumInitialHashtag, setForumInitialHashtag] = useState<string | null>(null);
  const [activeTopNav, setActiveTopNav] = useState<string | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<
    | Awaited<ReturnType<typeof fetchMarketSnapshot>>
    | null
  >(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [kredilerOpen, setKredilerOpen] = useState(false);
  const [harcamalarOpen, setHarcamalarOpen] = useState(false);
  const [yatirimOpen, setYatirimOpen] = useState(false);
  const [yatirimPrefill, setYatirimPrefill] = useState<YatirimPrefill | null>(null);
  const [portfoyumOpen, setPortfoyumOpen] = useState(false);
  const [piyasalarOpen, setPiyasalarOpen] = useState(false);
  const [homeChartOpen, setHomeChartOpen] = useState(false);
  const [homeChartSymbol, setHomeChartSymbol] = useState("");
  const [gramChartTryOverride, setGramChartTryOverride] = useState<{
    gold?: { price: number; change?: number; changePct?: number };
    silver?: { price: number; change?: number; changePct?: number };
  }>({});
  const [haberlerOpen, setHaberlerOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SiteAyarlarSectionId | undefined>(undefined);
  const [profilimInitialSection, setProfilimInitialSection] = useState<ProfilimContentSectionKey | undefined>(undefined);
  const [profilimOpenEditor, setProfilimOpenEditor] = useState(false);
  const [kiyaslaOpen, setKiyaslaOpen] = useState(false);
  const [kiyaslaInitialTopTab, setKiyaslaInitialTopTab] = useState<"compare" | "risers" | "fallers">("compare");
  const [portfoyumInitialTab, setPortfoyumInitialTab] = useState<"gunluk" | "aylik" | "yillik">("gunluk");
  const [harcamalarAnchor, setHarcamalarAnchor] = useState<HarcamaOpenAnchor>("gelirlerim");
  const [toplamVarlikValue, setToplamVarlikValue] = useState("₺0,00");
  const [toplamVarlikPct, setToplamVarlikPct] = useState("%0,00");
  const insets = useSafeAreaInsets();
  /** Tab satırı + alt güvenli alan (mutlak alt çubuk yüksekliği). */
  const tabBarBottomPad = Math.max(insets.bottom, 4);
  /** Alt tab satırı (orta daire + etiketler); gerçek satırdan biraz paylı. */
  const homeTabRowH = 58;
  const homeTabBarHeight = 3 + homeTabRowH + tabBarBottomPad;
  const homeScrollBottomPad = homeTabBarHeight + 4;
  /** Menü sekmesinden yukarı: tüy FAB biraz daha yukarıda. */
  const fabBottomOffset = homeTabBarHeight + 18;

  const openHarcamalar = (anchor: HarcamaOpenAnchor) => {
    setActiveTopNav("Cüzdanım");
    setHarcamalarAnchor(anchor);
    setHarcamalarOpen(true);
  };

  const openHomeYatirim = (p: YatirimPrefill) => {
    setYatirimPrefill(p);
    setYatirimOpen(true);
  };

  const openHomeChart = (sym: string) => {
    setHomeChartSymbol(sym);
    setHomeChartOpen(true);
  };

  const profileMenuItems = [t(lang, "profile"), t(lang, "my_home"), t(lang, "person_search"), t(lang, "my_messages")];

  const notificationItems: HomeNotificationListItem[] = useMemo(
    () => [
      ...incomingAlerts.map((a) => ({
        key: `m_${a.peerUserId}`,
        title: a.peerLabel || "@kullanici",
        detail: `${a.peerLabel || "@kullanici"} kişisinden yeni mesaj geldi.`,
        count: 1,
        target: "messages" as const,
        peerUserId: a.peerUserId,
      })),
      ...followRequests.map((r) => ({
        key: `f_${r.requestId || r.fromUserId}`,
        title: r.fromUsername || "@kullanici",
        detail: `${r.fromUsername || "@kullanici"} 1 takip isteği gönderdi.`,
        count: 1,
        target: "follow_requests" as const,
        followRequest: r,
      })),
      ...commentMentions
        .filter((n) => n.type !== "follow_request")
        .map((n) => {
          const title = n.fromUsername || "@kullanici";
          const detail =
            n.type === "comment_like"
              ? `${title} yorumunuzu beğendi: ${n.textPreview || "Yorum bildirimi"}`
              : n.type === "comment_favorite"
                ? `${title} yorumunuzu favorilere ekledi: ${n.textPreview || "Yorum bildirimi"}`
                : n.type === "comment_reply"
                  ? `${title} yorumunuza yanıt verdi: ${n.textPreview || ""}`
                  : n.type === "follow_accepted"
                    ? `${title} takip isteğinizi kabul etti.`
                    : `${title} sizi bir yorumda etiketledi: ${n.textPreview || "Yorum bildirimi"}`;
          return {
            key: `c_${n.id}`,
            title,
            detail,
            count: 1,
            target: "comment_mentions" as const,
            commentType: n.type,
            ...(n.topic ? { topic: n.topic } : {}),
            socialNotificationId: n.id,
          };
        }),
    ],
    [incomingAlerts, followRequests, commentMentions],
  );

  const totalNotificationCount = useMemo(
    () => notificationItems.reduce((acc, item) => acc + item.count, 0),
    [notificationItems]
  );

  const mergedMarket = useMemo(() => {
    const g0 = marketSnapshot?.goldGramTry ?? FALLBACK_EMITA.goldGramTry;
    const s0 = marketSnapshot?.silverGramTry ?? FALLBACK_EMITA.silverGramTry;
    const og = gramChartTryOverride.gold;
    const g =
      og != null && typeof og.price === "number" && Number.isFinite(og.price) && og.price > 0
        ? {
            ...g0,
            price: og.price,
            ...(typeof og.change === "number" && Number.isFinite(og.change) ? { change: og.change } : {}),
            ...(typeof og.changePct === "number" && Number.isFinite(og.changePct) ? { changePct: og.changePct } : {}),
          }
        : g0;
    const os = gramChartTryOverride.silver;
    const s =
      os != null && typeof os.price === "number" && Number.isFinite(os.price) && os.price > 0
        ? {
            ...s0,
            price: os.price,
            ...(typeof os.change === "number" && Number.isFinite(os.change) ? { change: os.change } : {}),
            ...(typeof os.changePct === "number" && Number.isFinite(os.changePct) ? { changePct: os.changePct } : {}),
          }
        : s0;
    const o = marketSnapshot?.oilUsd ?? FALLBACK_EMITA.oilUsd;
    const u = marketSnapshot?.usdTry ?? FALLBACK_FX_BIST.usdTry;
    const e = marketSnapshot?.eurTry ?? FALLBACK_FX_BIST.eurTry;
    const b = marketSnapshot?.bist100 ?? FALLBACK_FX_BIST.bist100;
    return { g, s, o, u, e, b };
  }, [marketSnapshot, gramChartTryOverride]);

  const refreshMarket = useCallback((opts?: { showSpinner?: boolean }) => {
    const spin = opts?.showSpinner !== false;
    if (spin) setMarketLoading(true);
    void fetchMarketSnapshot()
      .then((snap) => {
        setMarketSnapshot(snap);
      })
      .catch(() => {
        setMarketSnapshot(null);
      })
      .finally(() => {
        if (spin) {
          setMarketLoading(false);
          setGramChartTryOverride({});
        }
      });
  }, []);

  const refreshProfilePhoto = useCallback(() => {
    void (async () => {
      try {
        const local = await loadProfile();
        const remote = await pullProfileFromFirestore();
        const merged: StoredProfile = { ...DEFAULT_PROFILE, ...local, ...(remote || {}) };
        rememberProfileSnapshot(merged);
        const uri = resolveAvatarUriForHome(local, remote);
        setProfilePhotoUri(uri);
        if (uri && /^https?:\/\//i.test(uri) && !(local.photoUri || "").trim()) {
          await saveProfile({ ...local, photoUri: uri });
        }
      } catch {
        try {
          const local = await loadProfile();
          rememberProfileSnapshot({ ...DEFAULT_PROFILE, ...local });
          setProfilePhotoUri(resolveAvatarUriForHome(local, null));
        } catch {
          setProfilePhotoUri("");
        }
      }
    })();
  }, []);

  useEffect(() => {
    void loadProfile();
  }, []);

  const refreshFollowRequests = useCallback(() => {
    void getIncomingFollowRequests()
      .then((rows) => setFollowRequests(rows))
      .catch(() => setFollowRequests([]));
  }, []);

  const handleDismissNotification = useCallback(
    (item: HomeNotificationListItem) => {
      void (async () => {
        try {
          if (item.target === "messages") {
            if (canUseMessagesFirestore()) await markConversationRead(item.peerUserId);
          } else if (item.target === "follow_requests") {
            await respondFollowRequest(item.followRequest, false);
            refreshFollowRequests();
          } else if (item.target === "comment_mentions" && canUseCommentsFirestore()) {
            await deleteSocialNotificationDoc(item.socialNotificationId);
          }
        } catch {
          /* ağ / kural hatası — listeyi periyotik yenileme yakalar */
        }
      })();
    },
    [refreshFollowRequests],
  );

  useEffect(() => {
    refreshMarket({ showSpinner: true });
    prefetchExtraEmtiaCards();
    const REFRESH_MS = 30_000;
    const id = setInterval(() => refreshMarket({ showSpinner: false }), REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshMarket]);

  useFocusEffect(
    useCallback(() => {
      refreshMarket({ showSpinner: false });
      prefetchExtraEmtiaCards();
      refreshProfilePhoto();
      refreshFollowRequests();
    }, [refreshMarket, refreshProfilePhoto, refreshFollowRequests]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshMarket({ showSpinner: false });
        refreshProfilePhoto();
      }
    });
    return () => sub.remove();
  }, [refreshMarket, refreshProfilePhoto]);

  useEffect(() => {
    if (!canUseMessagesFirestore()) {
      setIncomingAlerts([]);
      return;
    }
    let unsub: (() => void) | null = null;
    let closed = false;
    void (async () => {
      try {
        unsub = await subscribeIncomingMessageAlerts(
          (items) => {
            if (closed) return;
            setIncomingAlerts(items);
          },
          () => {
            if (closed) return;
            setIncomingAlerts([]);
          },
        );
      } catch {
        if (closed) return;
        setIncomingAlerts([]);
      }
    })();
    return () => {
      closed = true;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    if (!canUseCommentsFirestore()) {
      setCommentMentions([]);
      return;
    }
    let unsub: (() => void) | null = null;
    let closed = false;
    void (async () => {
      try {
        unsub = await subscribeCommentUserNotifications(
          (items) => {
            if (closed) return;
            setCommentMentions(items);
          },
          () => {
            if (closed) return;
            setCommentMentions([]);
          },
        );
      } catch {
        if (closed) return;
        setCommentMentions([]);
      }
    })();
    return () => {
      closed = true;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    refreshFollowRequests();
    const id = setInterval(refreshFollowRequests, 8000);
    return () => {
      clearInterval(id);
    };
  }, [refreshFollowRequests]);

  useEffect(() => {
    void registerPushForCurrentUser();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const yil = String(new Date().getFullYear());
      const rows = (await loadYatirimlarMerged()).filter((r) => r.tarih.startsWith(`${yil}-`));
      if (!rows.length) {
        if (!cancelled) {
          setToplamVarlikValue("₺0,00");
          setToplamVarlikPct("%0,00");
        }
        return;
      }
      const usdTry = (await fetchUsdTry()) ?? 0;
      const grouped = new Map<string, { urun: string; symbol?: string; miktar: number; ilkToplam: number }>();
      for (const r of rows) {
        const key = r.symbol || r.urun;
        const kur = r.quoteCurrency === "USD" ? (r.usdTryAtBuy && r.usdTryAtBuy > 0 ? r.usdTryAtBuy : usdTry) : 0;
        const ilkToplam = r.quoteCurrency === "USD" ? r.miktar * r.birimFiyat * kur : r.toplamTutar;
        const prev = grouped.get(key) ?? { urun: r.urun, symbol: r.symbol, miktar: 0, ilkToplam: 0 };
        prev.miktar += r.miktar;
        prev.ilkToplam += Number.isFinite(ilkToplam) ? ilkToplam : 0;
        grouped.set(key, prev);
      }
      let toplamIlk = 0;
      let toplamAnlik = 0;
      for (const item of grouped.values()) {
        toplamIlk += item.ilkToplam;
        const q = await fetchProductQuote(item.symbol ?? item.urun);
        if (!q?.price || !Number.isFinite(q.price)) continue;
        const birimTry = q.quoteCurrency === "USD" ? q.price * usdTry : q.price;
        if (!Number.isFinite(birimTry)) continue;
        toplamAnlik += birimTry * item.miktar;
      }
      const pct = toplamIlk > 0 ? ((toplamAnlik - toplamIlk) / toplamIlk) * 100 : 0;
      if (!cancelled) {
        setToplamVarlikValue(
          `₺${toplamAnlik.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        );
        setToplamVarlikPct(`${pct >= 0 ? "+" : ""}%${Math.abs(pct).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.replace("%+", "+%"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfoyumOpen, yatirimOpen]);

  const onProfileMenuPress = (item: string) => {
    setProfileMenuVisible(false);
    if (item === t(lang, "profile")) {
      setProfilimInitialSection(undefined);
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (item === t(lang, "my_messages")) {
      setMesajlarimInitialCompose(false);
      setMesajlarimPrefillLabel("");
      setMesajlarimPrefillEmail("");
      setMesajlarimOpen(true);
    }
    if (item === t(lang, "person_search")) {
      setKisiAraInitialTab("following");
      setKisiAraOpen(true);
    }
    if (item === "Yorumlarım") {
      setYorumlarimOpen(true);
    }
  };

  const onOpenComposeFromKisiAra = (person: KisiAraPerson) => {
    setKisiAraOpen(false);
    setMesajlarimInitialCompose(true);
    setMesajlarimPrefillLabel(person.username || "");
    setMesajlarimPrefillEmail(person.email || "");
    setMesajlarimOpen(true);
  };

  const onSiteMenuItemPress = (entry: SiteMenuEntry) => {
    if (entry.id === "kredi_hesaplama" || entry.id === "kullandigim_krediler") {
      setActiveTopNav("Krediler");
      setKredilerOpen(true);
    }
    if (entry.id === "yorum_yaz") {
      setYorumYazOpen(true);
    }
    if (entry.id === "yorumlarim") {
      setYorumlarimOpen(true);
    }
    if (entry.id === "kiyasla_aciklama") {
      setActiveTopNav("Kıyasla");
      setKiyaslaInitialTopTab("compare");
      setKiyaslaOpen(true);
    }
    if (entry.id === "dusenler_aciklama") {
      setActiveTopNav("Kıyasla");
      setKiyaslaInitialTopTab("fallers");
      setKiyaslaOpen(true);
    }
    if (entry.id === "analiz_aciklama") {
      setActiveTopNav("Analizler");
      navigation.navigate("Analizler");
    }
    if (entry.id === "yatirim_ekle_aciklama") {
      setYatirimOpen(true);
    }
    if (entry.id === "cuzdanim_aciklama") {
      setActiveTopNav("Cüzdanım");
      openHarcamalar("gelirlerim");
    }
    if (entry.id === "profil_gizliligi") {
      setSettingsInitialSection("profil_gizlilik");
      setSettingsOpen(true);
    }
    if (entry.id === "sifre_degistir") {
      setSettingsInitialSection("sifre");
      setSettingsOpen(true);
    }
    if (entry.id === "dil_secenekleri") {
      setSettingsInitialSection("dil");
      setSettingsOpen(true);
    }
    if (entry.id === "site_gorunumu") {
      setSettingsInitialSection("site_gorunumu");
      setSettingsOpen(true);
    }
    if (entry.id === "kariyerim") {
      setProfilimInitialSection("career");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (entry.id === "profilim") {
      setProfilimInitialSection(undefined);
      setProfilimOpenEditor(true);
      setProfilimOpen(true);
    }
    if (entry.id === "ana_sayfam") {
      setProfilimInitialSection("home");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (entry.id === "kisi_ara") {
      setKisiAraInitialTab("results");
      setKisiAraOpen(true);
    }
    if (entry.id === "mesajlarim") {
      setMesajlarimInitialCompose(false);
      setMesajlarimPrefillLabel("");
      setMesajlarimPrefillEmail("");
      setMesajlarimOpen(true);
    }
    if (entry.id === "begendiklerim") {
      setProfilimInitialSection("liked");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (entry.id === "favorilerim") {
      setProfilimInitialSection("favorites");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (entry.id === "fotograflarim") {
      setProfilimInitialSection("photos");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
    if (entry.id === "videolarim") {
      setProfilimInitialSection("videos");
      setProfilimOpenEditor(false);
      setProfilimOpen(true);
    }
  };

  const onProfileLogout = async () => {
    setProfileMenuVisible(false);
    await removePushDeviceForCurrentUser().catch(() => {});
    await clearSession();
    navigation.replace("Login");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable style={styles.profileButton} onPress={() => setProfileMenuVisible(true)}>
          <Image source={profilePhotoUri ? { uri: profilePhotoUri } : brandLogoSource} style={styles.profileImage} />
          <Text style={styles.profileName}>{t(lang, "profile")}</Text>
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={styles.welcome}>{t(lang, "welcome_home")}</Text>
        </View>

        <View style={styles.topActions}>
          <Pressable style={styles.iconButton} onPress={() => setNotificationsVisible(true)}>
            <Text style={styles.iconText}>🔔</Text>
            {totalNotificationCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{totalNotificationCount > 99 ? "99+" : totalNotificationCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={[styles.iconButton, styles.settingsButton]}
            onPress={() => {
              setSettingsInitialSection(undefined);
              setSettingsOpen(true);
            }}
          >
            <Text style={styles.settingsIconText}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.mainBody}>
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: homeScrollBottomPad }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <View style={styles.topShortcutRow}>
            <Pressable
              style={[styles.topNavItem, activeTopNav === "Portföyüm" && styles.topNavItemActive]}
              onPress={() => {
                setActiveTopNav("Portföyüm");
                setPortfoyumOpen(true);
              }}
            >
              <Text style={styles.topNavIcon}>💼</Text>
              <TopNavLabel label={t(lang, "portfolio")} active={activeTopNav === "Portföyüm"} />
            </Pressable>
            <Pressable
              style={[styles.topNavItem, activeTopNav === "Cüzdanım" && styles.topNavItemActive]}
              onPress={() => openHarcamalar("gelirlerim")}
            >
              <WalletMenGlyph active={activeTopNav === "Cüzdanım"} />
              <TopNavLabel label={t(lang, "wallet")} active={activeTopNav === "Cüzdanım"} />
            </Pressable>
            <Pressable
              style={[styles.topNavItem, activeTopNav === "Analizler" && styles.topNavItemActive]}
              onPress={() => {
                setActiveTopNav("Analizler");
                navigation.navigate("Analizler");
              }}
            >
              <Text style={styles.topNavIcon}>📊</Text>
              <TopNavLabel label={t(lang, "analyses_top")} active={activeTopNav === "Analizler"} />
            </Pressable>
            <Pressable
              style={[styles.topNavItem, activeTopNav === "Krediler" && styles.topNavItemActive]}
              onPress={() => {
                setActiveTopNav("Krediler");
                setKredilerOpen(true);
              }}
            >
              <Text style={styles.topNavIcon}>🏦</Text>
              <TopNavLabel label={t(lang, "loans")} active={activeTopNav === "Krediler"} />
            </Pressable>
          </View>

          <View style={styles.balanceRow}>
            <Pressable
              style={styles.balanceCard}
              onPress={() => {
                setActiveTopNav("Portföyüm");
                setPortfoyumInitialTab("yillik");
                setPortfoyumOpen(true);
              }}
            >
              <Text style={styles.balanceLabel}>{t(lang, "home_total_assets_cap")}</Text>
              <Text style={styles.balanceValue}>{toplamVarlikValue}</Text>
              <Text style={styles.balanceChange}>
                {toplamVarlikPct} {t(lang, "today_label")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.kiyaslaCard, activeTopNav === "Kıyasla" && styles.kiyaslaCardActive]}
              onPress={() => {
                setActiveTopNav("Kıyasla");
                setKiyaslaInitialTopTab("compare");
                setKiyaslaOpen(true);
              }}
            >
              <Text style={styles.kiyaslaIconEmoji} allowFontScaling={false}>
                {"\u2696\uFE0F"}
              </Text>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.68}
                maxFontSizeMultiplier={1.05}
                style={[
                  styles.tileLabel,
                  styles.kiyaslaLabelOffset,
                  activeTopNav === "Kıyasla" && styles.tileLabelActive,
                ]}
              >
                {t(lang, "compare")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.sectionCard, styles.quickSectionCard]}>
          <View style={styles.quickGrid}>
            <Pressable style={styles.quickItem} onPress={() => openHarcamalar("gelirlerim")}>
              <Text style={styles.quickItemIcon}>💸</Text>
              <TopNavLabel label={t(lang, "my_income")} active={false} />
            </Pressable>
            <Pressable style={styles.quickItem} onPress={() => openHarcamalar("giderlerim")}>
              <Text style={styles.quickItemIcon}>📉</Text>
              <TopNavLabel label={t(lang, "my_expenses")} active={false} />
            </Pressable>
            <Pressable style={styles.quickItem} onPress={() => openHarcamalar("ebitda")}>
              <Text style={styles.quickItemIcon}>📊</Text>
              <TopNavLabel label="EBITDA" active={false} />
            </Pressable>
            <Pressable style={styles.quickItem} onPress={() => openHarcamalar("nakit_akis")}>
              <Text style={styles.quickItemIcon}>🧾</Text>
              <TopNavLabel label={t(lang, "cashflow")} active={false} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.sectionCard, styles.marketsSectionCard]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, styles.sectionTitleTight]}>{t(lang, "markets")}</Text>
            {marketLoading ? <ActivityIndicator size="small" color={themePalette.textMuted} /> : null}
          </View>
          <View style={styles.tvRow}>
            <View style={[styles.homeMarketCol, styles.tvGapRight]}>
              <MarketTileCard
                title={t(lang, "gold_try")}
                value={mergedMarket.g.price > 0 ? formatTryCompact(mergedMarket.g.price) : "—"}
                changeText={formatDelta(mergedMarket.g.change, mergedMarket.g.changePct)}
                positive={slicePositive(mergedMarket.g)}
                showAdd
                showChart
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "Altın/TL",
                    urunArama: "Altın",
                    birimFiyat:
                      mergedMarket.g.price > 0 ? numToBirimInput(mergedMarket.g.price, false) : "",
                    quoteCurrency: "TRY",
                  })
                }
                onChart={() => openHomeChart(marketSnapshot?.emtiaTvChart?.altinTl ?? "FX_IDC:XAUTRYG")}
              />
            </View>
            <View style={styles.homeMarketCol}>
              <MarketTileCard
                title={t(lang, "silver_try")}
                value={mergedMarket.s.price > 0 ? formatTryCompact(mergedMarket.s.price) : "—"}
                changeText={formatDelta(mergedMarket.s.change, mergedMarket.s.changePct)}
                positive={slicePositive(mergedMarket.s)}
                showAdd
                showChart
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "Gümüş/TL",
                    urunArama: "Gümüş",
                    birimFiyat:
                      mergedMarket.s.price > 0 ? numToBirimInput(mergedMarket.s.price, false) : "",
                    quoteCurrency: "TRY",
                  })
                }
                onChart={() => openHomeChart(marketSnapshot?.emtiaTvChart?.gumusTl ?? "FX_IDC:XAGTRYG")}
              />
            </View>
          </View>
          <View style={styles.tvRowBottom}>
            <View style={[styles.homeMarketCol, styles.tvGapRight]}>
              <MarketTileCard
                title="USD / TL"
                value={formatTryCompact(mergedMarket.u.price)}
                changeText={formatDelta(mergedMarket.u.change, mergedMarket.u.changePct)}
                positive={slicePositive(mergedMarket.u)}
                showAdd
                showChart
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "USD/TL",
                    urunArama: "USDTRY=X",
                    birimFiyat: numToBirimInput(mergedMarket.u.price, false),
                    quoteCurrency: "TRY",
                  })
                }
                onChart={() => openHomeChart("FX_IDC:USDTRY")}
              />
            </View>
            <View style={styles.homeMarketCol}>
              <MarketTileCard
                title="EUR / TL"
                value={formatTryCompact(mergedMarket.e.price)}
                changeText={formatDelta(mergedMarket.e.change, mergedMarket.e.changePct)}
                positive={slicePositive(mergedMarket.e)}
                showAdd
                showChart
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "EUR/TL",
                    urunArama: "EURTRY=X",
                    birimFiyat: numToBirimInput(mergedMarket.e.price, false),
                    quoteCurrency: "TRY",
                  })
                }
                onChart={() => openHomeChart("FX_IDC:EURTRY")}
              />
            </View>
          </View>
          <View style={styles.tvRowBottom}>
            <View style={[styles.homeMarketCol, styles.tvGapRight]}>
              <MarketTileCard
                title={t(lang, "oil_usd")}
                value={formatUsdCompact(mergedMarket.o.price)}
                changeText={formatDelta(mergedMarket.o.change, mergedMarket.o.changePct)}
                positive={slicePositive(mergedMarket.o)}
                showAdd
                showChart
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "Petrol/USD",
                    urunArama: "Petrol",
                    birimFiyat: numToBirimInput(mergedMarket.o.price, true),
                    quoteCurrency: "USD",
                  })
                }
                onChart={() => openHomeChart("TVC:UKOIL")}
              />
            </View>
            <View style={styles.homeMarketCol}>
              <MarketTileCard
                title="BIST100"
                value={mergedMarket.b.price.toLocaleString("tr-TR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                changeText={formatDelta(mergedMarket.b.change, mergedMarket.b.changePct)}
                positive={slicePositive(mergedMarket.b)}
                showAdd
                showChart={false}
                compact
                onAdd={() =>
                  openHomeYatirim({
                    urun: "BIST 100",
                    urunArama: "BIST100.IS",
                    birimFiyat: numToBirimInput(mergedMarket.b.price, false),
                    quoteCurrency: "TRY",
                    symbol: "BIST100.IS",
                  })
                }
                onChart={() => {}}
              />
            </View>
          </View>
        </View>

      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: tabBarBottomPad, paddingTop: 3 }]}>
        <Pressable style={styles.tabItem}>
          <Text style={styles.tabIcon}>🏠</Text>
          <Text style={[styles.tabText, styles.tabTextActive]} numberOfLines={1}>
            {t(lang, "home_tab_home")}
          </Text>
        </Pressable>
        <Pressable
          style={styles.tabItem}
          onPress={() => {
            setActiveTopNav("Piyasalar");
            setPiyasalarOpen(true);
          }}
        >
          <Text style={styles.tabIcon}>📈</Text>
          <Text style={styles.tabText} numberOfLines={1}>
            {t(lang, "markets")}
          </Text>
        </Pressable>
        <Pressable
          style={styles.tabItemCenter}
          onPress={() => {
            setYatirimPrefill(null);
            setYatirimOpen(true);
          }}
        >
          <View style={styles.tabCenterCircle}>
            <Text style={styles.tabCenterPlus}>+</Text>
          </View>
          <Text style={styles.tabText} numberOfLines={1}>
            {t(lang, "fab_add_investment")}
          </Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => setHaberlerOpen(true)}>
          <Text style={styles.tabIcon}>📰</Text>
          <Text style={styles.tabText} numberOfLines={1}>
            {t(lang, "news")}
          </Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => setSiteMenuOpen(true)}>
          <Text style={styles.tabIcon}>☰</Text>
          <Text style={styles.tabText} numberOfLines={1}>
            {t(lang, "menu")}
          </Text>
        </Pressable>
      </View>
      </View>

      <View style={[styles.fabWrap, { bottom: fabBottomOffset }]}>
        {composerMenuVisible ? (
          <View style={styles.fabMenu}>
            <Pressable
              style={styles.fabMenuItem}
              onPress={() => {
                setComposerMenuVisible(false);
                setMesajlarimInitialCompose(true);
                setMesajlarimOpen(true);
              }}
            >
              <Text style={styles.fabMenuText}>{t(lang, "write_message")}</Text>
            </Pressable>
            <Pressable
              style={styles.fabMenuItem}
              onPress={() => {
                setComposerMenuVisible(false);
                setYorumYazOpen(true);
              }}
            >
              <Text style={styles.fabMenuText}>{t(lang, "write_comment")}</Text>
            </Pressable>
            <Pressable
              style={styles.fabMenuItem}
              onPress={() => {
                setComposerMenuVisible(false);
                setForumOpen(true);
              }}
            >
              <Text style={styles.fabMenuText}>{t(lang, "forum")}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable style={styles.fabButton} onPress={() => setComposerMenuVisible((v) => !v)}>
          <Text style={styles.fabIcon}>🪶</Text>
        </Pressable>
      </View>

      <Modal visible={profileMenuVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setProfileMenuVisible(false)} />
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>{t(lang, "quick_menu")}</Text>
            <View style={styles.menuGrid}>
              {profileMenuItems.map((item) => (
                <Pressable key={item} style={styles.menuGridCell} onPress={() => onProfileMenuPress(item)}>
                  <Text style={styles.menuGridCellText} numberOfLines={2}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.menuLogoutButton} onPress={onProfileLogout}>
              <Text style={styles.menuLogoutButtonText}>{t(lang, "logout")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {kredilerOpen ? (
        <KredilerModal
          visible={kredilerOpen}
          onClose={() => {
            setKredilerOpen(false);
            setActiveTopNav((a) => (a === "Krediler" ? null : a));
          }}
        />
      ) : null}

      {harcamalarOpen ? (
        <HarcamalarModal
          visible={harcamalarOpen}
          initialAnchor={harcamalarAnchor}
          onClose={() => {
            setHarcamalarOpen(false);
            setActiveTopNav((a) => (a === "Cüzdanım" ? null : a));
          }}
        />
      ) : null}

      {yatirimOpen ? (
        <YatirimEkleModal
          visible={yatirimOpen}
          prefill={yatirimPrefill}
          onClose={() => {
            setYatirimOpen(false);
            setYatirimPrefill(null);
          }}
        />
      ) : null}

      {portfoyumOpen ? (
        <PortfoyumModal visible={portfoyumOpen} initialTab={portfoyumInitialTab} onClose={() => setPortfoyumOpen(false)} />
      ) : null}

      {piyasalarOpen ? (
        <PiyasalarModal
          visible={piyasalarOpen}
          onClose={() => {
            setPiyasalarOpen(false);
            setActiveTopNav((a) => (a === "Piyasalar" ? null : a));
          }}
          onOpenYatirimEkle={(p) => {
            setYatirimPrefill(p);
            setPiyasalarOpen(false);
            setYatirimOpen(true);
          }}
          data={{
            altinTl: mergedMarket.g,
            gumusTl: mergedMarket.s,
            usdTl: mergedMarket.u,
            eurTl: mergedMarket.e,
            petrolUsd: mergedMarket.o,
            bist100: mergedMarket.b,
          }}
        />
      ) : null}

      {haberlerOpen ? <HaberlerModal visible={haberlerOpen} onClose={() => setHaberlerOpen(false)} /> : null}

      {siteMenuOpen ? (
        <SiteMenuModal
          visible={siteMenuOpen}
          onClose={() => setSiteMenuOpen(false)}
          onItemPress={onSiteMenuItemPress}
        />
      ) : null}

      {settingsOpen ? (
        <SiteAyarlarModal
          visible={settingsOpen}
          initialSection={settingsInitialSection}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialSection(undefined);
          }}
        />
      ) : null}

      <ProfilimModal
        visible={profilimOpen}
        initialContentSection={profilimInitialSection}
        openProfileEditor={profilimOpenEditor}
        onClose={() => {
          setProfilimOpen(false);
          setProfilimInitialSection(undefined);
          setProfilimOpenEditor(false);
        }}
        onOpenCompose={onOpenComposeFromKisiAra}
        onSaved={() => {
          refreshProfilePhoto();
        }}
      />
      {kiyaslaOpen ? (
        <KiyaslaGayrimenkulModal
          visible={kiyaslaOpen}
          onClose={() => setKiyaslaOpen(false)}
          initialTopTab={kiyaslaInitialTopTab}
        />
      ) : null}
      <MesajlarimModal
        visible={mesajlarimOpen}
        initialCompose={mesajlarimInitialCompose}
        initialToLabel={mesajlarimPrefillLabel}
        initialToEmail={mesajlarimPrefillEmail}
        onClose={() => {
          setMesajlarimOpen(false);
          setMesajlarimInitialCompose(false);
          setMesajlarimPrefillLabel("");
          setMesajlarimPrefillEmail("");
        }}
      />
      {kisiAraOpen ? (
        <KisiAraModal
          visible={kisiAraOpen}
          onClose={() => setKisiAraOpen(false)}
          onOpenCompose={onOpenComposeFromKisiAra}
          initialTab={kisiAraInitialTab}
        />
      ) : null}
      {yorumYazOpen ? <YorumYazModal visible={yorumYazOpen} onClose={() => setYorumYazOpen(false)} /> : null}
      {yorumlarimOpen ? <YorumlarimModal visible={yorumlarimOpen} onClose={() => setYorumlarimOpen(false)} /> : null}
      {forumOpen ? (
        <ForumModal
          visible={forumOpen}
          initialHashtag={forumInitialHashtag}
          onClose={() => {
            setForumOpen(false);
            setForumInitialHashtag(null);
          }}
        />
      ) : null}

      {homeChartOpen ? (
        <TradingViewChartModal
          visible={homeChartOpen}
          symbol={homeChartSymbol}
          onClose={() => {
            setHomeChartOpen(false);
            setHomeChartSymbol("");
          }}
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
      ) : null}

      <Modal visible={notificationsVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setNotificationsVisible(false)}>
          <Pressable style={styles.notificationsCard} onPress={() => {}}>
            <View style={styles.notificationsHeader}>
              <Text style={styles.menuTitle}>{t(lang, "notifications_heading")}</Text>
              <View style={styles.badgeLarge}>
                <Text style={styles.badgeText}>{totalNotificationCount}</Text>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {notificationItems.map((item) => (
                <View key={item.key} style={styles.notificationRow}>
                  <Pressable
                    style={styles.notificationRowMain}
                    onPress={() => {
                      setNotificationsVisible(false);
                      if (item.target === "follow_requests") {
                        setKisiAraInitialTab("notifications");
                        setKisiAraOpen(true);
                      } else if (item.target === "comment_mentions") {
                        if (item.commentType === "follow_accepted") {
                          setKisiAraInitialTab("notifications");
                          setKisiAraOpen(true);
                        } else {
                          const t = item.topic;
                          const hashtagOpen =
                            (item.commentType === "comment_mention" || item.commentType === "comment_reply") &&
                            typeof t === "string" &&
                            t.trim().startsWith("#");
                          if (hashtagOpen) {
                            setForumInitialHashtag(t.trim());
                            setForumOpen(true);
                          } else {
                            setYorumlarimOpen(true);
                          }
                        }
                      } else {
                        setMesajlarimInitialCompose(false);
                        setMesajlarimOpen(true);
                      }
                    }}
                  >
                    <View style={styles.notificationTextWrap}>
                      <Text style={styles.notificationTitle}>{item.title}</Text>
                      <Text style={styles.notificationDetail}>{item.detail}</Text>
                    </View>
                    <View style={styles.badgeMini}>
                      <Text style={styles.badgeText}>{item.count}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t(lang, "notif_delete")}
                    style={styles.notificationTrash}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => handleDismissNotification(item)}
                  >
                    <Text style={styles.notificationTrashIcon}>🗑️</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
