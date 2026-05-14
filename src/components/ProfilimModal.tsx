import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ResizeMode, Video, type AVPlaybackStatus } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme, useThemeColors } from "../theme/ThemeProvider";
import { t } from "../lib/i18n";
import { createProfilimModalStyles } from "./profilimModalStyles";
import {
  DEFAULT_PROFILE,
  loadProfile,
  peekCachedProfile,
  rememberProfileSnapshot,
  resolveAvatarUriForHome,
  saveProfile,
  type StoredProfile,
} from "../lib/profileStorage";
import { pullProfileFromFirestore, pushProfileToFirestore } from "../lib/profileFirestore";
import {
  getFollowersPeople,
  getFollowersPeopleQuick,
  getFollowingPeople,
  getFollowingPeopleQuick,
  getOutgoingFollowPendingMap,
  getProfileSocialCounts,
  isFollowing,
  toggleFollow,
  type KisiAraPerson,
} from "../lib/kisiAraFirestore";
import { SocialProfileModal } from "./SocialProfileModal";
import { getSocialProfileDetail, type SocialProfileDetail } from "../lib/socialProfileFirestore";
import { useCachedRemoteVideoUri } from "../lib/useCachedRemoteVideoUri";
import {
  commentFeedItemMatchesOwnerKeys,
  deleteMyComment,
  publishComment,
  resolveCommentActor,
  subscribeCommentFeed,
  toggleCommentFavorite,
  toggleCommentLike,
  type CommentFeedItem,
  updateMyComment,
} from "../lib/commentsFirestore";

export type ProfilimContentSectionKey =
  | "home"
  | "personal"
  | "mine"
  | "liked"
  | "favorites"
  | "photos"
  | "videos"
  | "career";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onOpenCompose?: (person: KisiAraPerson) => void;
  /** Menüden ilgili tam ekran profile alt sekmesi */
  initialContentSection?: ProfilimContentSectionKey;
  /** Menüden doğrudan temel bilgi düzenleme formu */
  openProfileEditor?: boolean;
};

const CITY_OPTIONS = [
  "İstanbul",
  "Ankara",
  "İzmir",
  "Adana",
  "Adıyaman",
  "Afyonkarahisar",
  "Ağrı",
  "Aksaray",
  "Amasya",
  "Antalya",
  "Ardahan",
  "Artvin",
  "Aydın",
  "Balıkesir",
  "Bartın",
  "Batman",
  "Bayburt",
  "Bilecik",
  "Bingöl",
  "Bitlis",
  "Bolu",
  "Burdur",
  "Bursa",
  "Çanakkale",
  "Çankırı",
  "Çorum",
  "Denizli",
  "Diyarbakır",
  "Düzce",
  "Edirne",
  "Elazığ",
  "Erzincan",
  "Erzurum",
  "Eskişehir",
  "Gaziantep",
  "Giresun",
  "Gümüşhane",
  "Hakkari",
  "Hatay",
  "Iğdır",
  "Isparta",
  "Kahramanmaraş",
  "Karabük",
  "Karaman",
  "Kars",
  "Kastamonu",
  "Kayseri",
  "Kırıkkale",
  "Kırklareli",
  "Kırşehir",
  "Kilis",
  "Kocaeli",
  "Konya",
  "Kütahya",
  "Malatya",
  "Manisa",
  "Mardin",
  "Mersin",
  "Muğla",
  "Muş",
  "Nevşehir",
  "Niğde",
  "Ordu",
  "Osmaniye",
  "Rize",
  "Sakarya",
  "Samsun",
  "Siirt",
  "Sinop",
  "Sivas",
  "Şanlıurfa",
  "Şırnak",
  "Tekirdağ",
  "Tokat",
  "Trabzon",
  "Tunceli",
  "Uşak",
  "Van",
  "Yalova",
  "Yozgat",
  "Zonguldak",
];

const PRIVACY_LABELS: Record<StoredProfile["gizlilik"], string> = {
  herkese_acik: "Herkese Açık",
  sadece_takipciler: "Sadece Takipçiler",
  gizli: "Gizli",
};

function nextPrivacy(v: StoredProfile["gizlilik"]): StoredProfile["gizlilik"] {
  if (v === "herkese_acik") return "sadece_takipciler";
  if (v === "sadece_takipciler") return "gizli";
  return "herkese_acik";
}

