import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { localeForLang, t } from "../lib/i18n";
import { useAppTheme, useThemeColors } from "../theme/ThemeProvider";
import { createMesajlarimModalStyles } from "./mesajlarimModalStyles";
import {
  canUseMessagesFirestore,
  deleteConversation,
  getMyUid,
  resolveMyWebMessagingUserId,
  markConversationRead,
  normalizeUsernameInput,
  sendMessageToPeer,
  subscribeIncomingMessageAlerts,
  subscribeConversationMessages,
  subscribeConversations,
  type ConversationItem,
  type IncomingMessageAlert,
  type MessageAttachment,
  type MessageItem,
} from "../lib/messagesFirestore";
import { ensureFirestoreAuthReady } from "../lib/firebaseClient";

import {
  MAX_IMAGE_PICK_BYTES,
  MAX_VIDEO_PICK_BYTES,
  copyImagePickToCacheIfNeeded,
  copyVideoPickToCacheIfNeeded,
  finalizePickedImageForUpload,
  finalizePickedVideoForUpload,
  getFileBytes,
  pickGalleryAssetMediaKind,
} from "../lib/pickedMediaPrepare";

/** Mesaj ekinde video üst süre (sn cinsinden picker; sunucu yükleme ile uyumlu). */
const MESSAGE_MAX_VIDEO_DURATION_MS = 120 * 1000;

type Props = {
  visible: boolean;
  onClose: () => void;
  initialCompose?: boolean;
  initialToLabel?: string;
  initialToEmail?: string;
};

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😢", "😭", "😡",
  "👍", "👎", "👏", "🙏", "🤝", "💪", "🔥", "🎉", "💯", "✅", "❗", "❓",
  "❤️", "💙", "💚", "💛", "🖤", "💜", "📈", "📉", "💸", "💼", "🧠", "🫡",
];

function formatDateForLocale(ms: number, locale: string): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getAvatarInitial(label: string, email: string, peerKey: string, locale: string): string {
  const base = (label || email || peerKey || "").trim();
  if (!base) return "?";
  const cleaned = base.replace(/^@/, "").trim();
  return cleaned ? cleaned[0]!.toLocaleUpperCase(locale) : "?";
}

function getConversationDisplayName(item: ConversationItem): string {
  const raw = (item.peerLabel || "").trim();
  if (raw.startsWith("@")) return raw;
  if (raw && !raw.includes("@")) return `@${raw}`;
  return item.peerKey?.startsWith("@") ? item.peerKey : raw || item.peerKey || "@kullanici";
}

