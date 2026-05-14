import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "../theme/ThemeProvider";
import { createForumModalStyles } from "./forumModalStyles";
import { ensureFirestoreAuthReady } from "../lib/firebaseClient";
import {
  canUseForumFirestore,
  createForumTopic,
  forumHashtagToDocId,
  normalizeForumHashtag,
  subscribeForumTopics,
  type ForumTopicItem,
} from "../lib/forumFirestore";
import {
  canUseCommentsFirestore,
  deleteMyComment,
  publishComment,
  resolveCommentActor,
  subscribeCommentsForTopic,
  toggleCommentFavorite,
  toggleCommentLike,
  type CommentFeedItem,
} from "../lib/commentsFirestore";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Bildirimden açılışta doğrudan bu #konuya gir */
  initialHashtag?: string | null;
};

type ScreenMode = "list" | "topic" | "new";

function fmt(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ForumPostNodeProps = {
  styles: ReturnType<typeof createForumModalStyles>;
  item: CommentFeedItem;
  depth: number;
  childrenMap: Map<string, CommentFeedItem[]>;
  optimisticById: Record<string, { iLiked?: boolean; iFavorited?: boolean; likeCount?: number; favoriteCount?: number }>;
  myUserId: string;
  likingId: string;
  favoritingId: string;
  onToggleLike: (item: CommentFeedItem) => void;
  onToggleFavorite: (item: CommentFeedItem) => void;
  onReply: (item: CommentFeedItem) => void;
  onAskDelete: (item: CommentFeedItem) => void;
};

function ForumPostNode({
  styles,
  item,
  depth,
  childrenMap,
  optimisticById,
  myUserId,
  likingId,
  favoritingId,
  onToggleLike,
  onToggleFavorite,
  onReply,
  onAskDelete,
}: ForumPostNodeProps) {
  const kids = childrenMap.get(item.id) || [];
  const opt = optimisticById[item.id] || {};
  const liked = typeof opt.iLiked === "boolean" ? opt.iLiked : item.iLiked;
  const favorited = typeof opt.iFavorited === "boolean" ? opt.iFavorited : item.iFavorited;
  const likeCount = typeof opt.likeCount === "number" ? opt.likeCount : item.likeCount;
  const favoriteCount = typeof opt.favoriteCount === "number" ? opt.favoriteCount : item.favoriteCount;
  const mine = item.authorUserId === myUserId && !!myUserId;
  const indent = Math.min(depth, 5) * 10;

  return (
    <View style={{ marginLeft: indent, marginBottom: 8 }}>
      <View style={[styles.commentCard, depth > 0 && styles.commentCardNested]}>
        <View style={styles.commentHeaderRow}>
          <Text style={styles.commentAuthor}>{item.authorUsername}</Text>
          {mine ? (
            <Pressable onPress={() => onAskDelete(item)} hitSlop={8} style={styles.softDeleteWrap}>
              <Text style={styles.softDeleteText}>Sil</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.commentBody}>{item.text}</Text>
        <Text style={styles.commentDate}>{fmt(item.createdAtMs)}</Text>
        <View style={styles.metaRow}>
          <Pressable style={styles.metaPill} onPress={() => onToggleLike(item)} disabled={likingId === item.id}>
            <Text style={[styles.metaIcon, liked && styles.metaLikeOn]}>{liked ? "♥" : "♡"}</Text>
            <Text style={[styles.metaCount, liked && styles.metaLikeOn]}>{likeCount}</Text>
          </Pressable>
          <Pressable style={styles.metaPill} onPress={() => onToggleFavorite(item)} disabled={favoritingId === item.id}>
            <Text style={[styles.metaIcon, favorited && styles.metaFavOn]}>{favorited ? "★" : "☆"}</Text>
            <Text style={[styles.metaCount, favorited && styles.metaFavOn]}>{favoriteCount}</Text>
          </Pressable>
          <Pressable style={styles.metaPill} onPress={() => onReply(item)}>
            <Text style={styles.metaIcon}>💬</Text>
            <Text style={styles.metaCount}>{item.replyCount > 0 ? item.replyCount : ""}</Text>
          </Pressable>
        </View>
      </View>
      {kids.map((k) => (
        <ForumPostNode
          key={`${k.source}_${k.id}`}
          styles={styles}
          item={k}
          depth={depth + 1}
          childrenMap={childrenMap}
          optimisticById={optimisticById}
          myUserId={myUserId}
          likingId={likingId}
          favoritingId={favoritingId}
          onToggleLike={onToggleLike}
          onToggleFavorite={onToggleFavorite}
          onReply={onReply}
          onAskDelete={onAskDelete}
        />
      ))}
    </View>
  );
}

export function ForumModal({ visible, onClose, initialHashtag }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(() => createForumModalStyles(palette), [palette]);
  const forumInsets = useSafeAreaInsets();

  const [mode, setMode] = useState<ScreenMode>("list");
  const [topics, setTopics] = useState<ForumTopicItem[]>([]);
  const [selected, setSelected] = useState<ForumTopicItem | null>(null);
  const [allComments, setAllComments] = useState<CommentFeedItem[]>([]);
  const [newTopicRaw, setNewTopicRaw] = useState("");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentFeedItem | null>(null);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [myUserId, setMyUserId] = useState("");
  const [likingId, setLikingId] = useState("");
  const [favoritingId, setFavoritingId] = useState("");
  const [optimisticById, setOptimisticById] = useState<
    Record<string, { iLiked?: boolean; iFavorited?: boolean; likeCount?: number; favoriteCount?: number }>
  >({});
  const [topicSearchDraft, setTopicSearchDraft] = useState("");
  const [topicSearchApplied, setTopicSearchApplied] = useState("");
  const [topicSavePending, setTopicSavePending] = useState(false);
  const sendCommentLockRef = useRef(false);

  const titleCenter = useMemo(() => {
    if (mode === "new") return "Yeni konu";
    if (mode === "topic" && selected) return selected.hashtag;
    return "Forum";
  }, [mode, selected]);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      try {
        const { socialUserId } = await resolveCommentActor();
        setMyUserId(socialUserId || "");
      } catch {
        setMyUserId("");
      }
    })();
  }, [visible]);

  /* Forum yazmadan önce anonim Firebase oturumu arka planda hazır olsun (bekleme yüzünden spinner hissi azalır). */
  useEffect(() => {
    if (!visible || !canUseForumFirestore()) return;
    if (mode !== "new" && mode !== "topic") return;
    void ensureFirestoreAuthReady().catch(() => {});
  }, [visible, mode]);

  useEffect(() => {
    if (!visible || !initialHashtag?.trim()) return;
    const raw = initialHashtag.trim();
    let h = raw;
    try {
      h = normalizeForumHashtag(raw);
    } catch {
      h = raw.startsWith("#") ? raw : `#${raw.replace(/^#+/, "")}`;
    }
    setSelected({
      id: forumHashtagToDocId(h),
      hashtag: h,
      createdAtMs: 0,
      userId: "",
      username: "",
    });
    setMode("topic");
    setDraft("");
    setReplyTo(null);
  }, [visible, initialHashtag]);

  useEffect(() => {
    if (!visible) {
      setMode("list");
      setSelected(null);
      setAllComments([]);
      setNewTopicRaw("");
      setDraft("");
      setReplyTo(null);
      setErrorText("");
      setOptimisticById({});
      setTopicSearchDraft("");
      setTopicSearchApplied("");
      setTopicSavePending(false);
      return;
    }
    if (!canUseForumFirestore()) {
      setErrorText("Forum şu an kullanılamıyor (Firebase yapılandırması).");
      return;
    }
    let unsub: (() => void) | undefined;
    setLoadingTopics(true);
    setErrorText("");
    void (async () => {
      try {
        unsub = await subscribeForumTopics(
          (items) => {
            setTopics(items);
            setLoadingTopics(false);
          },
          (msg) => {
            setErrorText(msg);
            setLoadingTopics(false);
          },
        );
      } catch {
        setLoadingTopics(false);
      }
    })();
    return () => {
      unsub?.();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || mode !== "topic" || !selected?.hashtag) return;
    if (!canUseCommentsFirestore()) {
      setErrorText("Yorumlar yüklenemiyor.");
      return;
    }
    let unsub: (() => void) | undefined;
    setLoadingComments(true);
    void (async () => {
      try {
        unsub = await subscribeCommentsForTopic(
          selected.hashtag,
          (rows) => {
            setAllComments(rows);
            setLoadingComments(false);
          },
          () => {
            setLoadingComments(false);
            setErrorText("Bu konudaki yorumlar yüklenemedi.");
          },
        );
      } catch {
        setLoadingComments(false);
      }
    })();
    return () => {
      unsub?.();
    };
  }, [visible, mode, selected?.hashtag]);

  const childrenMap = useMemo(() => {
    const m = new Map<string, CommentFeedItem[]>();
    for (const r of allComments) {
      if (!r.parentId) continue;
      const list = m.get(r.parentId) || [];
      list.push(r);
      m.set(r.parentId, list);
    }
    for (const k of m.keys()) {
      m.set(
        k,
        (m.get(k) || []).sort((a, b) => a.createdAtMs - b.createdAtMs),
      );
    }
    return m;
  }, [allComments]);

  const rootComments = useMemo(
    () => allComments.filter((r) => !r.parentId).sort((a, b) => b.createdAtMs - a.createdAtMs),
    [allComments],
  );

  const onOpenTopic = useCallback((t: ForumTopicItem) => {
    setSelected(t);
    setDraft("");
    setReplyTo(null);
    setMode("topic");
  }, []);

  const displayedTopics = useMemo(() => {
    const q = topicSearchApplied.trim();
    if (!q) return topics;
    let normalized = "";
    try {
      normalized = normalizeForumHashtag(q);
    } catch {
      const s = q.startsWith("#") ? q : `#${q.replace(/^#+/, "")}`;
      normalized = s.toLocaleLowerCase("tr-TR");
    }
    const bare = normalized.replace(/^#/, "").toLocaleLowerCase("tr-TR");
    const slug = forumHashtagToDocId(normalized);
    return topics.filter((t) => {
      const h = (t.hashtag || "").toLocaleLowerCase("tr-TR");
      const id = (t.id || "").toLowerCase();
      return (
        h === normalized.toLocaleLowerCase("tr-TR") ||
        h.includes(bare) ||
        id === slug ||
        id.includes(bare)
      );
    });
  }, [topics, topicSearchApplied]);

  const onApplyTopicSearch = useCallback(() => {
    setTopicSearchApplied(topicSearchDraft.trim());
  }, [topicSearchDraft]);

  const openTopicByHashtag = useCallback((raw: string) => {
    try {
      const hashtag = normalizeForumHashtag(raw);
      setSelected({
        id: forumHashtagToDocId(hashtag),
        hashtag,
        createdAtMs: 0,
        userId: "",
        username: "",
      });
      setDraft("");
      setReplyTo(null);
      setMode("topic");
    } catch (e) {
      const d = e instanceof Error ? e.message : String(e);
      Alert.alert("Konu", d);
    }
  }, []);

  const onCreateTopic = () => {
    let hashtag: string;
    try {
      hashtag = normalizeForumHashtag(newTopicRaw);
    } catch (e) {
      const d = e instanceof Error ? e.message : String(e);
      Alert.alert("Konu", d);
      return;
    }
    const rawForFirestore = newTopicRaw;
    const id = forumHashtagToDocId(hashtag);
    Keyboard.dismiss();
    setNewTopicRaw("");
    setSelected({
      id,
      hashtag,
      createdAtMs: Date.now(),
      userId: "",
      username: "",
    });
    setMode("topic");
    setReplyTo(null);
    setTopicSavePending(true);
    void createForumTopic(rawForFirestore)
      .then(() => {
        setTopicSavePending(false);
      })
      .catch((e) => {
        setTopicSavePending(false);
        const d = e instanceof Error ? e.message : String(e);
        Alert.alert("Konu kaydedilemedi", d);
        setMode("new");
        setSelected(null);
        setNewTopicRaw(rawForFirestore);
      });
  };

  const onToggleLike = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const curLiked = typeof prev.iLiked === "boolean" ? prev.iLiked : item.iLiked;
    const curCount = typeof prev.likeCount === "number" ? prev.likeCount : item.likeCount;
    const nextLiked = !curLiked;
    const nextCount = Math.max(0, curCount + (nextLiked ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: nextLiked, likeCount: nextCount } }));
    setLikingId(item.id);
    try {
      await toggleCommentLike(item.id, nextLiked, item.source);
    } catch {
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: curLiked, likeCount: curCount } }));
    } finally {
      setLikingId("");
    }
  };

  const onToggleFavorite = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const curFav = typeof prev.iFavorited === "boolean" ? prev.iFavorited : item.iFavorited;
    const curCount = typeof prev.favoriteCount === "number" ? prev.favoriteCount : item.favoriteCount;
    const nextFav = !curFav;
    const nextCount = Math.max(0, curCount + (nextFav ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: nextFav, favoriteCount: nextCount } }));
    setFavoritingId(item.id);
    try {
      await toggleCommentFavorite(item.id, nextFav, item.source);
    } catch {
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: curFav, favoriteCount: curCount } }));
    } finally {
      setFavoritingId("");
    }
  };

  const onAskDelete = (item: CommentFeedItem) => {
    Alert.alert("Mesajı sil", "Bu forum yazısını kaldırmak istiyor musunuz?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          void deleteMyComment(item.id, item.source).catch((e) => {
            const d = e instanceof Error ? e.message : String(e);
            Alert.alert("Silinemedi", d);
          });
        },
      },
    ]);
  };

  const onSendComment = () => {
    const textTrim = draft.trim();
    if (!selected?.hashtag) return;
    if (textTrim.length < 1) {
      Alert.alert("Yorum", "Bir şeyler yazın.");
      return;
    }
    if (!canUseCommentsFirestore()) {
      Alert.alert("Forum", "Firebase yapılandırması yok veya hizmet kullanılamıyor (EXPO_PUBLIC_FIREBASE_*).");
      return;
    }
    if (sendCommentLockRef.current) return;

    Keyboard.dismiss();
    const snapDraft = draft;
    const snapReply = replyTo;
    const hashtag = selected.hashtag;
    setDraft("");
    setReplyTo(null);

    sendCommentLockRef.current = true;
    void (async () => {
      try {
        await ensureFirestoreAuthReady();
        await publishComment({
          text: textTrim,
          topic: hashtag,
          ...(snapReply ? { parentId: snapReply.id } : {}),
        });
      } catch (e) {
        setDraft(snapDraft);
        setReplyTo(snapReply);
        const d = e instanceof Error ? e.message : String(e);
        Alert.alert("Gönderilemedi", d);
      } finally {
        sendCommentLockRef.current = false;
      }
    })();
  };

  const topicSearchBar = (
    <View style={styles.listSearchSticky}>
      <Text style={styles.searchLabel}>Konu başlığı ara (# ile)</Text>
      <View style={styles.searchRow}>
        <TextInput
          value={topicSearchDraft}
          onChangeText={setTopicSearchDraft}
          placeholder="#örnek veya borsa"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => onApplyTopicSearch()}
          returnKeyType="search"
          style={styles.searchInput}
        />
        <Pressable style={styles.searchBtn} onPress={() => onApplyTopicSearch()}>
          <Text style={styles.searchBtnTxt}>Ara</Text>
        </Pressable>
      </View>
      {topicSearchApplied.trim() ? (
        <Pressable
          style={styles.clearSearchBtn}
          onPress={() => {
            setTopicSearchDraft("");
            setTopicSearchApplied("");
          }}
        >
          <Text style={styles.clearSearchTxt}>Filtreyi temizle</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const listIntroHeader = (
    <View style={styles.listHeader}>
      <View style={styles.exampleChipsRow}>
        <Pressable style={styles.exampleChip} onPress={() => openTopicByHashtag("#altın")}>
          <Text style={styles.exampleChipTxt}>#altın</Text>
        </Pressable>
        <Pressable style={styles.exampleChip} onPress={() => openTopicByHashtag("#bist100")}>
          <Text style={styles.exampleChipTxt}>#bist100</Text>
        </Pressable>
      </View>
      <Text style={styles.introBody}>
        Herkes konu listesini görür. Yazarken @kullaniciadi ile etiketleyebilirsiniz. Aşağıdan yeni konu da açabilirsiniz.
      </Text>
      <Pressable style={styles.primaryBtn} onPress={() => setMode("new")}>
        <Text style={styles.primaryBtnTxt}>+ Yeni #konu aç</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (mode === "list") onClose();
              else if (mode === "new") setMode("list");
              else {
                setMode("list");
                setSelected(null);
                setReplyTo(null);
              }
            }}
            hitSlop={10}
          >
            <Text style={styles.headerAction}>← Geri</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {titleCenter}
          </Text>
          <View style={styles.headerGhost} />
        </View>

        {errorText ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorTxt}>{errorText}</Text>
          </View>
        ) : null}

        {mode === "list" ? (
          <View style={styles.flex1}>
            {topicSearchBar}
            {loadingTopics ? (
              <View style={styles.centerPad}>
                <ActivityIndicator color={palette.textMuted} />
                <Text style={styles.muted}>Konular yükleniyor...</Text>
              </View>
            ) : (
              <FlatList
                data={displayedTopics}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listPad}
                ListHeaderComponent={listIntroHeader}
                ListEmptyComponent={
                  topicSearchApplied.trim() ? (
                    <View style={styles.emptySearchWrap}>
                      <Text style={styles.empty}>
                        &quot;{topicSearchApplied.trim()}&quot; ile eşleşen konu listede yok.
                      </Text>
                      <Pressable
                        style={styles.primaryBtn}
                        onPress={() => {
                          const raw = topicSearchApplied.trim();
                          if (raw) openTopicByHashtag(raw);
                        }}
                      >
                        <Text style={styles.primaryBtnTxt}>Bu etiketle konuya git</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.empty}>
                      Henüz listede konu yok. Üstte # ile arayın, #altın / #bist100 kısayollarını kullanın veya yeni konu oluşturun.
                    </Text>
                  )
                }
                renderItem={({ item }) => (
                  <Pressable style={styles.topicCard} onPress={() => onOpenTopic(item)}>
                    <Text style={styles.topicHash}>{item.hashtag}</Text>
                    <Text style={styles.topicMeta}>
                      {item.username} {item.createdAtMs ? `• ${fmt(item.createdAtMs)}` : ""}
                    </Text>
                    <Text style={styles.topicHint}>Konuya gir ›</Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        ) : null}

        {mode === "new" ? (
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={styles.formPad} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Konu başlığı (#zorunlu)</Text>
              <TextInput
                value={newTopicRaw}
                onChangeText={setNewTopicRaw}
                placeholder="#altın veya #bist100"
                placeholderTextColor={palette.textMuted}
                autoCapitalize="none"
                style={styles.input}
              />
              <Text style={styles.hint}>
                Önizleme: {(() => {
                  try {
                    return newTopicRaw.trim() ? normalizeForumHashtag(newTopicRaw) : "—";
                  } catch {
                    return "—";
                  }
                })()}
              </Text>
              <Pressable
                style={[styles.primaryBtn, styles.primaryBtnWide]}
                onPress={onCreateTopic}
              >
                <Text style={styles.primaryBtnTxt}>Konuyu oluştur</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}

        {mode === "topic" && selected ? (
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.topicBanner}>
              <Text style={styles.topicBannerHash}>{selected.hashtag}</Text>
              <Text style={styles.topicBannerSub}>Bu etiket altındaki forum yazıları ve yanıtlar</Text>
              {topicSavePending ? (
                <View style={styles.topicSaveRow}>
                  <Text style={styles.topicSaveTxt}>Konu kaydediliyor…</Text>
                </View>
              ) : null}
            </View>
            {loadingComments ? (
              <View style={[styles.centerPad, { flex: 1 }]}>
                <ActivityIndicator color={palette.textMuted} />
              </View>
            ) : (
              <FlatList
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="always"
                data={rootComments}
                keyExtractor={(c) => `${c.source}_${c.id}`}
                contentContainerStyle={styles.threadPad}
                ListEmptyComponent={<Text style={styles.empty}>İlk yazıyı siz gönderin. Herkes görebilir.</Text>}
                renderItem={({ item }) => (
                  <ForumPostNode
                    styles={styles}
                    item={item}
                    depth={0}
                    childrenMap={childrenMap}
                    optimisticById={optimisticById}
                    myUserId={myUserId}
                    likingId={likingId}
                    favoritingId={favoritingId}
                    onToggleLike={(x) => void onToggleLike(x)}
                    onToggleFavorite={(x) => void onToggleFavorite(x)}
                    onReply={(x) => {
                      setReplyTo(x);
                      setDraft((d) => (d.trim() ? d : `@${(x.authorUsername || "").replace(/^@/, "")} `));
                    }}
                    onAskDelete={onAskDelete}
                  />
                )}
              />
            )}
            {replyTo ? (
              <View style={styles.replyBanner}>
                <Text style={styles.replyBannerTxt} numberOfLines={1}>
                  Yanıt: {replyTo.authorUsername}
                </Text>
                <Pressable hitSlop={8} onPress={() => setReplyTo(null)}>
                  <Text style={styles.replyBannerClear}>✕</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={[styles.composer, { paddingBottom: Math.max(forumInsets.bottom, 10), zIndex: 20, elevation: 22 }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={replyTo ? "Yanıtınızı yazın..." : "Forumda yazın... (@ ile etiket)"}
                placeholderTextColor={palette.textMuted}
                multiline
                style={styles.composerInput}
                maxLength={800}
              />
              <Pressable style={styles.sendBtn} hitSlop={10} onPress={onSendComment}>
                <Text style={styles.sendBtnTxt}>Gönder</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}