function normalizeUsername(v: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

type ProfilimModalStylesResolved = ReturnType<typeof createProfilimModalStyles>;
const ProfilimStylesCtx = React.createContext<ProfilimModalStylesResolved | null>(null);
function useProfilimStyles() {
  const s = useContext(ProfilimStylesCtx);
  if (!s) throw new Error("Profilim modal stilleri bağlamda değil.");
  return s;
}

export function ProfilimModal({
  visible,
  onClose,
  onSaved,
  onOpenCompose,
  initialContentSection,
  openProfileEditor = false,
}: Props) {
  const { lang } = useAppTheme();
  const palette = useThemeColors();
  const styles = useMemo(() => createProfilimModalStyles(palette), [palette]);

  const [form, setForm] = useState<StoredProfile>(() => {
    const peek = peekCachedProfile();
    if (!peek) return { ...DEFAULT_PROFILE };
    return {
      ...DEFAULT_PROFILE,
      ...peek,
      kullaniciAdi: normalizeUsername(peek.kullaniciAdi),
    };
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [cityIx, setCityIx] = useState(0);
  const [cityListOpen, setCityListOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [socialCounts, setSocialCounts] = useState({ mutual: 0, followers: 0, following: 0 });
  const [socialPanelOpen, setSocialPanelOpen] = useState(false);
  const [socialTab, setSocialTab] = useState<"mutual" | "followers" | "following">("mutual");
  const [followersList, setFollowersList] = useState<KisiAraPerson[]>([]);
  const [followingList, setFollowingList] = useState<KisiAraPerson[]>([]);
  const [socialListLoading, setSocialListLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<KisiAraPerson | null>(null);
  const [profilimFollowUi, setProfilimFollowUi] = useState<{ followed: boolean; pending: boolean }>({ followed: false, pending: false });
  const [socialSearch, setSocialSearch] = useState("");
  const [mySocialDetail, setMySocialDetail] = useState<SocialProfileDetail | null>(null);
  const [profileSection, setProfileSection] = useState<"home" | "personal" | "mine" | "liked" | "favorites" | "photos" | "videos" | "career">("home");
  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [sectionModalKey, setSectionModalKey] = useState<"home" | "personal" | "mine" | "liked" | "favorites" | "photos" | "videos" | "career">("home");
  const [photoViewerUri, setPhotoViewerUri] = useState("");
  const [pendingCareerCv, setPendingCareerCv] = useState<{ uri: string; name: string } | null>(null);
  const [careerSaving, setCareerSaving] = useState(false);
  const [profileFeed, setProfileFeed] = useState<CommentFeedItem[]>([]);
  const [feedOwnerKeys, setFeedOwnerKeys] = useState<string[]>([]);

  useLayoutEffect(() => {
    if (!visible) return;
    const warm = peekCachedProfile();
    if (!warm) return;
    setForm((prev) => {
      const next = { ...DEFAULT_PROFILE, ...prev, ...warm };
      const u = (warm.kullaniciAdi || prev.kullaniciAdi || "").trim();
      next.kullaniciAdi = u ? normalizeUsername(u) : "";
      const ph = (warm.photoUri || prev.photoUri || "").trim();
      if (ph) next.photoUri = ph;
      return next;
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const warm = peekCachedProfile();
    const hasWarmIdentity = !!(warm?.kullaniciAdi?.trim() || warm?.email?.trim());
    if (!hasWarmIdentity) setLoaded(false);
    setIsEditing(false);
    setProfileSection("home");
    void (async () => {
      const p = await loadProfile();
      const remote = await pullProfileFromFirestore();
      if (cancelled) return;
      const merged = { ...DEFAULT_PROFILE, ...(remote ?? {}), ...p };
      merged.kullaniciAdi = normalizeUsername(merged.kullaniciAdi);
      merged.photoUri = resolveAvatarUriForHome(p, remote ?? null);
      rememberProfileSnapshot(merged);
      setForm(merged);
      const ix = CITY_OPTIONS.findIndex((c) => c.toLocaleLowerCase("tr-TR") === merged.sehir.toLocaleLowerCase("tr-TR"));
      setCityIx(ix >= 0 ? ix : 0);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !loaded) return;
    if (openProfileEditor) {
      setIsEditing(true);
      setSectionModalOpen(false);
      return;
    }
    if (initialContentSection) {
      setProfileSection(initialContentSection);
      setSectionModalKey(initialContentSection);
      setSectionModalOpen(true);
      setIsEditing(false);
    }
  }, [visible, loaded, initialContentSection, openProfileEditor]);

  useEffect(() => {
    if (!visible) return;
    void getProfileSocialCounts()
      .then((c) => {
        setSocialCounts({ mutual: c.mutual, followers: c.followers, following: c.following });
      })
      .catch(() => {
        setSocialCounts({ mutual: 0, followers: 0, following: 0 });
      });
  }, [visible]);

  const refreshSocialLists = () => {
    if (!visible) return;
    setSocialListLoading(true);
    const listLoadFailsafe = setTimeout(() => {
      setSocialListLoading(false);
    }, 12_000);
    void (async () => {
      try {
        const [followers, following] = await Promise.all([getFollowersPeopleQuick(), getFollowingPeopleQuick()]);
        setFollowersList(followers);
        setFollowingList(following);
      } catch {
        setFollowersList([]);
        setFollowingList([]);
      } finally {
        clearTimeout(listLoadFailsafe);
        setSocialListLoading(false);
      }
      void Promise.all([getFollowersPeople(), getFollowingPeople()])
        .then(([followers, following]) => {
          setFollowersList(followers);
          setFollowingList(following);
        })
        .catch(() => {});
    })();
  };

  useEffect(() => {
    if (!visible) return;
    refreshSocialLists();
  }, [visible]);

  useEffect(() => {
    if (!selectedPerson?.userId) {
      setProfilimFollowUi({ followed: false, pending: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [f, pendMap] = await Promise.all([isFollowing(selectedPerson.userId), getOutgoingFollowPendingMap()]);
        if (cancelled) return;
        setProfilimFollowUi({ followed: f, pending: !!(pendMap && pendMap[selectedPerson.userId]) });
      } catch {
        if (!cancelled) setProfilimFollowUi({ followed: false, pending: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPerson]);

  useEffect(() => {
    if (!socialPanelOpen) return;
    refreshSocialLists();
  }, [socialPanelOpen]);

  useEffect(() => {
    if (!visible) return;
    void getSocialProfileDetail({
      userId: form.email || form.kullaniciAdi || "me",
      username: form.kullaniciAdi,
      displayName: form.adSoyad,
      email: form.email,
      photoUri: form.photoUri,
      followers: socialCounts.followers,
      following: socialCounts.following,
      mutual: socialCounts.mutual,
    })
      .then(setMySocialDetail)
      .catch(() => setMySocialDetail(null));
  }, [visible, form, socialCounts]);

  useEffect(() => {
    if (!visible) return;
    setPendingCareerCv(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let closed = false;
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        const actor = await resolveCommentActor();
        if (closed) return;
        setFeedOwnerKeys(actor.ownerKeys);
        unsub = await subscribeCommentFeed(
          (items) => {
            if (closed) return;
            setProfileFeed(items.slice(0, 240));
          },
          () => {
            if (closed) return;
            setProfileFeed([]);
          },
        );
      } catch {
        if (closed) return;
        setFeedOwnerKeys([]);
        setProfileFeed([]);
      }
    })();
    return () => {
      closed = true;
      setFeedOwnerKeys([]);
      if (unsub) unsub();
    };
  }, [visible]);

  const mutualList = useMemo(() => {
    const followingMap = new Map(followingList.map((p) => [p.userId, p]));
    return followersList.filter((p) => followingMap.has(p.userId));
  }, [followersList, followingList]);

  const socialShown = useMemo(() => {
    if (socialTab === "followers") return followersList;
    if (socialTab === "following") return followingList;
    return mutualList;
  }, [socialTab, followersList, followingList, mutualList]);
  const filteredSocialShown = useMemo(() => {
    const q = socialSearch.trim().toLocaleLowerCase("tr-TR");
    if (!q) return socialShown;
    return socialShown.filter((p) => {
      const hay = `${p.username} ${p.displayName} ${p.email}`.toLocaleLowerCase("tr-TR");
      return hay.includes(q);
    });
  }, [socialShown, socialSearch]);
  const sortedFeed = useMemo(() => [...profileFeed].sort((a, b) => b.createdAtMs - a.createdAtMs), [profileFeed]);
  const profileMyIds = useMemo(() => {
    if (!feedOwnerKeys.length) return new Set<string>();
    return new Set(profileFeed.filter((x) => commentFeedItemMatchesOwnerKeys(x, feedOwnerKeys)).map((x) => x.id));
  }, [profileFeed, feedOwnerKeys]);
  const myFeed = useMemo(() => sortedFeed.filter((x) => profileMyIds.has(x.id)), [sortedFeed, profileMyIds]);
  const likedFeed = useMemo(
    () =>
      sortedFeed
        .filter((x) => x.iLiked)
        .sort((a, b) => (b.iLikedAtMs || b.createdAtMs) - (a.iLikedAtMs || a.createdAtMs)),
    [sortedFeed],
  );
  const favoriteFeed = useMemo(
    () =>
      sortedFeed
        .filter((x) => x.iFavorited)
        .sort((a, b) => (b.iFavoritedAtMs || b.createdAtMs) - (a.iFavoritedAtMs || a.createdAtMs)),
    [sortedFeed],
  );
  const photoFeed = useMemo(
    () => myFeed.filter((x) => !!x.mediaUrl && x.mediaKind !== "video"),
    [myFeed],
  );
  const videoFeed = useMemo(
    () => myFeed.filter((x) => x.mediaKind === "video" && !!x.mediaUrl),
    [myFeed],
  );
  const isCorporate = form.uyelikTipi === "kurumsal";

  const bioLeft = useMemo(() => Math.max(0, 120 - (form.biyografi?.length ?? 0)), [form.biyografi]);

  const setField = <K extends keyof StoredProfile>(k: K, v: StoredProfile[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };
  const openSectionModal = (key: "home" | "personal" | "mine" | "liked" | "favorites" | "photos" | "videos" | "career") => {
    setProfileSection(key);
    setSectionModalKey(key);
    setSectionModalOpen(true);
  };

  const onSave = async () => {
    const fixed = { ...form, kullaniciAdi: normalizeUsername(form.kullaniciAdi) };
    if (!fixed.kullaniciAdi || !fixed.email.trim() || !fixed.adSoyad.trim() || !fixed.meslek.trim()) {
      Alert.alert("Eksik Zorunlu Alan", "Kullanıcı adı, e-mail, ad soyad ve meslek alanlarını doldurmalısınız.");
      return;
    }
    if (!fixed.kullaniciAdi.startsWith("@")) {
      Alert.alert("Eksik Bilgi", "Kullanıcı adı @ ile başlamalı.");
      return;
    }
    setSaving(true);
    try {
      await saveProfile(fixed);
      await pushProfileToFirestore(fixed);
      setForm(fixed);
      setIsEditing(false);
      if (onSaved) onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const onPickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("İzin Gerekli", "Profil fotoğrafı seçmek için galeri izni vermelisiniz.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (res.canceled || !res.assets?.length) return;
    let uri = res.assets[0]?.uri;
    if (!uri) return;
    /** APK/AAB: özellikle content:// veya geçici dosya yolları Image bileşeninde / yeniden açılışta kırılabilir; cache'e kopyala. */
    try {
      const cacheDir = FileSystem.cacheDirectory;
      const persistAndroid = Platform.OS === "android" && !!cacheDir;
      const persistIosTransient = uri.startsWith("ph://") || uri.startsWith("content://");
      if ((persistAndroid || persistIosTransient) && cacheDir) {
        const dest = `${cacheDir}profile-avatar-${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: uri, to: dest });
        uri = dest;
      }
    } catch {
      Alert.alert("Fotoğraf", "Seçilen görsel kaydedilemedi. İzinleri kontrol edip tekrar deneyin.");
      return;
    }
    setField("photoUri", uri);
  };

  const onRemovePhoto = () => setField("photoUri", "");

  const onPickCareerCv = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0]!;
    setPendingCareerCv({ uri: a.uri, name: a.name || "ozgecmis" });
  };

  const onSaveCareerCv = async () => {
    if (!pendingCareerCv?.uri) return;
    setCareerSaving(true);
    try {
      const next = {
        ...form,
        kariyerCvUri: pendingCareerCv.uri,
        kariyerCvName: pendingCareerCv.name || "ozgecmis",
      };
      await saveProfile(next);
      await pushProfileToFirestore(next);
      setForm(next);
      setPendingCareerCv(null);
      if (onSaved) onSaved();
      Alert.alert("Kariyer", "Özgeçmiş kaydedildi.");
    } catch {
      Alert.alert("Kariyer", "Özgeçmiş kaydedilemedi.");
    } finally {
      setCareerSaving(false);
    }
  };

  const onDeleteCareerCv = async () => {
    if (!form.kariyerCvUri && !pendingCareerCv?.uri) return;
    if (pendingCareerCv?.uri && !form.kariyerCvUri) {
      setPendingCareerCv(null);
      return;
    }
    setCareerSaving(true);
    try {
      const next = { ...form, kariyerCvUri: "", kariyerCvName: "" };
      await saveProfile(next);
      await pushProfileToFirestore(next);
      setForm(next);
      setPendingCareerCv(null);
      if (onSaved) onSaved();
      Alert.alert("Kariyer", "Özgeçmiş silindi.");
    } catch {
      Alert.alert("Kariyer", "Özgeçmiş silinemedi.");
    } finally {
      setCareerSaving(false);
    }
  };

  const onOpenCareerCv = async () => {
    const u = (form.kariyerCvUri || "").trim();
    if (!u) return;
    try {
      if (Platform.OS === "android" && u.startsWith("file://")) {
        const contentUri = await FileSystem.getContentUriAsync(u);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri,
          flags: 1,
        });
        return;
      }
      const ok = await Linking.canOpenURL(u);
      if (ok) {
        await Linking.openURL(u);
        return;
      }
      if (Platform.OS === "android" && !u.startsWith("file://")) {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: u,
          flags: 1,
        });
        return;
      }
      throw new Error("cannot-open");
    } catch {
      Alert.alert(isCorporate ? "İş İlanları" : "Kariyer", "Dosya açılamadı.");
    }
  };

  const parseDate = (s: string): Date => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s || "").trim());
    if (!m) return new Date();
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const y = Number(m[3]);
    return new Date(y, mo, d);
  };

  const formatDate = (dt: Date): string => {
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    return `${d}.${m}.${y}`;
  };

  return (
    <ProfilimStylesCtx.Provider value={styles}>
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.headerAction}>← Geri</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Profilim</Text>
          {isEditing ? (
            <Pressable onPress={onSave} disabled={saving || !loaded} hitSlop={10}>
              <Text style={[styles.headerAction, (saving || !loaded) && styles.headerActionDisabled]}>
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setIsEditing(true)} hitSlop={10}>
              <Text style={styles.headerAction}>Düzenle</Text>
            </Pressable>
          )}
        </View>

        {!isEditing ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.avatarCard}>
              <Pressable
                onPress={() =>
                  setSelectedPerson({
                    userId: form.email || form.kullaniciAdi || "me",
                    username: form.kullaniciAdi || "@kullanici",
                    displayName: form.adSoyad || "",
                    email: form.email || "",
                    photoUri: form.photoUri || "",
                    bio: form.biyografi || "",
                    company: form.kurum || "",
                    university: form.universite || "",
                    city: form.sehir || "",
                  })
                }
                style={styles.selfProfileTap}
              >
                <View style={styles.avatarCircle}>
                  {form.photoUri ? (
                    <Image source={{ uri: form.photoUri }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>
                      {(form.adSoyad || form.kullaniciAdi || "P")
                        .trim()
                        .slice(0, 1)
                        .toLocaleUpperCase("tr-TR")}
                    </Text>
                  )}
                </View>
                <View style={styles.profileNameRow}>
                  {(form.kullaniciAdi || "").trim() ? (
                    <Text style={styles.profileNameText}>{normalizeUsername(form.kullaniciAdi)}</Text>
                  ) : loaded ? (
                    <Text style={styles.profileNameText}>@kullaniciadi</Text>
                  ) : (
                    <ActivityIndicator size="small" color={palette.textMuted} />
                  )}
                </View>
              </Pressable>
              <View style={styles.socialStatsRow}>
                <Pressable
                  style={styles.socialStatItem}
                  onPress={() => {
                    setSocialTab("mutual");
                    setSocialSearch("");
                    setSocialPanelOpen(true);
                  }}
                >
                  <Text style={styles.socialStatValue}>{mutualList.length}</Text>
                  <Text style={styles.socialStatLabel}>{t(lang, "prof_mutual")}</Text>
                </Pressable>
                <Pressable
                  style={styles.socialStatItem}
                  onPress={() => {
                    setSocialTab("followers");
                    setSocialSearch("");
                    setSocialPanelOpen(true);
                  }}
                >
                  <Text style={styles.socialStatValue}>{followersList.length}</Text>
                  <Text style={styles.socialStatLabel}>{t(lang, "prof_followers")}</Text>
                </Pressable>
                <Pressable
                  style={styles.socialStatItem}
                  onPress={() => {
                    setSocialTab("following");
                    setSocialSearch("");
                    setSocialPanelOpen(true);
                  }}
                >
                  <Text style={styles.socialStatValue}>{followingList.length}</Text>
                  <Text style={styles.socialStatLabel}>{t(lang, "prof_following")}</Text>
                </Pressable>
              </View>
              <Text style={styles.bioText}>{form.biyografi || t(lang, "prof_bio_empty")}</Text>
            </View>
            <View style={styles.profileTabsWrap}>
              <View style={styles.profileTabsLine}>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "home" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("home")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                    {t(lang, "prof_tab_home")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "mine" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("mine")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                    {t(lang, "prof_tab_comments")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "videos" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("videos")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                    {t(lang, "prof_tab_videos")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "career" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("career")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                    {isCorporate ? t(lang, "prof_tab_career_corp") : t(lang, "prof_tab_career")}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.profileTabsLine}>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "personal" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("personal")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                    {t(lang, "prof_tab_bio")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "liked" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("liked")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                    {t(lang, "prof_tab_likes")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "photos" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("photos")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                    {t(lang, "prof_tab_photos")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.profileTabBtn, profileSection === "favorites" && styles.profileTabBtnActive]}
                  onPress={() => openSectionModal("favorites")}
                >
                  <Text style={styles.profileTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                    {t(lang, "prof_tab_favorites")}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.webLikeSections}>
              <Text style={styles.webLikeTitle}>Başlığa dokunarak tam ekran açın</Text>
              <Text style={styles.webLikeTxt}>{t(lang, "prof_hybrid_hint")}</Text>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.avatarCard}>
              <View style={styles.avatarCircle}>
                {form.photoUri ? (
                  <Image source={{ uri: form.photoUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>
                    {(form.adSoyad || form.kullaniciAdi || "P")
                      .trim()
                      .slice(0, 1)
                      .toLocaleUpperCase("tr-TR")}
                  </Text>
                )}
              </View>
              <View style={styles.avatarButtons}>
                <Pressable style={styles.secondaryBtn} onPress={() => void onPickPhoto()}>
                  <Text style={styles.secondaryBtnText}>Profil Fotoğrafı Ekle</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={onRemovePhoto}>
                  <Text style={styles.secondaryBtnText}>Profil Fotoğrafı Kaldır</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Temel Bilgiler</Text>
            <Field label="Kullanıcı Adı" required>
              <Input
                value={form.kullaniciAdi}
                onChangeText={(v) => setField("kullaniciAdi", normalizeUsername(v))}
                placeholder="@emrekaraca"
              />
            </Field>
            <Field label="Ad Soyad" required>
              <Input value={form.adSoyad} onChangeText={(v) => setField("adSoyad", v)} />
            </Field>
            <Field label="E-mail" required>
              <Input value={form.email} keyboardType="email-address" onChangeText={(v) => setField("email", v)} />
            </Field>
            <Field label="Telefon">
              <Input value={form.telefon} keyboardType="phone-pad" onChangeText={(v) => setField("telefon", v)} />
            </Field>
            <Field label="Doğum Tarihi">
              <Pressable style={styles.selectBtn} onPress={() => setDatePickerOpen(true)}>
                <Text style={styles.selectText}>{form.dogumTarihi || "GG.AA.YYYY"}</Text>
                <Text style={styles.selectHint}>Takvimden seç</Text>
              </Pressable>
            </Field>

            <Text style={styles.sectionTitle}>Eğitim ve Kariyer</Text>
            <Field label="Ünvan">
              <Input value={form.unvan} onChangeText={(v) => setField("unvan", v)} />
            </Field>
            <Field label="Meslek" required>
              <Input value={form.meslek} onChangeText={(v) => setField("meslek", v)} />
            </Field>
            <Field label="Çalıştığı Kurum/Firma">
              <Input value={form.kurum} onChangeText={(v) => setField("kurum", v)} />
            </Field>
            <Field label="Üniversite">
              <Input value={form.universite} onChangeText={(v) => setField("universite", v)} />
            </Field>
            <Field label="Şehir">
              <Pressable style={styles.selectBtn} onPress={() => setCityListOpen(true)}>
                <Text style={styles.selectText}>{form.sehir || CITY_OPTIONS[cityIx]}</Text>
                <Text style={styles.selectHint}>Listeden seç</Text>
              </Pressable>
            </Field>

            <Text style={styles.sectionTitle}>Sosyal Profil</Text>
            <Field label={`Biyografi (${bioLeft} karakter)`}>
              <Input
                value={form.biyografi}
                multiline
                maxLength={120}
                style={styles.textArea}
                onChangeText={(v) => setField("biyografi", v)}
              />
            </Field>
            <Field label="Sertifikalar">
              <Input value={form.sertifikalar} multiline style={styles.textArea} onChangeText={(v) => setField("sertifikalar", v)} />
            </Field>
            <Field label="Hobiler">
              <Input value={form.hobiler} multiline style={styles.textArea} onChangeText={(v) => setField("hobiler", v)} />
            </Field>
            <Field label="Profil Gizliliği">
              <Pressable style={styles.selectBtn} onPress={() => setField("gizlilik", nextPrivacy(form.gizlilik))}>
                <Text style={styles.selectText}>{PRIVACY_LABELS[form.gizlilik]}</Text>
                <Text style={styles.selectHint}>Dokun: seçenek değiştir</Text>
              </Pressable>
            </Field>
            <Field label="Üyelik Tipi">
              <Pressable
                style={styles.selectBtn}
                onPress={() => setField("uyelikTipi", form.uyelikTipi === "kurumsal" ? "bireysel" : "kurumsal")}
              >
                <Text style={styles.selectText}>{form.uyelikTipi === "kurumsal" ? "Kurumsal" : "Bireysel"}</Text>
                <Text style={styles.selectHint}>Dokun: Bireysel / Kurumsal</Text>
              </Pressable>
            </Field>
          </ScrollView>
        )}

        {isEditing && datePickerOpen ? (
          <DateTimePicker
            value={parseDate(form.dogumTarihi)}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(_, d) => {
              if (Platform.OS !== "ios") setDatePickerOpen(false);
              if (!d) return;
              setField("dogumTarihi", formatDate(d));
            }}
          />
        ) : null}
        <Modal visible={cityListOpen} transparent animationType="fade" onRequestClose={() => setCityListOpen(false)}>
          <View style={styles.cityOverlay}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setCityListOpen(false)} />
            <View style={styles.cityCard}>
              <Text style={styles.cityTitle}>Şehir Seç</Text>
              <FlatList
                data={CITY_OPTIONS}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => (
                  <Pressable
                    style={styles.cityRow}
                    onPress={() => {
                      setCityIx(index);
                      setField("sehir", item);
                      setCityListOpen(false);
                    }}
                  >
                    <Text style={styles.cityRowText}>{item}</Text>
                  </Pressable>
                )}
              />
            </View>
          </View>
        </Modal>
        <Modal visible={socialPanelOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setSocialPanelOpen(false)}>
          <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <View style={styles.socialCardFull}>
              <View style={styles.socialHead}>
                <Text style={styles.cityTitle}>Arkadaş Listesi</Text>
                <Pressable onPress={() => setSocialPanelOpen(false)} style={styles.socialCloseBtn}>
                  <Text style={styles.socialCloseTxt}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.socialTabs}>
                <Pressable
                  style={[styles.socialTabBtn, socialTab === "mutual" && styles.socialTabBtnActive]}
                  onPress={() => setSocialTab("mutual")}
                >
                  <Text style={styles.socialTabTxt}>
                    {t(lang, "prof_social_mutual")} ({mutualList.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.socialTabBtn, socialTab === "followers" && styles.socialTabBtnActive]}
                  onPress={() => setSocialTab("followers")}
                >
                  <Text style={styles.socialTabTxt}>
                    {t(lang, "prof_followers")} ({followersList.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.socialTabBtn, socialTab === "following" && styles.socialTabBtnActive]}
                  onPress={() => setSocialTab("following")}
                >
                  <Text style={styles.socialTabTxt}>
                    {t(lang, "prof_following")} ({followingList.length})
                  </Text>
                </Pressable>
              </View>
              <TextInput
                value={socialSearch}
                onChangeText={setSocialSearch}
                style={styles.socialSearchInput}
                placeholder="Kişi ara: kullanıcı adı / ad soyad / e-mail"
                placeholderTextColor={palette.textMuted}
              />
              {socialListLoading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="small" color={palette.textMuted} />
                  <Text style={styles.loadingText}>Arkadaş listesi yükleniyor...</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredSocialShown}
                  keyExtractor={(item) => item.userId}
                  ListEmptyComponent={<Text style={styles.socialEmpty}>Liste boş.</Text>}
                  renderItem={({ item }) => (
                    <Pressable style={styles.socialRow} onPress={() => setSelectedPerson(item)}>
                      <View style={styles.socialAvatarWrap}>
                        {item.photoUri ? (
                          <Image source={{ uri: item.photoUri }} style={styles.socialAvatarImg} />
                        ) : (
                          <Text style={styles.socialAvatarInitial}>
                            {(item.username || "@k").replace(/^@/, "").slice(0, 1).toLocaleUpperCase("tr-TR")}
                          </Text>
                        )}
                      </View>
                      <View style={styles.socialMeta}>
                        <Text style={styles.socialUser}>{item.username || "@kullanici"}</Text>
                        {item.displayName ? <Text style={styles.socialSub}>{item.displayName}</Text> : null}
                      </View>
                    </Pressable>
                  )}
                />
              )}
            </View>
          </SafeAreaView>
        </Modal>
        <SocialProfileModal
          visible={!!selectedPerson}
          person={selectedPerson}
          followed={profilimFollowUi.followed}
          followRequested={profilimFollowUi.pending}
          onClose={() => setSelectedPerson(null)}
          onMessage={(p) => onOpenCompose?.(p)}
          onFollow={async (p) => {
            try {
              await toggleFollow(p);
              refreshSocialLists();
              const [f, pendMap] = await Promise.all([isFollowing(p.userId), getOutgoingFollowPendingMap()]);
              setProfilimFollowUi({ followed: f, pending: !!(pendMap && pendMap[p.userId]) });
            } catch {
              Alert.alert("Takip", "İşlem tamamlanamadı.");
            }
          }}
        />
        <Modal visible={sectionModalOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setSectionModalOpen(false)}>
          <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <View style={styles.header}>
              <Pressable onPress={() => setSectionModalOpen(false)} hitSlop={10}>
                <Text style={styles.headerAction}>← Geri</Text>
              </Pressable>
              <Text style={styles.headerTitle}>
                {sectionModalKey === "home"
                  ? t(lang, "prof_tab_home")
                  : sectionModalKey === "personal"
                    ? t(lang, "prof_tab_bio")
                    : sectionModalKey === "mine"
                      ? t(lang, "prof_tab_comments")
                      : sectionModalKey === "liked"
                        ? t(lang, "prof_tab_likes")
                        : sectionModalKey === "favorites"
                          ? t(lang, "prof_tab_favorites")
                          : sectionModalKey === "photos"
                            ? t(lang, "prof_tab_photos")
                            : sectionModalKey === "videos"
                              ? t(lang, "prof_tab_videos")
                              : isCorporate
                                ? t(lang, "prof_tab_career_corp")
                                : t(lang, "prof_tab_career")}
              </Text>
              <View style={{ width: 48 }} />
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
              {sectionModalKey === "home" ? (
                <FeedSection
                  title={t(lang, "prof_feed_community")}
                  rows={sortedFeed.filter((x) => !x.parentId)}
                  allRows={sortedFeed}
                  myIds={profileMyIds}
                  onOpenProfile={setSelectedPerson}
                />
              ) : null}
              {sectionModalKey === "mine" ? (
                <FeedSection
                  title={t(lang, "prof_tab_comments")}
                  rows={sortedFeed.filter((x) => !x.parentId)}
                  allRows={sortedFeed}
                  myIds={profileMyIds}
                  onOpenProfile={setSelectedPerson}
                />
              ) : null}
              {sectionModalKey === "liked" ? (
                <FeedSection
                  title={t(lang, "prof_tab_likes")}
                  rows={likedFeed.filter((x) => !x.parentId)}
                  allRows={sortedFeed}
                  myIds={profileMyIds}
                  onOpenProfile={setSelectedPerson}
                />
              ) : null}
              {sectionModalKey === "favorites" ? (
                <FeedSection
                  title={t(lang, "prof_tab_favorites")}
                  rows={favoriteFeed.filter((x) => !x.parentId)}
                  allRows={sortedFeed}
                  myIds={profileMyIds}
                  onOpenProfile={setSelectedPerson}
                />
              ) : null}
              {sectionModalKey === "personal" ? (
                <>
                  <Info label="Ad Soyad" value={form.adSoyad} />
                  <Info label="E-mail" value={form.email} />
                  <Info label="Telefon" value={form.telefon} />
                  <Info label="Ünvan" value={form.unvan} />
                  <Info label="Meslek" value={form.meslek} />
                  <Info label="Şehir" value={form.sehir} />
                </>
              ) : null}
              {sectionModalKey === "photos" ? (
                <View style={styles.webLikeSections}>
                  <Text style={styles.webLikeTitle}>{t(lang, "prof_photos_title")}</Text>
                  {photoFeed.length ? (
                    <View style={styles.mediaGridMine}>
                      {photoFeed.map((x) => (
                        <Pressable key={x.id} onPress={() => setPhotoViewerUri(x.mediaUrl || "")}>
                          <Image source={{ uri: x.mediaUrl }} style={styles.mediaImgMine} />
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.webLikeTxt}>{t(lang, "prof_no_photos")}</Text>
                  )}
                </View>
              ) : null}
              {sectionModalKey === "videos" ? (
                <View style={styles.webLikeSections}>
                  <Text style={styles.webLikeTitle}>{t(lang, "prof_tab_videos")}</Text>
                  {videoFeed.length ? (
                    <View style={styles.sectionWrap}>
                      {videoFeed.map((x) => (
                        <VideoInlinePlayer key={x.id} uri={x.mediaUrl || ""} title={`${x.authorUsername} • ${new Date(x.createdAtMs).toLocaleString("tr-TR")}`} />
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.webLikeTxt}>{t(lang, "prof_no_videos")}</Text>
                  )}
                </View>
              ) : null}
              {sectionModalKey === "career" ? (
                <View style={styles.webLikeSections}>
                  <Text style={styles.webLikeTitle}>{isCorporate ? t(lang, "prof_tab_career_corp") : t(lang, "prof_tab_career")}</Text>
                  <Pressable style={styles.secondaryBtn} onPress={() => void onPickCareerCv()}>
                    <Text style={styles.secondaryBtnText}>{isCorporate ? "📎 İş İlanı Dosyası Yükle (PDF/Word)" : "📎 Özgeçmiş Yükle (PDF/Word)"}</Text>
                  </Pressable>
                  {pendingCareerCv ? (
                    <View style={styles.feedCard}>
                      <Text style={styles.feedUser}>Hazır dosya</Text>
                      <Text style={styles.feedText}>📄 {pendingCareerCv.name}</Text>
                    </View>
                  ) : null}
                  <View style={styles.careerActionRow}>
                    <Pressable
                      style={[styles.secondaryBtn, styles.careerSaveBtn, (careerSaving || !pendingCareerCv?.uri) && styles.secondaryBtnDisabled]}
                      onPress={() => void onSaveCareerCv()}
                      disabled={careerSaving || !pendingCareerCv?.uri}
                    >
                      <Text style={styles.secondaryBtnText}>{careerSaving ? "Kaydediliyor..." : "Kaydet"}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.secondaryBtn, styles.careerDeleteBtn, (careerSaving || (!form.kariyerCvUri && !pendingCareerCv?.uri)) && styles.secondaryBtnDisabled]}
                      onPress={() => void onDeleteCareerCv()}
                      disabled={careerSaving || (!form.kariyerCvUri && !pendingCareerCv?.uri)}
                    >
                      <Text style={styles.secondaryBtnText}>Sil</Text>
                    </Pressable>
                  </View>
                  {form.kariyerCvUri ? (
                    <View style={styles.feedCard}>
                      <Text style={styles.feedUser}>📄 {form.kariyerCvName || "ozgecmis"}</Text>
                      <Text style={styles.feedText}>
                        {isCorporate ? "İş ilanı PDF dosyası kayıtlı." : "Özgeçmiş PDF dosyası kayıtlı."}
                      </Text>
                      <View style={styles.careerActionRow}>
                        <Pressable style={[styles.secondaryBtn, styles.careerSaveBtn]} onPress={() => void onOpenCareerCv()}>
                          <Text style={styles.secondaryBtnText}>PDF Aç</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.webLikeTxt}>{isCorporate ? "Henüz iş ilanı dosyası yüklenmedi." : "Henüz özgeçmiş yüklenmedi."}</Text>
                  )}
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </Modal>
        </SafeAreaView>
        </Modal>
        <Modal visible={!!photoViewerUri} transparent animationType="fade" onRequestClose={() => setPhotoViewerUri("")}>
          <View style={styles.photoViewerOverlay}>
            <Pressable style={styles.photoViewerCloseBtn} onPress={() => setPhotoViewerUri("")}>
              <Text style={styles.photoViewerCloseTxt}>✕</Text>
            </Pressable>
            {photoViewerUri ? <Image source={{ uri: photoViewerUri }} style={styles.photoViewerImg} resizeMode="contain" /> : null}
          </View>
        </Modal>
    </>
    </ProfilimStylesCtx.Provider>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  const styles = useProfilimStyles();
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "—"}</Text>
    </View>
  );
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  const styles = useProfilimStyles();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.requiredStar}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Input({
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { style?: React.ComponentProps<typeof TextInput>["style"] }) {
  const styles = useProfilimStyles();
  const { textMuted } = useThemeColors();
  return <TextInput {...props} style={[styles.input, style]} placeholderTextColor={textMuted} />;
}


function FeedSection({
  title,
  rows,
  allRows,
  myIds,
  onOpenProfile,
}: {
  title: string;
  rows: CommentFeedItem[];
  allRows?: CommentFeedItem[];
  myIds: Set<string>;
  onOpenProfile?: (person: KisiAraPerson | null) => void;
}) {
  const styles = useProfilimStyles();
  const { textMuted } = useThemeColors();
  const [openId, setOpenId] = useState("");
  const [replyToId, setReplyToId] = useState("");
  const [quoteToId, setQuoteToId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [sending, setSending] = useState(false);
  const [busyLikeId, setBusyLikeId] = useState("");
  const [busyFavId, setBusyFavId] = useState("");
  const [optimisticById, setOptimisticById] = useState<Record<string, { iLiked?: boolean; iFavorited?: boolean; likeCount?: number; favoriteCount?: number }>>({});
  const [fullscreenItem, setFullscreenItem] = useState<CommentFeedItem | null>(null);
  const [photoViewerUri, setPhotoViewerUri] = useState("");
  const cachedDetailVideoUri = useCachedRemoteVideoUri(
    fullscreenItem?.mediaKind === "video" ? fullscreenItem.mediaUrl : undefined,
    fullscreenItem?.id ?? "",
  );
  const threadRows = useMemo(() => allRows || rows, [allRows, rows]);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, CommentFeedItem[]>();
    for (const r of threadRows) {
      if (!r.parentId) continue;
      const prev = m.get(r.parentId) || [];
      prev.push(r);
      m.set(r.parentId, prev);
    }
    for (const key of m.keys()) {
      m.set(key, (m.get(key) || []).sort((a, b) => a.createdAtMs - b.createdAtMs));
    }
    return m;
  }, [threadRows]);

  const fmt = (ms: number) =>
    ms
      ? new Date(ms).toLocaleString("tr-TR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Tarih yok";

  const onToggleLike = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const currentLiked = typeof prev.iLiked === "boolean" ? prev.iLiked : item.iLiked;
    const currentLikeCount = typeof prev.likeCount === "number" ? prev.likeCount : item.likeCount;
    const nextLiked = !currentLiked;
    const nextLikeCount = Math.max(0, currentLikeCount + (nextLiked ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: nextLiked, likeCount: nextLikeCount } }));
    setBusyLikeId(item.id);
    try {
      await toggleCommentLike(item.id, nextLiked, item.source);
    } catch {
      Alert.alert("Hata", "Beğeni işlemi yapılamadı.");
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: currentLiked, likeCount: currentLikeCount } }));
    } finally {
      setBusyLikeId("");
    }
  };

  const onToggleFavorite = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const currentFavorited = typeof prev.iFavorited === "boolean" ? prev.iFavorited : item.iFavorited;
    const currentFavoriteCount = typeof prev.favoriteCount === "number" ? prev.favoriteCount : item.favoriteCount;
    const nextFavorited = !currentFavorited;
    const nextFavoriteCount = Math.max(0, currentFavoriteCount + (nextFavorited ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: nextFavorited, favoriteCount: nextFavoriteCount } }));
    setBusyFavId(item.id);
    try {
      await toggleCommentFavorite(item.id, nextFavorited, item.source);
    } catch {
      Alert.alert("Hata", "Favori işlemi yapılamadı.");
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: currentFavorited, favoriteCount: currentFavoriteCount } }));
    } finally {
      setBusyFavId("");
    }
  };

  const onSendReply = async (item: CommentFeedItem) => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    setReplyText("");
    setReplyToId("");
    setOpenId(item.id);
    void publishComment({
      text,
      topic: item.topic,
      parentId: item.id,
    })
      .catch(() => {
        Alert.alert("Hata", "Yanıt gönderilemedi.");
      })
      .finally(() => {
        setSending(false);
      });
  };

  const onSendQuote = async (item: CommentFeedItem) => {
    const text = quoteText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await publishComment({
        text,
        topic: item.topic,
        quoteOfId: item.id,
        quoteOfText: item.text,
        quoteOfUsername: item.authorUsername,
      });
      setQuoteText("");
      setOpenId(item.id);
      setQuoteToId("");
    } catch {
      Alert.alert("Hata", "Alıntı gönderilemedi.");
    } finally {
      setSending(false);
    }
  };

  const onSaveEdit = async (item: CommentFeedItem) => {
    const text = editingText.trim();
    if (!text) return;
    try {
      await updateMyComment(item.id, text, item.source);
      setEditingId("");
      setEditingText("");
    } catch {
      Alert.alert("Hata", "Yorum güncellenemedi.");
    }
  };

  const onAskDelete = (item: CommentFeedItem) => {
    Alert.alert("Yorumu Sil", "Bu yorumu silmek istiyor musunuz?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          void deleteMyComment(item.id, item.source).catch(() => Alert.alert("Hata", "Yorum silinemedi."));
        },
      },
    ]);
  };

  return (
    <>
    <View style={styles.webLikeSections}>
      <Text style={styles.webLikeTitle}>{title}</Text>
      {rows.length ? (
        rows.map((item) => (
          <Pressable
            key={item.id}
            style={styles.feedCard}
            onPress={() => {
              setFullscreenItem(item);
            }}
          >
            {(() => {
              const optimistic = optimisticById[item.id] || {};
              const liked = typeof optimistic.iLiked === "boolean" ? optimistic.iLiked : item.iLiked;
              const favorited = typeof optimistic.iFavorited === "boolean" ? optimistic.iFavorited : item.iFavorited;
              const likeCount = typeof optimistic.likeCount === "number" ? optimistic.likeCount : item.likeCount;
              const favoriteCount = typeof optimistic.favoriteCount === "number" ? optimistic.favoriteCount : item.favoriteCount;
              return (
                <>
            <View style={styles.feedTopRow}>
              <View style={styles.feedUserWrap}>
                <Pressable
                  onPress={() =>
                    onOpenProfile?.({
                      userId: item.authorUserId || item.id,
                      username: item.authorUsername || "@kullanici",
                      displayName: "",
                      email: "",
                      photoUri: item.authorPhotoUri || "",
                      bio: "",
                      company: "",
                      university: "",
                      city: "",
                    })
                  }
                >
                  {item.authorPhotoUri ? (
                    <Image source={{ uri: item.authorPhotoUri }} style={styles.feedAvatar} />
                  ) : (
                    <View style={styles.feedAvatarFallback}>
                      <Text style={styles.feedAvatarInitial}>
                        {(item.authorUsername || "@k").replace(/^@/, "").slice(0, 1).toLocaleUpperCase("tr-TR")}
                      </Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() =>
                    onOpenProfile?.({
                      userId: item.authorUserId || item.id,
                      username: item.authorUsername || "@kullanici",
                      displayName: "",
                      email: "",
                      photoUri: item.authorPhotoUri || "",
                      bio: "",
                      company: "",
                      university: "",
                      city: "",
                    })
                  }
                >
                  <Text style={styles.feedUser}>{item.authorUsername}</Text>
                </Pressable>
              </View>
              <Text style={styles.feedDate}>{fmt(item.createdAtMs)}</Text>
            </View>
            {editingId === item.id ? (
              <TextInput
                value={editingText}
                onChangeText={setEditingText}
                multiline
                style={styles.feedEditInput}
                placeholderTextColor={textMuted}
              />
            ) : (
              <Text style={styles.feedText}>{item.text}</Text>
            )}
            {item.mediaUrl ? (
              item.mediaKind === "video" ? (
                <View style={styles.feedMediaVideoWrap}>
                  <Video
                    source={{ uri: item.mediaUrl }}
                    style={styles.feedMediaVideo}
                    useNativeControls
                    resizeMode={ResizeMode.CONTAIN}
                  />
                  <View pointerEvents="none" style={styles.feedMediaVideoOverlay}>
                    <Text style={styles.feedMediaVideoOverlayTxt}>▶ Oynat</Text>
                  </View>
                </View>
              ) : (
                <Image source={{ uri: item.mediaUrl }} style={styles.feedMediaImage} />
              )
            ) : null}
            <View style={styles.feedMetaRow}>
              <Pressable style={[styles.feedMetaPill, liked && styles.feedLikePill]} onPress={() => void onToggleLike(item)} disabled={busyLikeId === item.id}>
                <Text style={[styles.feedMetaIcon, liked && styles.feedLikeTxt]}>{liked ? "♥" : "♡"} {likeCount}</Text>
              </Pressable>
              <Pressable style={[styles.feedMetaPill, favorited && styles.feedFavPill]} onPress={() => void onToggleFavorite(item)} disabled={busyFavId === item.id}>
                <Text style={[styles.feedMetaIcon, favorited && styles.feedFavTxt]}>{favorited ? "★" : "☆"} {favoriteCount}</Text>
              </Pressable>
              <Pressable style={styles.feedMetaPill} onPress={() => {
                setQuoteToId((x) => (x === item.id ? "" : item.id));
                setReplyToId("");
                setOpenId(item.id);
              }}>
                <Text style={styles.feedMetaIcon}>❝</Text>
              </Pressable>
              <Pressable style={styles.feedMetaPill} onPress={() => {
                setReplyToId((x) => (x === item.id ? "" : item.id));
                setQuoteToId("");
                setOpenId(item.id);
              }}>
                <Text style={styles.feedMetaIcon}>💬 {item.replyCount}</Text>
              </Pressable>
            </View>
            {myIds.has(item.id) ? (
              <View style={styles.feedActionRow}>
                {editingId === item.id ? (
                  <>
                    <Pressable style={[styles.feedActionBtn, styles.feedCancelBtn]} onPress={() => { setEditingId(""); setEditingText(""); }}>
                      <Text style={styles.feedActionTxt}>✕</Text>
                    </Pressable>
                    <Pressable style={[styles.feedActionBtn, styles.feedSaveBtn]} onPress={() => void onSaveEdit(item)}>
                      <Text style={styles.feedActionTxt}>💾</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable style={[styles.feedActionBtn, styles.feedEditBtn]} onPress={() => { setEditingId(item.id); setEditingText(item.text); }}>
                      <Text style={styles.feedActionTxt}>✎</Text>
                    </Pressable>
                    <Pressable style={[styles.feedActionBtn, styles.feedDeleteBtn]} onPress={() => onAskDelete(item)}>
                      <Text style={styles.feedActionTxt}>🗑</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}
            {openId === item.id ? (
              <View style={styles.threadComposer}>
                {quoteToId === item.id ? (
                  <>
                    <Text style={styles.threadTitle}>Alıntı ile yorum yaz</Text>
                    <TextInput
                      value={quoteText}
                      onChangeText={setQuoteText}
                      placeholder="Alıntı yorumunuzu yaz..."
                      placeholderTextColor={textMuted}
                      multiline
                      style={styles.threadInput}
                    />
                    <Pressable style={styles.threadSendBtn} onPress={() => void onSendQuote(item)} disabled={sending}>
                      <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Alıntıyı Gönder"}</Text>
                    </Pressable>
                  </>
                ) : null}
                {replyToId === item.id ? (
                  <>
                    <Text style={styles.threadTitle}>Yoruma devam et</Text>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Yorumun altına yaz..."
                      placeholderTextColor={textMuted}
                      multiline
                      style={styles.threadInput}
                    />
                    <Pressable style={styles.threadSendBtn} onPress={() => void onSendReply(item)} disabled={sending}>
                      <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Yanıt Gönder"}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
            {openId === item.id && (repliesByParent.get(item.id) || []).length ? (
              <View style={styles.repliesWrap}>
                {(repliesByParent.get(item.id) || []).map((r) => {
                  const ropt = optimisticById[r.id] || {};
                  const rLiked = typeof ropt.iLiked === "boolean" ? ropt.iLiked : r.iLiked;
                  const rFav = typeof ropt.iFavorited === "boolean" ? ropt.iFavorited : r.iFavorited;
                  const rLikeCount = typeof ropt.likeCount === "number" ? ropt.likeCount : r.likeCount;
                  const rFavCount = typeof ropt.favoriteCount === "number" ? ropt.favoriteCount : r.favoriteCount;
                  return (
                    <View key={r.id} style={styles.replyBubble}>
                      <Text style={styles.replyMeta}>{r.authorUsername} • {fmt(r.createdAtMs)}</Text>
                      <Text style={styles.replyText}>{r.text}</Text>
                      <View style={styles.replyActionsRow}>
                        <Pressable style={styles.replyActionPill} onPress={() => void onToggleLike(r)} disabled={busyLikeId === r.id}>
                          <Text style={[styles.replyActionTxt, rLiked && styles.feedLikeTxt]}>{rLiked ? "♥" : "♡"} {rLikeCount}</Text>
                        </Pressable>
                        <Pressable style={styles.replyActionPill} onPress={() => void onToggleFavorite(r)} disabled={busyFavId === r.id}>
                          <Text style={[styles.replyActionTxt, rFav && styles.feedFavTxt]}>{rFav ? "★" : "☆"} {rFavCount}</Text>
                        </Pressable>
                        <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((x) => (x === r.id ? "" : r.id)); setQuoteToId(""); setOpenId(item.id); }}>
                          <Text style={styles.replyActionTxt}>💬</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
                </>
              );
            })()}
          </Pressable>
        ))
      ) : (
        <Text style={styles.webLikeTxt}>Kayıt bulunamadı.</Text>
      )}
    </View>
    <Modal
      visible={!!fullscreenItem}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setFullscreenItem(null)}
    >
      <SafeAreaView style={styles.fullscreenSafe} edges={["top", "left", "right"]}>
        <View style={styles.fullscreenHeader}>
          <Pressable onPress={() => setFullscreenItem(null)} hitSlop={10}>
            <Text style={styles.headerAction}>← Geri</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Yorum Detayı</Text>
          <View style={styles.headerGhost} />
        </View>
        {fullscreenItem ? (
          <ScrollView contentContainerStyle={styles.fullscreenBody}>
            {(() => {
              const optimistic = optimisticById[fullscreenItem.id] || {};
              const liked = typeof optimistic.iLiked === "boolean" ? optimistic.iLiked : fullscreenItem.iLiked;
              const favorited = typeof optimistic.iFavorited === "boolean" ? optimistic.iFavorited : fullscreenItem.iFavorited;
              const likeCount = typeof optimistic.likeCount === "number" ? optimistic.likeCount : fullscreenItem.likeCount;
              const favoriteCount = typeof optimistic.favoriteCount === "number" ? optimistic.favoriteCount : fullscreenItem.favoriteCount;
              return (
                <>
                  <Text style={styles.fullscreenUser}>{fullscreenItem.authorUsername}</Text>
                  <Text style={styles.fullscreenDate}>{fmt(fullscreenItem.createdAtMs)}</Text>
                  <Text style={styles.fullscreenText}>{fullscreenItem.text}</Text>
                  {fullscreenItem.mediaUrl ? (
                    fullscreenItem.mediaKind === "video" ? (
                      <Video
                        source={{ uri: cachedDetailVideoUri || fullscreenItem.mediaUrl || "" }}
                        style={styles.fullscreenMediaVideo}
                        useNativeControls
                        resizeMode={ResizeMode.CONTAIN}
                        progressUpdateIntervalMillis={250}
                      />
                    ) : (
                      <Pressable onPress={() => setPhotoViewerUri(fullscreenItem.mediaUrl || "")}>
                        <Image source={{ uri: fullscreenItem.mediaUrl }} style={styles.fullscreenMediaImage} />
                      </Pressable>
                    )
                  ) : null}
                  <View style={styles.feedMetaRow}>
                    <Pressable style={[styles.feedMetaPill, liked && styles.feedLikePill]} onPress={() => void onToggleLike(fullscreenItem)} disabled={busyLikeId === fullscreenItem.id}>
                      <Text style={[styles.feedMetaIcon, liked && styles.feedLikeTxt]}>{liked ? "♥" : "♡"} {likeCount}</Text>
                    </Pressable>
                    <Pressable style={[styles.feedMetaPill, favorited && styles.feedFavPill]} onPress={() => void onToggleFavorite(fullscreenItem)} disabled={busyFavId === fullscreenItem.id}>
                      <Text style={[styles.feedMetaIcon, favorited && styles.feedFavTxt]}>{favorited ? "★" : "☆"} {favoriteCount}</Text>
                    </Pressable>
                    <Pressable style={styles.feedMetaPill} onPress={() => { setQuoteToId((x) => (x === fullscreenItem.id ? "" : fullscreenItem.id)); setReplyToId(""); setOpenId(fullscreenItem.id); }}>
                      <Text style={styles.feedMetaIcon}>❝</Text>
                    </Pressable>
                    <Pressable style={styles.feedMetaPill} onPress={() => { setReplyToId((x) => (x === fullscreenItem.id ? "" : fullscreenItem.id)); setQuoteToId(""); setOpenId(fullscreenItem.id); }}>
                      <Text style={styles.feedMetaIcon}>💬 {fullscreenItem.replyCount}</Text>
                    </Pressable>
                  </View>
                  {myIds.has(fullscreenItem.id) ? (
                    <View style={styles.feedActionRow}>
                      {editingId === fullscreenItem.id ? (
                        <>
                          <Pressable style={[styles.feedActionBtn, styles.feedCancelBtn]} onPress={() => { setEditingId(""); setEditingText(""); }}>
                            <Text style={styles.feedActionTxt}>✕</Text>
                          </Pressable>
                          <Pressable style={[styles.feedActionBtn, styles.feedSaveBtn]} onPress={() => void onSaveEdit(fullscreenItem)}>
                            <Text style={styles.feedActionTxt}>💾</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable style={[styles.feedActionBtn, styles.feedEditBtn]} onPress={() => { setEditingId(fullscreenItem.id); setEditingText(fullscreenItem.text); }}>
                            <Text style={styles.feedActionTxt}>✎</Text>
                          </Pressable>
                          <Pressable style={[styles.feedActionBtn, styles.feedDeleteBtn]} onPress={() => onAskDelete(fullscreenItem)}>
                            <Text style={styles.feedActionTxt}>🗑</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}
                  {openId === fullscreenItem.id ? (
                    <View style={styles.threadComposer}>
                      {quoteToId === fullscreenItem.id ? (
                        <>
                          <Text style={styles.threadTitle}>Alıntı ile yorum yaz</Text>
                          <TextInput value={quoteText} onChangeText={setQuoteText} placeholder="Alıntı yorumunuzu yaz..." placeholderTextColor={textMuted} multiline style={styles.threadInput} />
                          <Pressable style={styles.threadSendBtn} onPress={() => void onSendQuote(fullscreenItem)} disabled={sending}>
                            <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Alıntıyı Gönder"}</Text>
                          </Pressable>
                        </>
                      ) : null}
                      {replyToId === fullscreenItem.id ? (
                        <>
                          <Text style={styles.threadTitle}>Yoruma devam et</Text>
                          <TextInput value={replyText} onChangeText={setReplyText} placeholder="Yorumun altına yaz..." placeholderTextColor={textMuted} multiline style={styles.threadInput} />
                          <Pressable style={styles.threadSendBtn} onPress={() => void onSendReply(fullscreenItem)} disabled={sending}>
                            <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Yanıt Gönder"}</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                  {(repliesByParent.get(fullscreenItem.id) || []).length ? (
                    <View style={styles.repliesWrap}>
                      {(repliesByParent.get(fullscreenItem.id) || []).map((r) => {
                        const ropt = optimisticById[r.id] || {};
                        const rLiked = typeof ropt.iLiked === "boolean" ? ropt.iLiked : r.iLiked;
                        const rFav = typeof ropt.iFavorited === "boolean" ? ropt.iFavorited : r.iFavorited;
                        const rLikeCount = typeof ropt.likeCount === "number" ? ropt.likeCount : r.likeCount;
                        const rFavCount = typeof ropt.favoriteCount === "number" ? ropt.favoriteCount : r.favoriteCount;
                        return (
                          <View key={r.id} style={styles.replyBubble}>
                            <Text style={styles.replyMeta}>{r.authorUsername} • {fmt(r.createdAtMs)}</Text>
                            <Text style={styles.replyText}>{r.text}</Text>
                            <View style={styles.replyActionsRow}>
                              <Pressable style={styles.replyActionPill} onPress={() => void onToggleLike(r)} disabled={busyLikeId === r.id}>
                                <Text style={[styles.replyActionTxt, rLiked && styles.feedLikeTxt]}>{rLiked ? "♥" : "♡"} {rLikeCount}</Text>
                              </Pressable>
                              <Pressable style={styles.replyActionPill} onPress={() => void onToggleFavorite(r)} disabled={busyFavId === r.id}>
                                <Text style={[styles.replyActionTxt, rFav && styles.feedFavTxt]}>{rFav ? "★" : "☆"} {rFavCount}</Text>
                              </Pressable>
                              <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((x) => (x === r.id ? "" : r.id)); setQuoteToId(""); setOpenId(fullscreenItem.id); }}>
                                <Text style={styles.replyActionTxt}>💬</Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </>
              );
            })()}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
    <Modal visible={!!photoViewerUri} transparent animationType="fade" onRequestClose={() => setPhotoViewerUri("")}>
      <View style={styles.mediaViewerOverlay}>
        {photoViewerUri ? <Image source={{ uri: photoViewerUri }} style={styles.mediaViewerImage} resizeMode="contain" /> : null}
        <Pressable style={styles.mediaViewerCloseBtn} onPress={() => setPhotoViewerUri("")}>
          <Text style={styles.mediaViewerCloseTxt}>Kapat</Text>
        </Pressable>
      </View>
    </Modal>
    </>
  );
}

function VideoInlinePlayer({ uri, title }: { uri: string; title: string }) {
  const styles = useProfilimStyles();
  const playerRef = useRef<Video | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [fullOpen, setFullOpen] = useState(false);

  const onStatus = (s: AVPlaybackStatus) => {
    if (!s.isLoaded) return;
    setReady(true);
    setPlaying(!!s.isPlaying);
    setPositionMs(s.positionMillis ?? 0);
    setDurationMs(s.durationMillis ?? 0);
  };

  return (
    <View style={styles.inlineVideoCard}>
      <Text style={styles.feedUser}>{title}</Text>
      <Pressable onPress={() => setFullOpen(true)}>
        <Video
          ref={playerRef}
          source={{ uri }}
          style={styles.inlineVideo}
          useNativeControls={false}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={onStatus}
        />
      </Pressable>
      <View style={styles.inlineVideoControls}>
        <Pressable
          style={styles.inlineVideoBtn}
          onPress={() => {
            if (!playerRef.current) return;
            const next = Math.max(0, positionMs - 10000);
            void playerRef.current.setPositionAsync(next);
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>« 10 sn</Text>
        </Pressable>
        <Pressable
          style={styles.inlineVideoBtn}
          onPress={() => {
            if (!playerRef.current) return;
            if (playing) {
              void playerRef.current.pauseAsync();
            } else {
              void playerRef.current.playAsync();
            }
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>{playing ? "Pause" : "Play"}</Text>
        </Pressable>
        <Pressable
          style={styles.inlineVideoBtn}
          onPress={() => {
            if (!playerRef.current) return;
            const max = durationMs > 0 ? durationMs : positionMs + 10000;
            const next = Math.min(max, positionMs + 10000);
            void playerRef.current.setPositionAsync(next);
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>10 sn »</Text>
        </Pressable>
      </View>
      <View style={styles.inlineVideoControls}>
        <Pressable style={styles.inlineVideoBtn}>
          <Text style={styles.inlineVideoBtnTxt}>{`${Math.floor(positionMs / 1000)}s / ${Math.max(1, Math.floor(durationMs / 1000))}s`}</Text>
        </Pressable>
        <Pressable style={styles.inlineVideoBtn} onPress={() => setFullOpen(true)}>
          <Text style={styles.inlineVideoBtnTxt}>Tam Ekran</Text>
        </Pressable>
        {!ready ? <Text style={styles.webLikeTxt}>Yükleniyor...</Text> : null}
      </View>
      <Modal visible={fullOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFullOpen(false)}>
        <SafeAreaView style={styles.fullscreenSafe} edges={["top", "left", "right"]}>
          <View style={styles.fullscreenHeader}>
            <Pressable onPress={() => setFullOpen(false)} hitSlop={10}>
              <Text style={styles.headerAction}>← Geri</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Video</Text>
            <View style={styles.headerGhost} />
          </View>
          <Video source={{ uri }} style={styles.mediaViewerVideo} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