export function MesajlarimModal({
  visible,
  onClose,
  initialCompose = false,
  initialToLabel = "",
  initialToEmail = "",
}: Props) {
  const { lang } = useAppTheme();
  const locale = useMemo(() => localeForLang(lang), [lang]);
  const palette = useThemeColors();
  const styles = useMemo(() => createMesajlarimModalStyles(palette), [palette]);
  const safeInsets = useSafeAreaInsets();

  const [myUid, setMyUid] = useState("");
  const [myWebUserId, setMyWebUserId] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [activePeer, setActivePeer] = useState<ConversationItem | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"list" | "chat" | "compose">(initialCompose ? "compose" : "list");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [toLabel, setToLabel] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [text, setText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [draftAttachment, setDraftAttachment] = useState<MessageAttachment | null>(null);
  const [addedAttachment, setAddedAttachment] = useState<MessageAttachment | null>(null);
  const [zoomUri, setZoomUri] = useState("");
  const [zoomOpen, setZoomOpen] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [playingUri, setPlayingUri] = useState("");
  const [playingPositionMs, setPlayingPositionMs] = useState(0);
  const [playingDurationMs, setPlayingDurationMs] = useState(0);
  const [recordingMs, setRecordingMs] = useState(0);
  const [incomingAlerts, setIncomingAlerts] = useState<IncomingMessageAlert[]>([]);
  const draftAudioSoundRef = useRef<Audio.Sound | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendLockRef = useRef(false);
  const lastOutgoingSendMsRef = useRef(0);
  /** Aynı alıcıya arka arkaya "gönderildi" toast spamını önler */
  const peersShownOutgoingSuccessToastRef = useRef(new Set<string>());
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!visible) {
      sendLockRef.current = false;
      setIsSending(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !canUseMessagesFirestore()) return;
    void ensureFirestoreAuthReady().catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setMode(initialCompose ? "compose" : "list");
    setActivePeer(null);
    setMessages([]);
    setEmojiOpen(false);
    setDraftAttachment(null);
    setAddedAttachment(null);
    setToLabel(initialCompose ? normalizeUsernameInput(initialToLabel) : "");
    setToEmail(initialCompose ? initialToEmail : "");
    if (!canUseMessagesFirestore()) {
      setErrorText(t(lang, "msg_service_unavailable"));
      return;
    }
    let unsub: (() => void) | null = null;
    let closed = false;
    const listLoadFailsafe = setTimeout(() => {
      if (!closed) setLoadingList(false);
    }, 18_000);
    setLoadingList(true);
    setErrorText("");
    void (async () => {
      try {
        await ensureFirestoreAuthReady();
        const uid = await getMyUid();
        const webId = await resolveMyWebMessagingUserId().catch(() => uid);
        if (!closed) {
          setMyUid(uid);
          setMyWebUserId(webId);
        }
        unsub = await subscribeConversations(
          (items) => {
            if (closed) return;
            setConversations(items);
            clearTimeout(listLoadFailsafe);
            setLoadingList(false);
          },
          (err) => {
            if (closed) return;
            setErrorText(err);
            clearTimeout(listLoadFailsafe);
            setLoadingList(false);
          },
        );
      } catch (e) {
        if (closed) return;
        const detail = e instanceof Error ? e.message : String(e);
        setErrorText(detail.trim() ? detail : t(lang, "msg_load_error"));
        clearTimeout(listLoadFailsafe);
        setLoadingList(false);
      }
    })();
    return () => {
      closed = true;
      clearTimeout(listLoadFailsafe);
      if (unsub) unsub();
    };
  }, [visible, initialCompose, initialToLabel, initialToEmail, lang]);

  useEffect(() => {
    if (!visible || !canUseMessagesFirestore()) return;
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
  }, [visible]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (draftAudioSoundRef.current) {
        void draftAudioSoundRef.current.unloadAsync();
        draftAudioSoundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!visible || !activePeer?.peerKey) return;
    let closed = false;
    let unsub: (() => void) | null = null;
    const chatFailsafe = setTimeout(() => {
      if (!closed) setLoadingChat(false);
    }, 14_000);
    setLoadingChat(true);
    setErrorText("");
    void (async () => {
      try {
        await ensureFirestoreAuthReady();
        unsub = await subscribeConversationMessages(
          activePeer.peerKey,
          (items) => {
            if (closed) return;
            setMessages(items);
            clearTimeout(chatFailsafe);
            setLoadingChat(false);
          },
          (errMsg) => {
            if (closed) return;
            setErrorText(errMsg.trim() ? errMsg : t(lang, "msg_load_error"));
            clearTimeout(chatFailsafe);
            setLoadingChat(false);
          },
          activePeer.peerUserId,
        );
      } catch (e) {
        if (closed) return;
        setErrorText(e instanceof Error ? e.message : t(lang, "msg_load_error"));
        clearTimeout(chatFailsafe);
        setLoadingChat(false);
      }
    })();
    return () => {
      closed = true;
      clearTimeout(chatFailsafe);
      if (unsub) unsub();
    };
  }, [visible, activePeer?.peerKey, activePeer?.peerUserId, lang]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale);
    if (!q) return conversations;
    return conversations.filter((c) => {
      const row = `${getConversationDisplayName(c)} ${c.peerEmail}`.toLocaleLowerCase(locale);
      return row.includes(q);
    });
  }, [conversations, search, locale]);

  const composeHints = useMemo(() => {
    if (!toLabel.trim()) return [];
    const q = normalizeUsernameInput(toLabel).toLocaleLowerCase(locale);
    return conversations
      .filter((c) => getConversationDisplayName(c).toLocaleLowerCase(locale).includes(q))
      .slice(0, 5);
  }, [toLabel, conversations, locale]);

  const unreadMap = useMemo(() => {
    const m = new Map<string, number>();
    incomingAlerts.forEach((a) => m.set(a.peerUserId, a.unreadCount));
    return m;
  }, [incomingAlerts]);

  const canSend = useMemo(() => text.trim().length > 0 || !!addedAttachment?.uri, [text, addedAttachment]);
  const sendDisabled = !canSend || isSending;

  const onPickAttachment = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t(lang, "perm_media_title"), t(lang, "perm_media_body"));
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 0.8,
        ...(Platform.OS === "ios"
          ? {
              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
              videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
            }
          : {
              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
            }),
        videoMaxDuration: MESSAGE_MAX_VIDEO_DURATION_MS / 1000,
      });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0]!;
      const kind = pickGalleryAssetMediaKind(a);

      if (kind === "video") {
        const durationMs = typeof a.duration === "number" ? a.duration : 0;
        const videoWorkUri = await copyVideoPickToCacheIfNeeded(a.uri);
        let bytes = typeof a.fileSize === "number" && a.fileSize > 0 ? a.fileSize : 0;
        if (bytes <= 0) bytes = await getFileBytes(videoWorkUri);

        if (durationMs > MESSAGE_MAX_VIDEO_DURATION_MS) {
          Alert.alert(t(lang, "msg_video_too_long_title"), t(lang, "msg_video_too_long_body"));
          return;
        }
        if (bytes > MAX_VIDEO_PICK_BYTES) {
          Alert.alert(t(lang, "video_large_title"), t(lang, "video_large_body"));
          return;
        }

        setDraftAttachment(null);
        setAddedAttachment({ kind: "video", uri: videoWorkUri, ...(durationMs > 0 ? { durationMs } : {}) });
        return;
      }

      const imageWorkUri = await copyImagePickToCacheIfNeeded(a.uri);
      let originalImageBytes =
        typeof a.fileSize === "number" && a.fileSize > 0 ? a.fileSize : 0;
      if (originalImageBytes <= 0) originalImageBytes = await getFileBytes(imageWorkUri);

      if (originalImageBytes > MAX_IMAGE_PICK_BYTES) {
        Alert.alert(t(lang, "photo_too_large_title"), t(lang, "photo_too_large_body"));
        return;
      }

      setDraftAttachment(null);
      setAddedAttachment({ kind: "image", uri: imageWorkUri });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      Alert.alert(t(lang, "my_messages"), detail.trim() ? detail : "Dosya seçilemedi.");
    }
  };

  const onSend = async () => {
    const sendT = Date.now();
    if (sendT - lastOutgoingSendMsRef.current < 580) return;
    if (sendLockRef.current) return;
    const peer = activePeer ?? null;
    const peerLabel = normalizeUsernameInput(peer?.peerLabel || toLabel);
    const peerEmail = (peer?.peerEmail || toEmail || "").trim();
    if (!peerLabel && !peerEmail) {
      setErrorText(t(lang, "msg_user_or_email_required"));
      Alert.alert(t(lang, "my_messages"), t(lang, "msg_user_or_email_required"));
      return;
    }
    if (!canSend) {
      Alert.alert(t(lang, "my_messages"), "Önce yazı yazın veya 📎 / 🎤 ile ek ekleyin.");
      return;
    }

    lastOutgoingSendMsRef.current = sendT;
    sendLockRef.current = true;
    setIsSending(true);
    setErrorText("");
    Keyboard.dismiss();

    const textSnap = text;
    const attSnap = addedAttachment;

    const toastDedupeKey = `${(peer?.peerUserId || "").trim() || `${peerLabel}|${peerEmail}`}`;
    const shouldShowSentToast = toastDedupeKey.length > 0 && !peersShownOutgoingSuccessToastRef.current.has(toastDedupeKey);

    try {
      let attachmentOut: typeof attSnap = attSnap;

      if (attSnap?.kind === "video" && attSnap.uri) {
        const done = await finalizePickedVideoForUpload(attSnap.uri, attSnap.durationMs ?? 0, {
          bitrateDurationCapSec: MESSAGE_MAX_VIDEO_DURATION_MS / 1000,
        });
        if (!done) {
          Alert.alert(t(lang, "video_compress_fail_title"), t(lang, "video_compress_fail_body"));
          return;
        }
        attachmentOut = { ...attSnap, uri: done.uri };
      } else if (attSnap?.kind === "image" && attSnap.uri) {
        const done = await finalizePickedImageForUpload(attSnap.uri);
        if (!done) {
          Alert.alert(t(lang, "photo_compress_fail_title"), t(lang, "photo_compress_fail_body"));
          return;
        }
        attachmentOut = { ...attSnap, uri: done.uri };
      }

      const peerKey = await sendMessageToPeer({
        peerKey: peer?.peerKey,
        peerLabel,
        peerEmail,
        ...(peer?.peerUserId?.trim() ? { recipientWebUserId: peer.peerUserId.trim() } : {}),
        ...(myWebUserId.trim() ? { senderWebUserId: myWebUserId.trim() } : {}),
        text: textSnap,
        ...(attachmentOut ? { attachment: attachmentOut } : {}),
      });

      setText("");
      setDraftAttachment(null);
      setAddedAttachment(null);

      if (!peer && peerKey) {
        setMode("list");
        setToLabel("");
        setToEmail("");
      }

      if (shouldShowSentToast) {
        peersShownOutgoingSuccessToastRef.current.add(toastDedupeKey);
        Alert.alert(t(lang, "msg_sent_title"), t(lang, "msg_sent_ok"));
      }
    } catch (e) {
      if (shouldShowSentToast) peersShownOutgoingSuccessToastRef.current.delete(toastDedupeKey);
      setText(textSnap);
      setAddedAttachment(attSnap);
      setDraftAttachment(null);
      const detail = e instanceof Error ? e.message : String(e);
      setErrorText(`${t(lang, "msg_send_failed")} ${detail}`);
    } finally {
      sendLockRef.current = false;
      setIsSending(false);
    }
  };

  const onEmojiPick = (e: string) => setText((prev) => `${prev}${e}`);

  const onMicPress = async () => {
    if (recordingBusy) return;
    setRecordingBusy(true);
    try {
      if (!recording) {
        let granted = (await Audio.getPermissionsAsync()).granted;
        if (!granted) {
          const req = await Audio.requestPermissionsAsync();
          granted = !!req.granted;
        }
        if (!granted) {
          Alert.alert(t(lang, "perm_mic_title"), t(lang, "perm_mic_denied_body"), [
            { text: t(lang, "cancel"), style: "cancel" },
            { text: t(lang, "settings_title"), onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const r = new Audio.Recording();
        await r.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await r.startAsync();
        setRecordingMs(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          void r.getStatusAsync().then((st) => {
            if (st.isRecording) setRecordingMs(st.durationMillis ?? 0);
          });
        }, 300);
        setRecording(r);
        return;
      }
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI() || "";
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(null);
      if (uri) {
        setDraftAttachment(null);
        setAddedAttachment({ kind: "audio", uri, durationMs: recordingMs });
      }
    } catch {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(null);
      Alert.alert(t(lang, "audio_record_fail_title"), t(lang, "audio_record_fail_body"));
    } finally {
      setRecordingBusy(false);
    }
  };

  const playAudio = async (uri: string) => {
    try {
      if (playingUri === uri) {
        setPlayingPositionMs(0);
        setPlayingDurationMs(0);
        setPlayingUri("");
        return;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      setPlayingUri(uri);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) {
          setPlayingPositionMs(0);
          setPlayingDurationMs(0);
          setPlayingUri("");
          void sound.unloadAsync();
          return;
        }
        setPlayingPositionMs(st.positionMillis ?? 0);
        setPlayingDurationMs(st.durationMillis ?? 0);
        if (st.didJustFinish) {
          setPlayingPositionMs(0);
          setPlayingDurationMs(0);
          setPlayingUri("");
          void sound.unloadAsync();
        }
      });
    } catch {
      setPlayingPositionMs(0);
      setPlayingDurationMs(0);
      setPlayingUri("");
    }
  };

  const playDraftAudio = async () => {
    if (!draftAttachment || draftAttachment.kind !== "audio") return;
    const uri = draftAttachment.uri;
    try {
      if (playingUri === uri) {
        if (draftAudioSoundRef.current) {
          await draftAudioSoundRef.current.unloadAsync();
          draftAudioSoundRef.current = null;
        }
        setPlayingPositionMs(0);
        setPlayingDurationMs(0);
        setPlayingUri("");
        return;
      }
      if (draftAudioSoundRef.current) {
        await draftAudioSoundRef.current.unloadAsync();
        draftAudioSoundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      draftAudioSoundRef.current = sound;
      setPlayingUri(uri);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) {
          setPlayingPositionMs(0);
          setPlayingDurationMs(0);
          setPlayingUri("");
          void sound.unloadAsync();
          if (draftAudioSoundRef.current === sound) draftAudioSoundRef.current = null;
          return;
        }
        setPlayingPositionMs(st.positionMillis ?? 0);
        setPlayingDurationMs(st.durationMillis ?? 0);
        if (st.didJustFinish) {
          setPlayingPositionMs(0);
          setPlayingDurationMs(0);
          setPlayingUri("");
          void sound.unloadAsync();
          if (draftAudioSoundRef.current === sound) draftAudioSoundRef.current = null;
        }
      });
    } catch {
      setPlayingPositionMs(0);
      setPlayingDurationMs(0);
      setPlayingUri("");
    }
  };

  const renderAudioWidget = (args: { uri: string; durationMs?: number; onPress: () => void }) => {
    const isActive = playingUri === args.uri;
    const total = isActive ? Math.max(playingDurationMs, args.durationMs ?? 0) : (args.durationMs ?? 0);
    const current = isActive ? playingPositionMs : 0;
    const pct = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
    return (
      <Pressable style={styles.audioChip} onPress={args.onPress}>
        <View style={styles.audioTopRow}>
          <Text style={styles.audioChipText}>
            {isActive ? "⏸" : "▶"} {t(lang, "audio_record_label")}
          </Text>
          <Text style={styles.audioTime}>{formatDuration(current)} / {formatDuration(total)}</Text>
        </View>
        <View style={styles.audioProgressTrack}>
          <View style={[styles.audioProgressFill, { width: `${pct * 100}%` }]} />
        </View>
      </Pressable>
    );
  };

  const onAddAttachmentToMessage = () => {
    if (!draftAttachment) return;
    setAddedAttachment(draftAttachment);
    setDraftAttachment(null);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (mode === "chat") {
                setMode("list");
                setActivePeer(null);
                return;
              }
              if (mode === "compose") {
                setMode("list");
                return;
              }
              onClose();
            }}
            hitSlop={8}
          >
            <Text style={styles.headerAction}>← {t(lang, "back")}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {mode === "chat"
              ? activePeer
                ? getConversationDisplayName(activePeer)
                : t(lang, "chat_title")
              : t(lang, "my_messages")}
          </Text>
          <Pressable style={styles.headerMiniBtn} onPress={() => setMode("compose")}>
            <Text style={styles.headerMiniBtnText}>{t(lang, "write_message")}</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          {mode === "list" ? (
            <View style={styles.listWrap}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder={t(lang, "msg_search_user_placeholder")}
                placeholderTextColor={palette.textMuted}
              />
              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
              <FlatList
                  style={{ flex: 1 }}
                  data={filteredConversations}
                  keyExtractor={(item) => item.peerKey}
                  contentContainerStyle={styles.listContent}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    loadingList ? (
                      <View style={styles.loadingWrap}>
                        <ActivityIndicator size="small" color={palette.textMuted} />
                        <Text style={styles.loadingText}>{t(lang, "msg_loading_chats")}</Text>
                      </View>
                    ) : errorText ? (
                      <Text style={styles.emptyText}>{t(lang, "msg_fix_firebase_hint")}</Text>
                    ) : (
                      <Text style={styles.emptyText}>{t(lang, "msg_no_chats")}</Text>
                    )
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.msgCard}
                      onPress={() => {
                        setActivePeer(item);
                        setMode("chat");
                        if (item.peerUserId) {
                          void markConversationRead(item.peerUserId);
                        }
                      }}
                    >
                      <View style={styles.msgTopRow}>
                        <View style={styles.msgAvatarWrap}>
                          {item.peerPhotoUri ? (
                            <Image source={{ uri: item.peerPhotoUri }} style={styles.msgAvatarImage} />
                          ) : (
                            <View style={styles.msgAvatarFallback}>
                              <Text style={styles.msgAvatarInitial}>
                                {getAvatarInitial(item.peerLabel, item.peerEmail, item.peerKey, locale)}
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.msgMain}>
                          <View style={styles.msgHeader}>
                            <Text style={styles.msgTo}>{getConversationDisplayName(item)}</Text>
                            <View style={styles.msgHeaderRight}>
                              {item.peerUserId && (unreadMap.get(item.peerUserId) || 0) > 0 ? (
                                <View style={styles.msgUnreadBadge}>
                                  <Text style={styles.msgUnreadBadgeText}>
                                    {(unreadMap.get(item.peerUserId) || 0) > 99 ? "99+" : unreadMap.get(item.peerUserId)}
                                  </Text>
                                </View>
                              ) : null}
                              <Text style={styles.msgAt}>{formatDateForLocale(item.lastAtMs, locale)}</Text>
                            </View>
                          </View>
                          <Text style={styles.msgBody} numberOfLines={1}>
                            {item.lastText || t(lang, "open_chat_hint")}
                          </Text>
                          <View style={styles.msgFooterRow}>
                            <View />
                            <Pressable
                              style={styles.deleteConvBtn}
                              onPress={(e) => {
                                e.stopPropagation();
                                void deleteConversation(item);
                              }}
                            >
                              <Text style={styles.deleteConvText}>🗑</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  )}
                />
            </View>
          ) : null}

          {mode === "compose" ? (
            <KeyboardAvoidingView
              style={styles.composeKeyboardWrap}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
            >
              <ScrollView
                style={styles.composeScroll}
                contentContainerStyle={styles.composeScrollContent}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="on-drag"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <View style={styles.composeCard}>
                  <Text style={styles.label}>{t(lang, "username_label")}</Text>
                  <TextInput
                    value={toLabel}
                    onChangeText={(v) => setToLabel(normalizeUsernameInput(v))}
                    style={styles.input}
                    placeholder={t(lang, "username_example_placeholder")}
                    placeholderTextColor={palette.textMuted}
                  />
                  {composeHints.length ? (
                    <View style={styles.hintWrap}>
                      {composeHints.map((h) => (
                        <Pressable
                          key={h.peerKey}
                          style={styles.hintChip}
                          onPress={() => {
                            setToLabel(normalizeUsernameInput(h.peerLabel));
                            setToEmail(h.peerEmail);
                          }}
                        >
                          <Text style={styles.hintChipText}>{getConversationDisplayName(h)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.label}>{t(lang, "email_optional_label")}</Text>
                  <TextInput
                    value={toEmail}
                    onChangeText={setToEmail}
                    style={styles.input}
                    placeholder={t(lang, "email_example_placeholder")}
                    placeholderTextColor={palette.textMuted}
                  />
                  <Text style={styles.label}>{t(lang, "message_field_label")}</Text>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    style={[styles.input, styles.textArea]}
                    multiline
                    placeholder={t(lang, "message_compose_placeholder")}
                    placeholderTextColor={palette.textMuted}
                  />
                  {draftAttachment ? (
                    <View style={styles.attachPreview}>
                      <Text style={styles.attachPreviewText}>
                        {t(lang, "attachment_ready_prefix")}{" "}
                        {draftAttachment.kind === "video"
                          ? t(lang, "video_word")
                          : draftAttachment.kind === "audio"
                            ? `${t(lang, "audio_record_label")} ${formatDuration(draftAttachment.durationMs ?? recordingMs)}`
                            : t(lang, "photo_word")}{" "}
                        {t(lang, "attachment_ready_suffix")}
                      </Text>
                      <View style={styles.attachActions}>
                        <Pressable onPress={() => setDraftAttachment(null)}>
                          <Text style={styles.attachRemove}>{t(lang, "delete")}</Text>
                        </Pressable>
                        <Pressable onPress={onAddAttachmentToMessage}>
                          <Text style={styles.attachAdd}>{t(lang, "attach_add_short")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {addedAttachment ? (
                    <View style={[styles.attachPreview, styles.attachPreviewColumn]}>
                      <View style={styles.attachThumbRow}>
                        {addedAttachment.kind === "image" ? (
                          <Image source={{ uri: addedAttachment.uri }} style={styles.embedPreviewImage} />
                        ) : null}
                        {addedAttachment.kind === "video" ? <Text style={styles.attachPreviewText}>{t(lang, "video_attached_to_msg")}</Text> : null}
                        {addedAttachment.kind === "audio" ? (
                          renderAudioWidget({
                            uri: addedAttachment.uri,
                            durationMs: addedAttachment.durationMs,
                            onPress: () => void playDraftAudio(),
                          })
                        ) : null}
                        <Pressable
                          hitSlop={10}
                          onPress={() => {
                            setAddedAttachment(null);
                          }}
                        >
                          <Text style={styles.attachRemove}>{t(lang, "delete")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {recording ? (
                    <Text style={styles.recordingText}>
                      {t(lang, "msg_recording_line")} {formatDuration(recordingMs)}
                    </Text>
                  ) : null}
                  {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
                </View>
              </ScrollView>
              {emojiOpen ? (
                <View style={styles.emojiPanel}>
                  {EMOJIS.map((e) => (
                    <Pressable key={e} style={styles.emojiCell} onPress={() => onEmojiPick(e)}>
                      <Text style={styles.emojiText}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View
                style={[styles.composeToolbarWrap, { paddingBottom: Math.max(safeInsets.bottom, 12) }]}
                collapsable={false}
              >
                <View style={styles.composeToolbarRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.iconBtn}
                    onPress={() => void onPickAttachment()}
                    accessibilityRole="button"
                  >
                    <Text style={styles.iconBtnText}>📎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.iconBtn}
                    onPress={() => void onMicPress()}
                    accessibilityRole="button"
                  >
                    <Text style={styles.iconBtnText}>{recording ? "⏹" : "🎤"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.iconBtn}
                    onPress={() => setEmojiOpen((v) => !v)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.iconBtnText}>😊</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    disabled={sendDisabled}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={[styles.sendSlimBtn, sendDisabled && styles.sendBtnDisabled]}
                    onPress={() => void onSend()}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: sendDisabled }}
                  >
                    {isSending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.sendSlimText}>➤</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          ) : null}

          {mode === "chat" ? (
            <KeyboardAvoidingView
              style={styles.chatWrap}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
            >
              <View style={styles.chatColumn}>
              <FlatList
                style={styles.chatList}
                data={messages}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="always"
                ListHeaderComponent={
                  loadingChat ? (
                    <View style={styles.chatLoadingHeader}>
                      <ActivityIndicator size="small" color={palette.textMuted} />
                      <Text style={styles.chatLoadingHeaderText}>{t(lang, "msg_loading_thread")}</Text>
                    </View>
                  ) : null
                }
                ListEmptyComponent={<Text style={styles.emptyText}>{t(lang, "chat_empty")}</Text>}
                renderItem={({ item }) => {
                  const mine = item.fromUid === myUid || (!!myWebUserId && item.fromUid === myWebUserId);
                  return (
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                      {item.attachment?.kind === "image" ? (
                        <Pressable
                          onPress={() => {
                            setZoomUri(item.attachment!.uri);
                            setZoomOpen(true);
                          }}
                        >
                          <Image source={{ uri: item.attachment.uri }} style={styles.msgImage} />
                        </Pressable>
                      ) : null}
                      {item.attachment?.kind === "video" ? <Text style={styles.videoBadge}>{t(lang, "video_attachment_badge")}</Text> : null}
                      {item.attachment?.kind === "audio" ? (
                        renderAudioWidget({
                          uri: item.attachment.uri,
                          durationMs: item.attachment.durationMs,
                          onPress: () => void playAudio(item.attachment!.uri),
                        })
                      ) : null}
                      {item.text ? <Text style={styles.bubbleText}>{item.text}</Text> : null}
                      <Text style={styles.bubbleAt}>{formatDateForLocale(item.createdAtMs, locale)}</Text>
                    </View>
                  );
                }}
              />
              <View style={[styles.chatFooter, { paddingBottom: Math.max(safeInsets.bottom, 10) }]}>
                <View style={styles.chatComposer}>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    style={[styles.input, styles.chatInput]}
                    multiline
                    placeholder={t(lang, "message_chat_placeholder")}
                    placeholderTextColor={palette.textMuted}
                  />
                  <View style={styles.iconGrid}>
                    <View style={styles.iconRow2}>
                      <TouchableOpacity activeOpacity={0.75} style={styles.iconBtn} onPress={() => void onPickAttachment()}>
                        <Text style={styles.iconBtnText}>📎</Text>
                      </TouchableOpacity>
                      <TouchableOpacity activeOpacity={0.75} style={styles.iconBtn} onPress={() => void onMicPress()}>
                        <Text style={styles.iconBtnText}>{recording ? "⏹" : "🎤"}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.iconRow2}>
                      <TouchableOpacity activeOpacity={0.75} style={styles.iconBtn} onPress={() => setEmojiOpen((v) => !v)}>
                        <Text style={styles.iconBtnText}>😊</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        disabled={sendDisabled}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={[styles.sendSlimBtn, sendDisabled && styles.sendBtnDisabled]}
                        onPress={() => void onSend()}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: sendDisabled }}
                      >
                        {isSending ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.sendSlimText}>➤</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                {recording ? (
                  <Text style={styles.recordingText}>
                    {t(lang, "msg_recording_line")} {formatDuration(recordingMs)}
                  </Text>
                ) : null}
                {draftAttachment ? (
                  <View style={styles.attachPreview}>
                    <Text style={styles.attachPreviewText}>
                      {t(lang, "attachment_ready_prefix")}{" "}
                      {draftAttachment.kind === "video"
                        ? t(lang, "video_word")
                        : draftAttachment.kind === "audio"
                          ? `${t(lang, "audio_record_label")} ${formatDuration(draftAttachment.durationMs ?? recordingMs)}`
                          : t(lang, "photo_word")}{" "}
                      {t(lang, "attachment_ready_suffix")}
                    </Text>
                    <View style={styles.attachActions}>
                      <Pressable onPress={() => setDraftAttachment(null)}>
                        <Text style={styles.attachRemove}>{t(lang, "delete")}</Text>
                      </Pressable>
                      <Pressable onPress={onAddAttachmentToMessage}>
                        <Text style={styles.attachAdd}>{t(lang, "attach_add_short")}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {addedAttachment ? (
                  <View style={styles.attachPreview}>
                    {addedAttachment.kind === "image" ? <Image source={{ uri: addedAttachment.uri }} style={styles.embedPreviewImage} /> : null}
                    {addedAttachment.kind === "video" ? <Text style={styles.attachPreviewText}>{t(lang, "video_attached_to_msg")}</Text> : null}
                    {addedAttachment.kind === "audio" ? (
                      renderAudioWidget({
                        uri: addedAttachment.uri,
                        durationMs: addedAttachment.durationMs,
                        onPress: () => void playDraftAudio(),
                      })
                    ) : null}
                    <Pressable
                      onPress={() => {
                        setAddedAttachment(null);
                      }}
                    >
                      <Text style={styles.attachRemove}>{t(lang, "delete")}</Text>
                    </Pressable>
                  </View>
                ) : null}
                {emojiOpen ? (
                  <View style={styles.emojiPanel}>
                    {EMOJIS.map((e) => (
                      <Pressable key={e} style={styles.emojiCell} onPress={() => onEmojiPick(e)}>
                        <Text style={styles.emojiText}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
              </View>
              </View>
            </KeyboardAvoidingView>
          ) : null}
        </View>
      </SafeAreaView>

      <Modal visible={zoomOpen} transparent animationType="fade" onRequestClose={() => setZoomOpen(false)}>
        <Pressable style={styles.zoomOverlay} onPress={() => setZoomOpen(false)}>
          <Pressable style={styles.zoomCloseBtn} onPress={() => setZoomOpen(false)}>
            <Text style={styles.zoomCloseText}>✕</Text>
          </Pressable>
          <Image source={{ uri: zoomUri }} style={styles.zoomImage} resizeMode="contain" />
        </Pressable>
      </Modal>
    </Modal>
  );
}


