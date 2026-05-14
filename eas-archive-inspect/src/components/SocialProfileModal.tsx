import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video, type AVPlaybackStatus } from "expo-av";
import type { KisiAraPerson } from "../lib/kisiAraFirestore";
import { isCurrentUserTargetProfile, isFollowing, resolveStableTargetUserId } from "../lib/kisiAraFirestore";
import { useThemeColors } from "../theme/ThemeProvider";
import { createSocialProfileModalStyles } from "./socialProfileModalStyles";
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
  updateMyComment,
  type CommentFeedItem,
} from "../lib/commentsFirestore";

type Props = {
  visible: boolean;
  person: KisiAraPerson | null;
  followRequested?: boolean;
  followed?: boolean;
  blocked?: boolean;
  onClose: () => void;
  onMessage?: (person: KisiAraPerson) => void;
  onFollow?: (person: KisiAraPerson) => void;
  onBlockToggle?: (person: KisiAraPerson, nextBlocked: boolean) => void;
};

function getInitial(p: KisiAraPerson): string {
  const x = (p.username || p.displayName || p.email || "").replace(/^@/, "").trim();
  return x ? x[0]!.toLocaleUpperCase("tr-TR") : "?";
}

function stubDetailFromPerson(p: KisiAraPerson): SocialProfileDetail {
  return {
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    email: p.email,
    photoUri: p.photoUri,
    phone: "",
    title: "",
    profession: "",
    company: "",
    university: "",
    city: "",
    bio: "",
    followers: 0,
    following: 0,
    mutual: 0,
    photos: [],
    videos: [],
    comments: [],
    careerItems: [],
    memberType: "bireysel",
    gizlilik: "herkese_acik",
  };
}

type PrivacyMode = "full" | "hidden" | "followers_only";

