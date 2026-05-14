import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import {
  canUseCommentsFirestore,
  commentFeedItemMatchesOwnerKeys,
  publishComment,
  resolveCommentActor,
  subscribeCommentFeed,
  deleteMyComment,
  toggleCommentFavorite,
  toggleCommentLike,
  updateMyComment,
  type CommentFeedItem } from "../lib/commentsFirestore";
import { useThemeColors } from "../theme/ThemeProvider";
import { createYorumlarimModalStyles } from "./yorumlarimModalStyles";
import { useCachedRemoteVideoUri } from "../lib/useCachedRemoteVideoUri";

type Props = {
  visible: boolean;
  onClose: () => void;
};

function formatDate(ms: number): string {
  if (!ms) return "Tarih yok";
  return new Date(ms).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function YorumlarimModal({ visible, onClose }: Props) {
  const palette = useThemeColors();
  const styles = useMemo(() => createYorumlarimModalStyles(palette), [palette]);

  const [rows, setRows] = useState<CommentFeedItem[]>([]);
  const [feedOwnerKeys, setFeedOwnerKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [replyToId, setReplyToId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [quoteToId, setQuoteToId] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [likingId, setLikingId] = useState("");
  const [favoritingId, setFavoritingId] = useState("");
  const [optimisticById, setOptimisticById] = useState<Record<string, { iLiked?: boolean; iFavorited?: boolean; likeCount?: number; favoriteCount?: number }>>({});
  const [replying, setReplying] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [fullscreenItem, setFullscreenItem] = useState<CommentFeedItem | null>(null);
  const [photoViewerUri, setPhotoViewerUri] = useState("");
  const cachedDetailVideoUri = useCachedRemoteVideoUri(
    fullscreenItem?.mediaKind === "video" ? fullscreenItem.mediaUrl : undefined,
    fullscreenItem?.id ?? "",
  );

  const myIds = useMemo(() => {
    if (!feedOwnerKeys.length) return new Set<string>();
    return new Set(rows.filter((x) => commentFeedItemMatchesOwnerKeys(x, feedOwnerKeys)).map((x) => x.id));
  }, [rows, feedOwnerKeys]);

  useEffect(() => {
    if (!visible) return;
    if (!canUseCommentsFirestore()) {
      setErrorText("Yorum servisi şu an kullanılamıyor.");
      return;
    }
    let unsub: (() => void) | null = null;
    let closed = false;
    setLoading(true);
    setErrorText("");
    void (async () => {
      try {
        const actor = await resolveCommentActor();
        if (closed) return;
        setFeedOwnerKeys(actor.ownerKeys);
        unsub = await subscribeCommentFeed(
          (items) => {
            if (closed) return;
            setRows(items);
            setLoading(false);
          },
          (err) => {
            if (closed) return;
            setErrorText(err);
            setLoading(false);
          },
        );
      } catch {
        if (closed) return;
        setFeedOwnerKeys([]);
        setErrorText("Yorumlarım yüklenemedi.");
        setLoading(false);
      }
    })();
    return () => {
      closed = true;
      setFeedOwnerKeys([]);
      if (unsub) unsub();
    };
  }, [visible]);

  const filtered = useMemo(() => rows.filter((x) => myIds.has(x.id)), [rows, myIds]);

  const myRootComments = useMemo(() => filtered.filter((x) => !x.parentId), [filtered]);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, CommentFeedItem[]>();
    for (const row of filtered) {
      if (!row.parentId) continue;
      const prev = m.get(row.parentId) || [];
      prev.push(row);
      m.set(row.parentId, prev);
    }
    for (const key of m.keys()) {
      m.set(
        key,
        (m.get(key) || []).sort((a, b) => a.createdAtMs - b.createdAtMs),
      );
    }
    return m;
  }, [filtered]);

  const onAskDelete = (item: CommentFeedItem) => {
    Alert.alert("Yorumu Sil", "Bu yorumu silmek istiyor musunuz?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          void deleteMyComment(item.id, item.source).catch((e) => {
            const detail = e instanceof Error ? e.message : String(e);
            setErrorText(`Silme hatası: ${detail}`);
          });
        },
      },
    ]);
  };

  const onSaveEdit = async () => {
    if (!editingId || !editingText.trim()) return;
    setSaving(true);
    try {
      const src = rows.find((x) => x.id === editingId)?.source || "comments";
      await updateMyComment(editingId, editingText, src);
      setEditingId("");
      setEditingText("");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`Guncelleme hatasi: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const onToggleLike = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const currentLiked = typeof prev.iLiked === "boolean" ? prev.iLiked : item.iLiked;
    const currentLikeCount = typeof prev.likeCount === "number" ? prev.likeCount : item.likeCount;
    const nextLiked = !currentLiked;
    const nextLikeCount = Math.max(0, currentLikeCount + (nextLiked ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: nextLiked, likeCount: nextLikeCount } }));
    setLikingId(item.id);
    try {
      await toggleCommentLike(item.id, nextLiked, item.source);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`Beğeni işlemi hatası: ${detail}`);
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iLiked: currentLiked, likeCount: currentLikeCount } }));
    } finally {
      setLikingId("");
    }
  };

  const onToggleFavorite = async (item: CommentFeedItem) => {
    const prev = optimisticById[item.id] || {};
    const currentFavorited = typeof prev.iFavorited === "boolean" ? prev.iFavorited : item.iFavorited;
    const currentFavoriteCount = typeof prev.favoriteCount === "number" ? prev.favoriteCount : item.favoriteCount;
    const nextFavorited = !currentFavorited;
    const nextFavoriteCount = Math.max(0, currentFavoriteCount + (nextFavorited ? 1 : -1));
    setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: nextFavorited, favoriteCount: nextFavoriteCount } }));
    setFavoritingId(item.id);
    try {
      await toggleCommentFavorite(item.id, nextFavorited, item.source);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`Favori işlemi hatası: ${detail}`);
      setOptimisticById((s) => ({ ...s, [item.id]: { ...(s[item.id] || {}), iFavorited: currentFavorited, favoriteCount: currentFavoriteCount } }));
    } finally {
      setFavoritingId("");
    }
  };

  const onSendReply = async (item: CommentFeedItem) => {
    const text = replyText.trim();
    if (!text) return;
    setReplying(true);
    try {
      await publishComment({
        text,
        topic: item.topic,
        parentId: item.id,
      });
      setReplyToId("");
      setReplyText("");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`Yanıt gönderilemedi: ${detail}`);
    } finally {
      setReplying(false);
    }
  };

  const onSendQuote = async (item: CommentFeedItem) => {
    const text = quoteText.trim();
    if (!text) return;
    setReplying(true);
    try {
      await publishComment({
        text,
        topic: item.topic,
        quoteOfId: item.id,
        quoteOfText: item.text,
        quoteOfUsername: item.authorUsername,
      });
      setQuoteToId("");
      setQuoteText("");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`Alıntı gönderilemedi: ${detail}`);
    } finally {
      setReplying(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.headerAction}>← Geri</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Yorumlarım</Text>
          <View style={styles.headerGhost} />
        </View>

        <View style={styles.content}>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={palette.textMuted} />
              <Text style={styles.loadingText}>Yorumlar yükleniyor...</Text>
            </View>
          ) : (
            <FlatList
              data={myRootComments}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Text style={styles.emptyText}>Yorum bulunamadı.</Text>}
              renderItem={({ item }) => {
                const editing = editingId === item.id;
                const mine = myIds.has(item.id);
                const optimistic = optimisticById[item.id] || {};
                const liked = typeof optimistic.iLiked === "boolean" ? optimistic.iLiked : item.iLiked;
                const favorited = typeof optimistic.iFavorited === "boolean" ? optimistic.iFavorited : item.iFavorited;
                const likeCount = typeof optimistic.likeCount === "number" ? optimistic.likeCount : item.likeCount;
                const favoriteCount = typeof optimistic.favoriteCount === "number" ? optimistic.favoriteCount : item.favoriteCount;
                return (
                  <Pressable style={styles.card} onPress={() => setFullscreenItem(item)}>
                    <View style={styles.topRow}>
                      <Text style={styles.author}>@{item.authorUsername.replace(/^@/, "")}</Text>
                      <Text style={styles.date}>{formatDate(item.createdAtMs)}</Text>
                    </View>
                    {item.quoteOfText ? (
                      <View style={styles.quoteBox}>
                        <Text style={styles.quoteMeta}>Alıntı: {item.quoteOfUsername || "@kullanici"}</Text>
                        <Text style={styles.quoteText} numberOfLines={2}>
                          {item.quoteOfText}
                        </Text>
                      </View>
                    ) : null}
                    {editing ? (
                      <TextInput
                        value={editingText}
                        onChangeText={setEditingText}
                        style={styles.editInput}
                        multiline
                        textAlignVertical="top"
                        placeholderTextColor={palette.textMuted}
                      />
                    ) : (
                      <Text style={styles.commentText}>{item.text}</Text>
                    )}
                    {item.mediaUrl ? (
                      item.mediaKind === "video" ? (
                        <View style={styles.mediaVideoWrap}>
                          <Video
                            source={{ uri: item.mediaUrl }}
                            style={styles.mediaVideo}
                            useNativeControls
                            resizeMode={ResizeMode.CONTAIN}
                          />
                          <View pointerEvents="none" style={styles.mediaVideoOverlay}>
                            <Text style={styles.mediaVideoOverlayTxt}>▶ Oynat</Text>
                          </View>
                        </View>
                      ) : (
                        <Image source={{ uri: item.mediaUrl }} style={styles.mediaImg} />
                      )
                    ) : null}

                    <View style={styles.socialRow}>
                      <Pressable
                        style={[styles.socialBtnIcon, liked && styles.socialBtnLikeActive]}
                        onPress={() => void onToggleLike(item)}
                        disabled={likingId === item.id}
                      >
                        <Text style={[styles.socialIcon, liked && styles.socialIconLikeActive]}>{liked ? "♥" : "♡"}</Text>
                        <Text style={[styles.socialCount, liked && styles.socialCountLikeActive]}>{likeCount}</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.socialBtnIcon, favorited && styles.socialBtnFavActive]}
                        onPress={() => void onToggleFavorite(item)}
                        disabled={favoritingId === item.id}
                      >
                        <Text style={[styles.socialIcon, favorited && styles.socialIconFavActive]}>{favorited ? "★" : "☆"}</Text>
                        <Text style={[styles.socialCount, favorited && styles.socialCountFavActive]}>{favoriteCount}</Text>
                      </Pressable>
                      <Pressable
                        style={styles.socialBtnIcon}
                        onPress={() => {
                          setQuoteToId((x) => (x === item.id ? "" : item.id));
                          setReplyToId("");
                        }}
                      >
                        <Text style={styles.socialIcon}>❝</Text>
                      </Pressable>
                      <Pressable
                        style={styles.socialBtnIcon}
                        onPress={() => {
                          setReplyToId((x) => (x === item.id ? "" : item.id));
                          setQuoteToId("");
                        }}
                      >
                        <Text style={styles.socialIcon}>💬</Text>
                        <Text style={styles.socialCount}>{item.replyCount}</Text>
                      </Pressable>
                    </View>

                    {mine ? <View style={styles.rowActions}>
                      {editing ? (
                        <>
                          <Pressable
                            style={[styles.actionBtn, styles.cancelBtn]}
                            onPress={() => {
                              setEditingId("");
                              setEditingText("");
                            }}
                          >
                            <Text style={styles.actionText}>✕</Text>
                          </Pressable>
                          <Pressable style={[styles.actionBtn, styles.saveBtn]} onPress={() => void onSaveEdit()}>
                            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionText}>💾</Text>}
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable
                            style={[styles.actionBtn, styles.editBtn]}
                            onPress={() => {
                              setEditingId(item.id);
                              setEditingText(item.text);
                            }}
                          >
                            <Text style={styles.actionText}>✎</Text>
                          </Pressable>
                          <Pressable style={[styles.actionBtn, styles.deleteBtn]} onPress={() => onAskDelete(item)}>
                            <Text style={styles.actionText}>🗑</Text>
                          </Pressable>
                        </>
                      )}
                    </View> : null}

                    {quoteToId === item.id ? (
                      <View style={styles.inlineComposer}>
                        <Text style={styles.inlineTitle}>Alıntı ile yeni yorum</Text>
                        <TextInput
                          value={quoteText}
                          onChangeText={setQuoteText}
                          style={styles.inlineInput}
                          multiline
                          placeholder="Alıntı yorumunuzu yazın"
                          placeholderTextColor={palette.textMuted}
                        />
                        <Pressable style={styles.inlineSendBtn} onPress={() => void onSendQuote(item)}>
                          <Text style={styles.inlineSendText}>{replying ? "Gönderiliyor..." : "Alıntıyı Paylaş"}</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {replyToId === item.id ? (
                      <View style={styles.inlineComposer}>
                        <Text style={styles.inlineTitle}>Yorumun altına yanıt yaz</Text>
                        <TextInput
                          value={replyText}
                          onChangeText={setReplyText}
                          style={styles.inlineInput}
                          multiline
                          placeholder="Yanıtınızı yazın"
                          placeholderTextColor={palette.textMuted}
                        />
                        <Pressable style={styles.inlineSendBtn} onPress={() => void onSendReply(item)}>
                          <Text style={styles.inlineSendText}>{replying ? "Gönderiliyor..." : "Yanıtı Gönder"}</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {(repliesByParent.get(item.id) || []).length ? (
                      <View style={styles.repliesWrap}>
                        {(repliesByParent.get(item.id) || []).map((r) => {
                          const ropt = optimisticById[r.id] || {};
                          const rLiked = typeof ropt.iLiked === "boolean" ? ropt.iLiked : r.iLiked;
                          const rFav = typeof ropt.iFavorited === "boolean" ? ropt.iFavorited : r.iFavorited;
                          const rLikeCount = typeof ropt.likeCount === "number" ? ropt.likeCount : r.likeCount;
                          const rFavCount = typeof ropt.favoriteCount === "number" ? ropt.favoriteCount : r.favoriteCount;
                          return (
                            <View key={r.id} style={styles.replyBubble}>
                              <Text style={styles.replyMeta}>{r.authorUsername} • {formatDate(r.createdAtMs)}</Text>
                              <Text style={styles.replyText}>{r.text}</Text>
                              <View style={styles.replyActionsRow}>
                                <Pressable style={styles.replyActionPill} onPress={() => void onToggleLike(r)} disabled={likingId === r.id}>
                                  <Text style={[styles.replyActionTxt, rLiked && styles.socialIconLikeActive]}>{rLiked ? "♥" : "♡"} {rLikeCount}</Text>
                                </Pressable>
                                <Pressable style={styles.replyActionPill} onPress={() => void onToggleFavorite(r)} disabled={favoritingId === r.id}>
                                  <Text style={[styles.replyActionTxt, rFav && styles.socialIconFavActive]}>{rFav ? "★" : "☆"} {rFavCount}</Text>
                                </Pressable>
                                <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((x) => (x === r.id ? "" : r.id)); setQuoteToId(""); }}>
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
              }}
            />
          )}

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
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
                  const mine = myIds.has(fullscreenItem.id);
                  return (
                    <>
                      <Text style={styles.fullscreenUser}>{fullscreenItem.authorUsername}</Text>
                      <Text style={styles.fullscreenDate}>{formatDate(fullscreenItem.createdAtMs)}</Text>
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
                      <View style={styles.socialRow}>
                        <Pressable style={[styles.socialBtnIcon, liked && styles.socialBtnLikeActive]} onPress={() => void onToggleLike(fullscreenItem)} disabled={likingId === fullscreenItem.id}>
                          <Text style={[styles.socialIcon, liked && styles.socialIconLikeActive]}>{liked ? "♥" : "♡"}</Text>
                          <Text style={[styles.socialCount, liked && styles.socialCountLikeActive]}>{likeCount}</Text>
                        </Pressable>
                        <Pressable style={[styles.socialBtnIcon, favorited && styles.socialBtnFavActive]} onPress={() => void onToggleFavorite(fullscreenItem)} disabled={favoritingId === fullscreenItem.id}>
                          <Text style={[styles.socialIcon, favorited && styles.socialIconFavActive]}>{favorited ? "★" : "☆"}</Text>
                          <Text style={[styles.socialCount, favorited && styles.socialCountFavActive]}>{favoriteCount}</Text>
                        </Pressable>
                        <Pressable style={styles.socialBtnIcon} onPress={() => { setQuoteToId((x) => (x === fullscreenItem.id ? "" : fullscreenItem.id)); setReplyToId(""); }}>
                          <Text style={styles.socialIcon}>❝</Text>
                        </Pressable>
                        <Pressable style={styles.socialBtnIcon} onPress={() => { setReplyToId((x) => (x === fullscreenItem.id ? "" : fullscreenItem.id)); setQuoteToId(""); }}>
                          <Text style={styles.socialIcon}>💬</Text>
                          <Text style={styles.socialCount}>{fullscreenItem.replyCount}</Text>
                        </Pressable>
                      </View>
                      {mine ? <View style={styles.rowActions}>
                        {editingId === fullscreenItem.id ? (
                          <>
                            <Pressable style={[styles.actionBtn, styles.cancelBtn]} onPress={() => { setEditingId(""); setEditingText(""); }}>
                              <Text style={styles.actionText}>✕</Text>
                            </Pressable>
                            <Pressable style={[styles.actionBtn, styles.saveBtn]} onPress={() => void onSaveEdit()}>
                              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionText}>💾</Text>}
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Pressable style={[styles.actionBtn, styles.editBtn]} onPress={() => { setEditingId(fullscreenItem.id); setEditingText(fullscreenItem.text); }}>
                              <Text style={styles.actionText}>✎</Text>
                            </Pressable>
                            <Pressable style={[styles.actionBtn, styles.deleteBtn]} onPress={() => onAskDelete(fullscreenItem)}>
                              <Text style={styles.actionText}>🗑</Text>
                            </Pressable>
                          </>
                        )}
                      </View> : null}
                      {quoteToId === fullscreenItem.id ? (
                        <View style={styles.inlineComposer}>
                          <Text style={styles.inlineTitle}>Alıntı ile yeni yorum</Text>
                          <TextInput value={quoteText} onChangeText={setQuoteText} style={styles.inlineInput} multiline placeholder="Alıntı yorumunuzu yazın" placeholderTextColor={palette.textMuted} />
                          <Pressable style={styles.inlineSendBtn} onPress={() => void onSendQuote(fullscreenItem)}>
                            <Text style={styles.inlineSendText}>{replying ? "Gönderiliyor..." : "Alıntıyı Paylaş"}</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {replyToId === fullscreenItem.id ? (
                        <View style={styles.inlineComposer}>
                          <Text style={styles.inlineTitle}>Yorumun altına yanıt yaz</Text>
                          <TextInput value={replyText} onChangeText={setReplyText} style={styles.inlineInput} multiline placeholder="Yanıtınızı yazın" placeholderTextColor={palette.textMuted} />
                          <Pressable style={styles.inlineSendBtn} onPress={() => void onSendReply(fullscreenItem)}>
                            <Text style={styles.inlineSendText}>{replying ? "Gönderiliyor..." : "Yanıtı Gönder"}</Text>
                          </Pressable>
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
                                <Text style={styles.replyMeta}>{r.authorUsername} • {formatDate(r.createdAtMs)}</Text>
                                <Text style={styles.replyText}>{r.text}</Text>
                                <View style={styles.replyActionsRow}>
                                  <Pressable style={styles.replyActionPill} onPress={() => void onToggleLike(r)} disabled={likingId === r.id}>
                                    <Text style={[styles.replyActionTxt, rLiked && styles.socialIconLikeActive]}>{rLiked ? "♥" : "♡"} {rLikeCount}</Text>
                                  </Pressable>
                                  <Pressable style={styles.replyActionPill} onPress={() => void onToggleFavorite(r)} disabled={favoritingId === r.id}>
                                    <Text style={[styles.replyActionTxt, rFav && styles.socialIconFavActive]}>{rFav ? "★" : "☆"} {rFavCount}</Text>
                                  </Pressable>
                                  <Pressable style={styles.replyActionPill} onPress={() => { setReplyToId((x) => (x === r.id ? "" : r.id)); setQuoteToId(""); }}>
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
      </SafeAreaView>
    </Modal>
  );
}


