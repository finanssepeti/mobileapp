import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Image,
  ImageStyle,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";

import * as ImagePicker from "expo-image-picker";

import { Video, ResizeMode } from "expo-av";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { canUseCommentsFirestore, publishComment } from "../lib/commentsFirestore";

import { ensureFirestoreAuthReady } from "../lib/firebaseClient";

import { t } from "../lib/i18n";

import {
  COMMENT_MAX_VIDEO_DURATION_MS,
  MAX_IMAGE_PICK_BYTES,
  MAX_VIDEO_PICK_BYTES,
  copyImagePickToCacheIfNeeded,
  copyVideoPickToCacheIfNeeded,
  finalizePickedImageForUpload,
  finalizePickedVideoForUpload,
  getFileBytes,
  pickGalleryAssetMediaKind,
} from "../lib/pickedMediaPrepare";

import { useAppTheme } from "../theme/ThemeProvider";

import { createYorumYazModalStyles, type YorumYazModalCompiledStyles } from "./yorumYazModalStyles";



type Props = {

  visible: boolean;

  onClose: () => void;

};



export function YorumYazModal({ visible, onClose }: Props) {

  const { palette, lang } = useAppTheme();

  const { width: windowWidth } = useWindowDimensions();

  const previewWidth = Math.max(160, Math.floor(windowWidth - 24));

  const styles: YorumYazModalCompiledStyles = useMemo(() => createYorumYazModalStyles(palette), [palette]);

  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");

  const [media, setMedia] = useState<{ uri: string; kind: "image" | "video"; durationMs?: number } | null>(null);

  const [errorText, setErrorText] = useState("");

  const [isSending, setIsSending] = useState(false);

  const sendLockRef = useRef(false);

  const lastPublishAtRef = useRef(0);



  useEffect(() => {

    if (!visible || !canUseCommentsFirestore()) return;

    void ensureFirestoreAuthReady().catch(() => {});

  }, [visible]);



  const canSend = useMemo(

    () => text.trim().length >= 1 || !!media?.uri,

    [text, media],

  );



  const onPickAttachment = async () => {

    try {

      setErrorText("");

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {

        Alert.alert(t(lang, "perm_media_title"), t(lang, "perm_media_body"));

        return;

      }

      const res = await ImagePicker.launchImageLibraryAsync({

        mediaTypes: ["images", "videos"],

        allowsEditing: false,

        quality: 0.85,

        ...(Platform.OS === "ios"

          ? {

              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,

              videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,

            }

          : {

              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,

            }),

        videoMaxDuration: COMMENT_MAX_VIDEO_DURATION_MS / 1000,

      });

      if (res.canceled || !res.assets?.length) return;

      const a = res.assets[0]!;

      const kind: "image" | "video" = pickGalleryAssetMediaKind(a);

      if (kind === "video") {

        const durationMs = typeof a.duration === "number" ? a.duration : 0;

        const videoWorkUri = await copyVideoPickToCacheIfNeeded(a.uri);

        let bytes =
          typeof a.fileSize === "number" && a.fileSize > 0 ? a.fileSize : 0;

        if (bytes <= 0) bytes = await getFileBytes(videoWorkUri);

        if (durationMs > COMMENT_MAX_VIDEO_DURATION_MS) {

          setMedia(null);

          Alert.alert(t(lang, "video_too_long_title"), t(lang, "video_too_long_body"));

          return;

        }

        if (bytes > MAX_VIDEO_PICK_BYTES) {

          setMedia(null);

          Alert.alert(t(lang, "video_large_title"), t(lang, "video_large_body"));

          return;

        }

        setMedia({ uri: videoWorkUri, kind: "video", ...(durationMs > 0 ? { durationMs } : {}) });

        return;

      }

      const imageWorkUri = await copyImagePickToCacheIfNeeded(a.uri);

      let originalImageBytes =
        typeof a.fileSize === "number" && a.fileSize > 0 ? a.fileSize : 0;

      if (originalImageBytes <= 0) originalImageBytes = await getFileBytes(imageWorkUri);

      if (originalImageBytes > MAX_IMAGE_PICK_BYTES) {

        setMedia(null);

        Alert.alert(t(lang, "photo_too_large_title"), t(lang, "photo_too_large_body"));

        return;

      }

      setMedia({ uri: imageWorkUri, kind: "image" });

    } catch (e) {

      setMedia(null);

      const detail = e instanceof Error ? e.message : String(e);

      Alert.alert("Medya", detail.trim() ? detail : "Dosya seçilemedi.");

    }

  };



  const onSubmit = async () => {

    const now = Date.now();

    if (now - lastPublishAtRef.current < 620) return;

    if ((!text.trim().length && !media?.uri) || sendLockRef.current) return;

    if (!canUseCommentsFirestore()) {

      setErrorText(t(lang, "comment_service_unavailable"));

      return;

    }



    lastPublishAtRef.current = now;

    sendLockRef.current = true;

    setIsSending(true);

    setErrorText("");

    Keyboard.dismiss();



    const textSnap = text;

    const mediaSnap = media;



    try {

      let mediaOut = mediaSnap;

      if (mediaSnap?.uri) {

        if (mediaSnap.kind === "video") {

          const durationMs = mediaSnap.durationMs ?? 0;

          const done = await finalizePickedVideoForUpload(mediaSnap.uri, durationMs, { purpose: "comment" });

          if (!done) {

            Alert.alert(t(lang, "video_compress_fail_title"), t(lang, "comment_video_compress_fail_body"));

            return;

          }

          mediaOut = { ...mediaSnap, uri: done.uri };

        } else {

          const done = await finalizePickedImageForUpload(mediaSnap.uri, { purpose: "comment" });

          if (!done) {

            Alert.alert(t(lang, "photo_compress_fail_title"), t(lang, "comment_photo_compress_fail_body"));

            return;

          }

          mediaOut = { ...mediaSnap, uri: done.uri };

        }

      }



      await publishComment({ text: textSnap, media: mediaOut ?? undefined });

      setText("");

      setMedia(null);

      onClose();

      Alert.alert(t(lang, "comment_sent_title"), t(lang, "comment_sent_ok"));

    } catch (e) {

      const detail = e instanceof Error ? e.message : String(e);

      setErrorText(`${t(lang, "comment_send_failed")} ${detail}`);

    } finally {

      sendLockRef.current = false;

      setIsSending(false);

    }

  };



  return (

    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>

      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>

        <View style={styles.header}>

          <Pressable onPress={() => !isSending && onClose()} hitSlop={8} disabled={isSending}>

            <Text style={[styles.headerAction, isSending && { opacity: 0.45 }]}>← {t(lang, "back")}</Text>

          </Pressable>

          <Text style={styles.headerTitle}>{t(lang, "write_comment")}</Text>

          <View style={styles.headerGhost} />

        </View>



        <View style={styles.content}>

          <KeyboardAvoidingView

            style={styles.keyboardCol}

            behavior={Platform.OS === "ios" ? "padding" : undefined}

            keyboardVerticalOffset={Platform.OS === "ios" ? 56 : 0}

          >

            <ScrollView

              style={{ flex: 1 }}

              keyboardShouldPersistTaps="always"

              keyboardDismissMode="on-drag"

              showsVerticalScrollIndicator

              contentContainerStyle={styles.scrollInner}

            >

              {media ? (

                <View style={styles.mediaAttachedCard}>

                  {media.kind === "image" ? (

                    <Image

                      source={{ uri: media.uri }}

                      style={[styles.mediaPreviewFull as ImageStyle, { width: previewWidth }]}

                      resizeMode="cover"

                    />

                  ) : (

                    <Video

                      style={[styles.mediaVideoPreview as ViewStyle, { width: previewWidth }]}

                      source={{ uri: media.uri }}

                      useNativeControls

                      resizeMode={ResizeMode.CONTAIN}

                      shouldPlay

                      isMuted

                      isLooping={false}

                    />

                  )}

                  <View style={styles.mediaAttachedMeta}>

                    <Text style={styles.mediaAttachedLbl}>

                      {media.kind === "image"

                        ? t(lang, "comment_media_image_ready")

                        : t(lang, "comment_media_video_attached")}

                    </Text>

                    <Pressable onPress={() => !isSending && setMedia(null)} hitSlop={8} disabled={isSending}>

                      <Text style={[styles.mediaRemove, isSending && { opacity: 0.45 }]}>{t(lang, "remove_from_comment")}</Text>

                    </Pressable>

                  </View>

                </View>

              ) : null}

              <TextInput

                value={text}

                onChangeText={setText}

                multiline

                style={[styles.textArea, !!media && { minHeight: 120 }]}

                placeholder={t(lang, "comment_placeholder_opinion")}

                placeholderTextColor={palette.textMuted}

                maxLength={800}

                blurOnSubmit={false}

                editable={!isSending}

              />

              <Text style={styles.counter}>{text.trim().length}/800</Text>

              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            </ScrollView>

            <View style={[styles.composeFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>

              <View style={styles.composeFooterLeft}>

                {isSending ? <Text style={styles.sendingHint}>{t(lang, "comment_sending")}</Text> : null}

              </View>

              <View style={styles.composeFooterActions}>

                <Pressable

                  style={[styles.iconBtn, isSending && { opacity: 0.45 }]}

                  hitSlop={10}

                  disabled={isSending}

                  onPress={() => void onPickAttachment()}

                >

                  <Text style={styles.iconTxtDark}>📎</Text>

                </Pressable>

                <Pressable

                  style={[

                    styles.sendIconBtn,

                    (!canSend || isSending) && styles.sendBtnDisabled,

                    isSending && styles.sendIconBtnBusy,

                  ]}

                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}

                  disabled={!canSend || isSending}

                  onPress={() => void onSubmit()}

                >

                  {isSending ? (

                    <ActivityIndicator color="#fff" size="small" />

                  ) : (

                    <Text style={styles.iconTxt}>➤</Text>

                  )}

                </Pressable>

              </View>

            </View>

          </KeyboardAvoidingView>

        </View>

      </SafeAreaView>

    </Modal>

  );

}