export function SocialProfileModal({ visible, person, followRequested, followed, blocked, onClose, onMessage, onFollow, onBlockToggle }: Props) {
  const [activeSection, setActiveSection] = useState<
    "home" | "personal" | "comments" | "likes" | "favorites" | "photos" | "videos" | "career"
  >("home");
  const [detail, setDetail] = useState<SocialProfileDetail | null>(null);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("full");
  const [socialFeedUnlocked, setSocialFeedUnlocked] = useState(false);
  const [rawFeed, setRawFeed] = useState<CommentFeedItem[]>([]);
  const [feedOwnerKeys, setFeedOwnerKeys] = useState<string[]>([]);
  const feed = useMemo(() => rawFeed.filter((x) => !x.parentId), [rawFeed]);
  const myIds = useMemo(() => {
    if (!feedOwnerKeys.length) return new Set<string>();
    return new Set(rawFeed.filter((x) => commentFeedItemMatchesOwnerKeys(x, feedOwnerKeys)).map((x) => x.id));
  }, [rawFeed, feedOwnerKeys]);

  const personLoadKey = useMemo(() => {
    if (!person) return "";
    return [
      (person.userId || "").trim(),
      (person.username || "").trim().toLocaleLowerCase("tr-TR"),
      (person.email || "").trim().toLocaleLowerCase("tr-TR"),
    ].join("|");
  }, [person]);

  useEffect(() => {
    if (!visible) {
      setDetail(null);
      setSocialFeedUnlocked(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !person) return;
    let closed = false;
    setActiveSection("home");
    setDetail(stubDetailFromPerson(person));
    setPrivacyMode("full");
    setSocialFeedUnlocked(false);

    const runHeavy = (stable: string) => {
      void getSocialProfileDetail(
        {
          userId: stable,
          username: person.username,
          displayName: person.displayName,
          email: person.email,
          photoUri: person.photoUri,
        },
        { skipHeavyFeedScan: false },
      ).then((dFull) => {
        if (closed) return;
        setDetail(dFull);
      });
    };

    void (async () => {
      try {
        const stableId = await resolveStableTargetUserId(person);
        const dLite = await getSocialProfileDetail(
          {
            userId: stableId,
            username: person.username,
            displayName: person.displayName,
            email: person.email,
            photoUri: person.photoUri,
          },
          { skipHeavyFeedScan: true },
        );
        if (closed) return;
        const self = await isCurrentUserTargetProfile(stableId);
        if (self) {
          setDetail(dLite);
          setPrivacyMode("full");
          setSocialFeedUnlocked(true);
          runHeavy(stableId);
          return;
        }
        if (dLite.gizlilik === "gizli") {
          setDetail(dLite);
          setPrivacyMode("hidden");
          setSocialFeedUnlocked(false);
          return;
        }
        if (dLite.gizlilik === "sadece_takipciler") {
          const amFollower = await isFollowing(stableId);
          if (closed) return;
          setDetail(dLite);
          if (amFollower) {
            setPrivacyMode("full");
            setSocialFeedUnlocked(true);
            runHeavy(stableId);
          } else {
            setPrivacyMode("followers_only");
            setSocialFeedUnlocked(false);
          }
          return;
        }
        setDetail(dLite);
        setPrivacyMode("full");
        setSocialFeedUnlocked(true);
        runHeavy(stableId);
      } catch {
        if (!closed) {
          setDetail(person ? stubDetailFromPerson(person) : null);
          setPrivacyMode("full");
          setSocialFeedUnlocked(true);
        }
      }
    })();
    return () => {
      closed = true;
    };
  }, [visible, personLoadKey]);

  /** Takip durumu üst bileşenden güncellenince tam içerik açılsın (`followed` profil yüklemesini iptal etmesin diye ayrı). */
  useEffect(() => {
    if (!visible || privacyMode !== "followers_only") return;
    if (!followed) return;
    setPrivacyMode("full");
    setSocialFeedUnlocked(true);
    if (person) {
      void resolveStableTargetUserId(person).then((stableId) => {
        void getSocialProfileDetail(
          {
            userId: stableId,
            username: person.username,
            displayName: person.displayName,
            email: person.email,
            photoUri: person.photoUri,
          },
          { skipHeavyFeedScan: false },
        ).then((dFull) => setDetail(dFull));
      });
    }
  }, [visible, followed, privacyMode, person]);
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
            setRawFeed(items);
          },
          () => {
            if (closed) return;
            setRawFeed([]);
          },
        );
      } catch {
        if (closed) return;
        setFeedOwnerKeys([]);
        setRawFeed([]);
      }
    })();
    return () => {
      closed = true;
      setFeedOwnerKeys([]);
      if (unsub) unsub();
    };
  }, [visible]);
  const renderFull = privacyMode === "full";
  const shown =
    detail || (person ? stubDetailFromPerson(person) : null);
  const personKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!renderFull || !detail || !socialFeedUnlocked) return keys;
    const uid = (detail.userId || "").trim().toLocaleLowerCase("tr-TR");
    const uname = (detail.username || "").trim().toLocaleLowerCase("tr-TR");
    const unameBare = uname.startsWith("@") ? uname.slice(1) : uname;
    if (uid) keys.add(uid);
    if (uname) keys.add(uname);
    if (unameBare) keys.add(unameBare);
    return keys;
  }, [renderFull, detail, socialFeedUnlocked]);
  const personFeed = useMemo(
    () =>
      feed
        .filter((x) => {
          const u1 = (x.authorUserId || "").toLocaleLowerCase("tr-TR");
          const u2 = (x.authorUsername || "").toLocaleLowerCase("tr-TR");
          const u2b = u2.startsWith("@") ? u2.slice(1) : u2;
          return personKeys.has(u1) || personKeys.has(u2) || personKeys.has(u2b);
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    [feed, personKeys],
  );
  const personLiked = useMemo(
    () =>
      feed
        .filter((x) => x.likedByKeys.some((k) => personKeys.has((k || "").toLocaleLowerCase("tr-TR"))))
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    [feed, personKeys],
  );
  const personFavorites = useMemo(
    () =>
      feed
        .filter((x) => x.favoritedByKeys.some((k) => personKeys.has((k || "").toLocaleLowerCase("tr-TR"))))
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    [feed, personKeys],
  );
  const personPhotos = useMemo(() => personFeed.filter((x) => !!x.mediaUrl && x.mediaKind !== "video"), [personFeed]);
  const personVideos = useMemo(() => personFeed.filter((x) => x.mediaKind === "video" && !!x.mediaUrl), [personFeed]);

  const headerTitle = useMemo(() => {
    if (!shown) return "Profil";
    if (privacyMode === "full") return shown.displayName || shown.username || "Profil";
    if (privacyMode === "hidden") return "Gizli profil";
    return shown.username || "Profil";
  }, [shown, privacyMode]);

  const palette = useThemeColors();
  const styles = useMemo(() => createSocialProfileModalStyles(palette), [palette]);

  const kisiFromShown = (): KisiAraPerson => ({
    userId: shown!.userId,
    username: shown!.username,
    displayName: shown!.displayName,
    email: shown!.email,
    photoUri: shown!.photoUri,
    bio: "",
    company: "",
    university: "",
    city: "",
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{headerTitle}</Text>
            <Pressable onPress={onClose} style={styles.iconBtn}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>
          {shown ? (
            <>
              {privacyMode === "hidden" || privacyMode === "followers_only" ? (
                <>
                  <View style={styles.top}>
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarPrivacyGlyph}>{privacyMode === "hidden" ? "🔒" : "👥"}</Text>
                    </View>
                    {privacyMode === "followers_only" ? (
                      <Text style={styles.username}>{shown.username || "@kullanici"}</Text>
                    ) : null}
                  </View>
                  <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    <Text style={styles.privacyMsg}>
                      {privacyMode === "hidden"
                        ? "Bu kullanıcı profilini herkesten gizlemiştir. Profil içeriği kimse tarafından görüntülenemez."
                        : "Bu profilin sayfasını yalnızca bu kullanıcıyı takip eden kişiler görebilir. Takip ettikten sonra içerik yüklenecektir."}
                    </Text>
                  </ScrollView>
                  <View style={styles.actionRow}>
                    {privacyMode === "followers_only" && onFollow ? (
                      <Pressable
                        style={[styles.followBtn, followRequested && styles.followPending, followed && styles.followOn]}
                        onPress={() => onFollow(kisiFromShown())}
                      >
                        <Text style={styles.btnTxt}>{followed ? "Takip Edilen" : followRequested ? "Beklemede" : "Takip Et"}</Text>
                      </Pressable>
                    ) : null}
                    {onBlockToggle ? (
                      <Pressable
                        style={[styles.blockBtn, blocked && styles.unblockBtn]}
                        onPress={() => onBlockToggle(kisiFromShown(), !blocked)}
                      >
                        <Text style={styles.btnTxt}>{blocked ? "Engeli Kaldır" : "Engelle"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.top}>
                    {shown.photoUri ? (
                      <Image source={{ uri: shown.photoUri }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarInitial}>
                          {person ? getInitial({ ...person, ...shown }) : getInitial(shown as unknown as KisiAraPerson)}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.username}>{shown.username || "@kullanici"}</Text>
                    {shown.displayName ? <Text style={styles.name}>{shown.displayName}</Text> : null}
                    <View style={styles.countsRow}>
                      <View style={styles.countItem}>
                        <Text style={styles.countNum}>{shown.mutual}</Text>
                        <Text style={styles.countLbl}>Ortak</Text>
                      </View>
                      <View style={styles.countItem}>
                        <Text style={styles.countNum}>{shown.following}</Text>
                        <Text style={styles.countLbl}>Takip</Text>
                      </View>
                      <View style={styles.countItem}>
                        <Text style={styles.countNum}>{shown.followers}</Text>
                        <Text style={styles.countLbl}>Takipçi</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.actionRow}>
                    {onMessage ? (
                      <Pressable style={styles.messageBtn} onPress={() => onMessage(kisiFromShown())}>
                        <Text style={styles.btnTxt}>Mesaj</Text>
                      </Pressable>
                    ) : null}
                    {onFollow ? (
                      <Pressable
                        style={[styles.followBtn, followRequested && styles.followPending, followed && styles.followOn]}
                        onPress={() => onFollow(kisiFromShown())}
                      >
                        <Text style={styles.btnTxt}>
                          {followed ? "Takip Edilen" : followRequested ? "Beklemede" : "Takip Et"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {onBlockToggle ? (
                      <Pressable
                        style={[styles.blockBtn, blocked && styles.unblockBtn]}
                        onPress={() => onBlockToggle(kisiFromShown(), !blocked)}
                      >
                        <Text style={styles.btnTxt}>{blocked ? "Engeli Kaldır" : "Engelle"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {!socialFeedUnlocked ? (
                    <View style={styles.syncHintRow}>
                      <ActivityIndicator color={palette.accent} size="small" />
                      <Text style={styles.syncHintTxt}>Profil doğrulanıyor…</Text>
                    </View>
                  ) : null}
                  <View style={styles.headTabsRow}>
                    <View style={styles.headTabsLine}>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "home" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("home")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Ana Sayfa
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "comments" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("comments")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Yorumlar
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "videos" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("videos")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Videolar
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "career" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("career")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                          {shown.memberType === "kurumsal" ? "İş İlanları" : "Kariyer"}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.headTabsLine}>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "personal" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("personal")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Biyografi
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "likes" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("likes")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Beğeniler
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "photos" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("photos")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Fotoğraflar
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.headTabBtn, activeSection === "favorites" && styles.headTabBtnActive]}
                        onPress={() => setActiveSection("favorites")}
                      >
                        <Text style={styles.headTabTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                          Favoriler
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {activeSection === "personal" ? (
                      <>
                        <Text style={styles.sectionTitle}>Biyografi</Text>
                        <View style={styles.sectionWrap}>
                          <InfoRow styles={styles} label="Kullanıcı Adı" value={shown.username || "@kullanici"} />
                          <InfoRow styles={styles} label="Ad Soyadı" value={shown.displayName || "—"} />
                          <InfoRow styles={styles} label="E-mail" value={shown.email || "—"} />
                          <InfoRow styles={styles} label="Telefon" value={shown.phone || "—"} />
                          <InfoRow styles={styles} label="Ünvan" value={shown.title || "—"} />
                          <InfoRow styles={styles} label="Meslek" value={shown.profession || "—"} />
                          <InfoRow styles={styles} label="Üniversite" value={shown.university || "—"} />
                          <InfoRow styles={styles} label="Kurum/Firma" value={shown.company || "—"} />
                          <InfoRow styles={styles} label="Şehir" value={shown.city || "—"} />
                          <InfoRow styles={styles} label="Biyografi" value={shown.bio || "—"} />
                        </View>
                      </>
                    ) : null}
                    {activeSection === "home" ? <FeedList styles={styles} textMuted={palette.textMuted} title="Ana Sayfa" rows={personFeed} myIds={myIds} /> : null}
                    {activeSection === "photos" ? (
                      <>
                        <Text style={styles.sectionTitle}>Fotoğraflar</Text>
                        {personPhotos.length ? (
                          <View style={styles.mediaGrid}>
                            {personPhotos.map((x) => (
                              <View key={x.id} style={styles.mediaCell}>
                                {x.mediaUrl ? (
                                  <Image source={{ uri: x.mediaUrl }} style={styles.mediaImg} />
                                ) : (
                                  <Text style={styles.mediaFallback}>🖼</Text>
                                )}
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.empty}>Henüz fotoğraf yok.</Text>
                        )}
                      </>
                    ) : null}
                    {activeSection === "videos" ? (
                      <>
                        <Text style={styles.sectionTitle}>Videolar</Text>
                        {personVideos.length ? (
                          <View style={styles.videoListWrap}>
                            {personVideos.map((x) => (
                              <SocialProfileVideoPlayer
                                key={x.id}
                                uri={x.mediaUrl || ""}
                                title={`${x.authorUsername} • ${new Date(x.createdAtMs).toLocaleString("tr-TR")}`}
                                styles={styles}
                              />
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.empty}>Bu kullanıcının yorumlarında henüz video yok.</Text>
                        )}
                      </>
                    ) : null}
                    {activeSection === "comments" ? <FeedList styles={styles} textMuted={palette.textMuted} title="Yorumlar" rows={personFeed} myIds={myIds} /> : null}
                    {activeSection === "likes" ? <FeedList styles={styles} textMuted={palette.textMuted} title="Beğeniler" rows={personLiked} myIds={myIds} /> : null}
                    {activeSection === "favorites" ? (
                      <FeedList styles={styles} textMuted={palette.textMuted} title="Favoriler" rows={personFavorites} myIds={myIds} />
                    ) : null}
                    {activeSection === "career" ? (
                      <>
                        <Text style={styles.sectionTitle}>{shown.memberType === "kurumsal" ? "İş İlanları" : "Kariyer"}</Text>
                        {shown.careerItems.length ? (
                          <View style={styles.sectionWrap}>
                            {shown.careerItems.map((x, i) => (
                              <View key={`${x}_${i}`} style={styles.bulletCard}>
                                <Text style={styles.bulletTxt}>🏆 {x}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.empty}>Henüz kariyer bilgisi yok.</Text>
                        )}
                      </>
                    ) : null}
                  </ScrollView>
                </>
              )}
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}


function SocialProfileVideoPlayer({
  uri,
  title,
  styles,
}: {
  uri: string;
  title: string;
  styles: ReturnType<typeof createSocialProfileModalStyles>;
}) {
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

  const u = (uri || "").trim();
  if (!u) return null;

  return (
    <View style={styles.inlineVideoCard}>
      <Text style={styles.inlineVideoTitle} numberOfLines={2}>
        {title}
      </Text>
      <Pressable onPress={() => setFullOpen(true)}>
        <Video
          ref={playerRef}
          source={{ uri: u }}
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
            const next = Math.max(0, positionMs - 10_000);
            void playerRef.current.setPositionAsync(next);
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>« 10 sn</Text>
        </Pressable>
        <Pressable
          style={styles.inlineVideoBtn}
          onPress={() => {
            if (!playerRef.current) return;
            if (playing) void playerRef.current.pauseAsync();
            else void playerRef.current.playAsync();
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>{playing ? "Duraklat" : "Oynat"}</Text>
        </Pressable>
        <Pressable
          style={styles.inlineVideoBtn}
          onPress={() => {
            if (!playerRef.current) return;
            const max = durationMs > 0 ? durationMs : positionMs + 10_000;
            const next = Math.min(max, positionMs + 10_000);
            void playerRef.current.setPositionAsync(next);
          }}
        >
          <Text style={styles.inlineVideoBtnTxt}>10 sn »</Text>
        </Pressable>
      </View>
      <View style={styles.inlineVideoControls}>
        <Pressable style={styles.inlineVideoBtn}>
          <Text style={styles.inlineVideoBtnTxt}>
            {`${Math.floor(positionMs / 1000)} sn / ${Math.max(1, Math.floor(durationMs / 1000))} sn`}
          </Text>
        </Pressable>
        <Pressable style={styles.inlineVideoBtn} onPress={() => setFullOpen(true)}>
          <Text style={styles.inlineVideoBtnTxt}>Tam ekran</Text>
        </Pressable>
        {!ready ? <Text style={styles.empty}>Yükleniyor…</Text> : null}
      </View>
      <Modal visible={fullOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFullOpen(false)}>
        <SafeAreaView style={styles.fullscreenSafe}>
          <View style={styles.fullscreenHeader}>
            <Pressable onPress={() => setFullOpen(false)} hitSlop={10}>
              <Text style={styles.fullscreenTitle}>← Geri</Text>
            </Pressable>
            <Text style={styles.fullscreenTitle}>Video</Text>
            <View style={{ width: 56 }} />
          </View>
          <Video source={{ uri: u }} style={styles.mediaViewerVideo} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function InfoRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createSocialProfileModalStyles>;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "—"}</Text>
    </View>
  );
}

function FeedList({
  title,
  rows,
  myIds,
  styles,
  textMuted,
}: {
  title: string;
  rows: CommentFeedItem[];
  myIds: Set<string>;
  styles: ReturnType<typeof createSocialProfileModalStyles>;
  textMuted: string;
}) {
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
  const repliesByParent = useMemo(() => {
    const out = new Map<string, CommentFeedItem[]>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const arr = out.get(r.parentId) || [];
      arr.push(r);
      out.set(r.parentId, arr);
    }
    return out;
  }, [rows]);

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
    if (!text) return;
    setSending(true);
    try {
      await publishComment({ text, topic: item.topic, parentId: item.id });
      setReplyText("");
      setOpenId(item.id);
      setReplyToId("");
    } catch {
      Alert.alert("Hata", "Yanıt gönderilemedi.");
    } finally {
      setSending(false);
    }
  };

  const onSendQuote = async (item: CommentFeedItem) => {
    const text = quoteText.trim();
    if (!text) return;
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
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.length ? (
        <View style={styles.sectionWrap}>
          {rows.map((x) => {
            const optimistic = optimisticById[x.id] || {};
            const liked = typeof optimistic.iLiked === "boolean" ? optimistic.iLiked : x.iLiked;
            const favorited = typeof optimistic.iFavorited === "boolean" ? optimistic.iFavorited : x.iFavorited;
            const likeCount = typeof optimistic.likeCount === "number" ? optimistic.likeCount : x.likeCount;
            const favoriteCount = typeof optimistic.favoriteCount === "number" ? optimistic.favoriteCount : x.favoriteCount;
            return (
            <Pressable
              key={x.id}
              style={styles.feedCard}
              onPress={() => {
                setFullscreenItem(x);
              }}
            >
              <View style={styles.feedTopRow}>
                <View style={styles.feedUserWrap}>
                  {x.authorPhotoUri ? (
                    <Image source={{ uri: x.authorPhotoUri }} style={styles.feedAvatar} />
                  ) : (
                    <View style={styles.feedAvatarFallback}>
                      <Text style={styles.feedAvatarInitial}>
                        {(x.authorUsername || "@k").replace(/^@/, "").slice(0, 1).toLocaleUpperCase("tr-TR")}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.feedHead}>{x.authorUsername}</Text>
                </View>
                <Text style={styles.feedDate}>{fmt(x.createdAtMs)}</Text>
              </View>
              {editingId === x.id ? (
                <TextInput
                  value={editingText}
                  onChangeText={setEditingText}
                  multiline
                  style={styles.feedEditInput}
                  placeholderTextColor={textMuted}
                />
              ) : (
                <Text style={styles.feedBody}>{x.text}</Text>
              )}
              {x.mediaUrl ? (
                x.mediaKind === "video" ? (
                  <View style={styles.feedMediaVideoWrap}>
                    <Video
                      source={{ uri: x.mediaUrl }}
                      style={styles.feedMediaVideo}
                      useNativeControls
                      resizeMode={ResizeMode.CONTAIN}
                    />
                    <View pointerEvents="none" style={styles.feedMediaVideoOverlay}>
                      <Text style={styles.feedMediaVideoOverlayTxt}>▶ Oynat</Text>
                    </View>
                  </View>
                ) : (
                  <Image source={{ uri: x.mediaUrl }} style={styles.feedMediaImage} />
                )
              ) : null}
              <View style={styles.feedMetaRow}>
                <Pressable style={[styles.feedMetaPill, liked && styles.feedLikePill]} onPress={() => void onToggleLike(x)} disabled={busyLikeId === x.id}>
                  <Text style={[styles.feedMetaIcon, liked && styles.feedLikeTxt]}>{liked ? "♥" : "♡"} {likeCount}</Text>
                </Pressable>
                <Pressable style={[styles.feedMetaPill, favorited && styles.feedFavPill]} onPress={() => void onToggleFavorite(x)} disabled={busyFavId === x.id}>
                  <Text style={[styles.feedMetaIcon, favorited && styles.feedFavTxt]}>{favorited ? "★" : "☆"} {favoriteCount}</Text>
                </Pressable>
                <Pressable style={styles.feedMetaPill} onPress={() => { setQuoteToId((q) => (q === x.id ? "" : x.id)); setReplyToId(""); setOpenId(x.id); }}>
                  <Text style={styles.feedMetaIcon}>❝</Text>
                </Pressable>
                <Pressable style={styles.feedMetaPill} onPress={() => { setReplyToId((q) => (q === x.id ? "" : x.id)); setQuoteToId(""); setOpenId(x.id); }}>
                  <Text style={styles.feedMetaIcon}>💬 {x.replyCount}</Text>
                </Pressable>
              </View>
              {myIds.has(x.id) ? (
                <View style={styles.feedActionRow}>
                  {editingId === x.id ? (
                    <>
                      <Pressable style={[styles.feedActionBtn, styles.feedCancelBtn]} onPress={() => { setEditingId(""); setEditingText(""); }}>
                        <Text style={styles.feedActionTxt}>✕</Text>
                      </Pressable>
                      <Pressable style={[styles.feedActionBtn, styles.feedSaveBtn]} onPress={() => void onSaveEdit(x)}>
                        <Text style={styles.feedActionTxt}>💾</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable style={[styles.feedActionBtn, styles.feedEditBtn]} onPress={() => { setEditingId(x.id); setEditingText(x.text); }}>
                        <Text style={styles.feedActionTxt}>✎</Text>
                      </Pressable>
                      <Pressable style={[styles.feedActionBtn, styles.feedDeleteBtn]} onPress={() => onAskDelete(x)}>
                        <Text style={styles.feedActionTxt}>🗑</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ) : null}
              {openId === x.id ? (
                <View style={styles.threadComposer}>
                  {quoteToId === x.id ? (
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
                      <Pressable style={styles.threadSendBtn} onPress={() => void onSendQuote(x)} disabled={sending}>
                        <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Alıntıyı Gönder"}</Text>
                      </Pressable>
                    </>
                  ) : null}
                  {replyToId === x.id ? (
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
                      <Pressable style={styles.threadSendBtn} onPress={() => void onSendReply(x)} disabled={sending}>
                        <Text style={styles.threadSendTxt}>{sending ? "Gönderiliyor..." : "Yanıt Gönder"}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}
              {openId === x.id && (repliesByParent.get(x.id) || []).length ? (
                <View style={styles.repliesWrap}>
                  {(repliesByParent.get(x.id) || []).map((r) => {
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
                          <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((q) => (q === r.id ? "" : r.id)); setQuoteToId(""); setOpenId(x.id); }}>
                            <Text style={styles.replyActionTxt}>💬</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>Kayıt yok.</Text>
      )}
      <Modal
        visible={!!fullscreenItem}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreenItem(null)}
      >
        <SafeAreaView style={styles.fullscreenSafe} edges={["top", "left", "right"]}>
          <View style={styles.fullscreenHeader}>
            <Pressable onPress={() => setFullscreenItem(null)} hitSlop={10}>
              <Text style={styles.iconBtnTxt}>← Geri</Text>
            </Pressable>
            <Text style={styles.fullscreenTitle}>Yorum Detayı</Text>
            <View style={{ width: 48 }} />
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
                      <Pressable style={styles.feedMetaPill} onPress={() => { setQuoteToId((q) => (q === fullscreenItem.id ? "" : fullscreenItem.id)); setReplyToId(""); setOpenId(fullscreenItem.id); }}>
                        <Text style={styles.feedMetaIcon}>❝</Text>
                      </Pressable>
                      <Pressable style={styles.feedMetaPill} onPress={() => { setReplyToId((q) => (q === fullscreenItem.id ? "" : fullscreenItem.id)); setQuoteToId(""); setOpenId(fullscreenItem.id); }}>
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
                                <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((q) => (q === r.id ? "" : r.id)); setQuoteToId(""); setOpenId(fullscreenItem.id); }}>
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
