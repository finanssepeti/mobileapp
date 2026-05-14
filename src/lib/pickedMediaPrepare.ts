import Constants, { ExecutionEnvironment } from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

export const MB = 1024 * 1024;

/** Galeriden seçilebilecek üst sınır (sıkıştırma öncesi). */
export const MAX_IMAGE_PICK_BYTES = 80 * MB;

/** Yüklemeden önce hedeflenen foto boyutu (mesaj: daha yumuşak; aşırı küçültme yok). */
export const TARGET_IMAGE_UPLOAD_BYTES = 2 * MB;

/** Sıkıştırma sonrası foto kabul üst sınırı (mesaj ekleri; yükleme hatası riskini azaltır). */
export const MAX_IMAGE_AFTER_COMPRESS_BYTES = 4 * MB;

export const MAX_VIDEO_PICK_BYTES = 400 * MB;

/** İlk sıkıştırma hedefi (mesaj videosu; önceki 5 MB’dan daha gevşek). */
export const TARGET_VIDEO_UPLOAD_BYTES = 10 * MB;

/** Sıkıştırma sonrası kabul üst sınırı (base64 yükleme + bellek için üst tavan). */
export const MAX_VIDEO_AFTER_COMPRESS_BYTES = 20 * MB;

/**
 * Yorum medyası (Firebase Storage `comments/**`): görsel en fazla 5 MB, video en fazla 25 MB.
 * Mesajlardan biraz daha gevşek hedef; yine depo kuralına sığar.
 */
export const COMMENT_TARGET_IMAGE_UPLOAD_BYTES = Math.floor(2.8 * MB);
export const COMMENT_MAX_IMAGE_AFTER_COMPRESS_BYTES = 5 * MB - 96 * 1024;
export const COMMENT_TARGET_VIDEO_UPLOAD_BYTES = 12 * MB;
export const COMMENT_MAX_VIDEO_AFTER_COMPRESS_BYTES = 24 * MB;

/** Yorum videosu üst süre (ms). */
export const COMMENT_MAX_VIDEO_DURATION_MS = 15 * 1000;

export type FinalizePickedMediaPurpose = "message" | "comment";

export type FinalizePickedVideoOptions = {
  bitrateDurationCapSec?: number;
  purpose?: FinalizePickedMediaPurpose;
};

export type FinalizePickedImageOptions = {
  purpose?: FinalizePickedMediaPurpose;
};

const IMAGE_MAX_WIDTH = 2048;
const IMAGE_MAX_HEIGHT = 2048;

export function pickGalleryAssetMediaKind(a: {
  type?: "image" | "video" | "livePhoto" | "pairedVideo" | null;
  mimeType?: string;
  duration?: number | null;
}): "image" | "video" {
  if (a.type === "video" || a.type === "pairedVideo") return "video";
  if (a.type === "image" || a.type === "livePhoto") return "image";
  const mt = String(a.mimeType ?? "").toLowerCase();
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("image/")) return "image";
  const durMs = typeof a.duration === "number" ? a.duration : 0;
  if (durMs > 0) return "video";
  return "image";
}

export async function getFileBytes(uri: string): Promise<number> {
  if (!uri) return 0;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === "number" ? info.size : 0;
}

/** APK: `content://` → önbellek; okuma / sıkıştırma için güvenilir `file://`. */
export async function copyVideoPickToCacheIfNeeded(uri: string): Promise<string> {
  try {
    if (Platform.OS === "android" && FileSystem.cacheDirectory) {
      const dest = `${FileSystem.cacheDirectory}pick-vid-${Date.now()}.mp4`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    }
  } catch {
    /* orijinal uri */
  }
  return uri;
}

export async function copyImagePickToCacheIfNeeded(uri: string): Promise<string> {
  try {
    if (Platform.OS === "android" && FileSystem.cacheDirectory) {
      const dest = `${FileSystem.cacheDirectory}pick-img-${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    }
  } catch {
    /* orijinal uri */
  }
  return uri;
}

/** Expo Go’da native video sıkıştırıcı yok. */
export function isExpoGoEnvironment(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient || Constants.appOwnership === "expo"
  );
}

export async function compressImageForUpload(
  uri: string,
  targetBytes: number,
): Promise<{ uri: string; bytes: number }> {
  let workUri = uri;
  let bytes = await getFileBytes(workUri);
  if (bytes > 0 && bytes <= targetBytes) return { uri: workUri, bytes };

  const passes = [
    { compress: 0.82, width: IMAGE_MAX_WIDTH, height: IMAGE_MAX_HEIGHT },
    { compress: 0.7, width: 1920, height: 1920 },
    { compress: 0.58, width: 1600, height: 1600 },
    { compress: 0.48, width: 1400, height: 1400 },
    { compress: 0.38, width: 1200, height: 1200 },
  ];

  for (const pass of passes) {
    const ctx = ImageManipulator.manipulate(workUri).resize({
      width: pass.width,
      height: pass.height,
    });
    const out = await ctx.renderAsync();
    const saved = await out.saveAsync({ compress: pass.compress, format: SaveFormat.JPEG });
    workUri = saved.uri;
    bytes = await getFileBytes(workUri);
    if (bytes > 0 && bytes <= targetBytes) return { uri: workUri, bytes };
  }

  return { uri: workUri, bytes };
}

export async function tryCompressVideoToTarget(
  uri: string,
  targetBytes: number,
  durationMs?: number,
  opts?: { bitrateDurationCapSec?: number },
): Promise<{ uri: string; bytes: number }> {
  let resultUri = uri;
  let bytes = await getFileBytes(resultUri);
  if (bytes > 0 && bytes <= targetBytes) return { uri: resultUri, bytes };

  const capSec =
    typeof opts?.bitrateDurationCapSec === "number" && opts.bitrateDurationCapSec > 0
      ? opts.bitrateDurationCapSec
      : 15;
  const durSec = Math.max(
    4,
    Math.min(
      capSec,
      typeof durationMs === "number" && durationMs > 0 ? durationMs / 1000 : capSec,
    ),
  );
  const initialBytesFallback = Math.max(bytes, 24 * MB);

  if (isExpoGoEnvironment()) {
    return { uri: resultUri, bytes };
  }

  try {
    const mod = await import("react-native-compressor");
    const VideoCompressor = mod?.Video;
    if (!VideoCompressor?.compress) {
      bytes = await getFileBytes(resultUri);
      return { uri: resultUri, bytes };
    }

    const sourceUri = uri;
    let smallestUri = sourceUri;
    let smallestBytes = bytes > 0 ? bytes : Number.MAX_SAFE_INTEGER;

    for (const maxSize of [1280, 1080, 960, 840, 720, 640]) {
      try {
        const maybeUri = await VideoCompressor.compress(sourceUri, {
          compressionMethod: "auto",
          maxSize,
        });
        if (typeof maybeUri === "string" && maybeUri.trim()) {
          const outBytes = await getFileBytes(maybeUri);
          if (outBytes > 0 && outBytes < smallestBytes) {
            smallestBytes = outBytes;
            smallestUri = maybeUri;
          }
          if (outBytes > 0 && outBytes <= targetBytes) return { uri: maybeUri, bytes: outBytes };
        }
      } catch {
        /* sonraki çözünürlük */
      }
    }

    resultUri = smallestUri;
    bytes = await getFileBytes(resultUri);
    if (bytes > 0 && bytes <= targetBytes) return { uri: resultUri, bytes };

    const attempts: { ratio: number; maxSize: number }[] = [
      { ratio: 0.32, maxSize: 1080 },
      { ratio: 0.26, maxSize: 960 },
      { ratio: 0.2, maxSize: 840 },
      { ratio: 0.15, maxSize: 720 },
      { ratio: 0.11, maxSize: 640 },
      { ratio: 0.08, maxSize: 540 },
      { ratio: 0.055, maxSize: 480 },
    ];

    for (const { ratio, maxSize } of attempts) {
      const refBytes = (await getFileBytes(resultUri)) || initialBytesFallback;
      const bitrate = Math.max(28_000, Math.floor((refBytes * 8 * ratio) / durSec));
      try {
        const maybeUri = await VideoCompressor.compress(resultUri, {
          compressionMethod: "manual",
          bitrate,
          maxSize,
        });
        if (typeof maybeUri === "string" && maybeUri.trim()) {
          resultUri = maybeUri;
          bytes = await getFileBytes(resultUri);
          if (bytes > 0 && bytes <= targetBytes) return { uri: resultUri, bytes };
        }
      } catch {
        /* zincir */
      }
    }
  } catch {
    /* native modül yok */
  }

  bytes = await getFileBytes(resultUri);
  return { uri: resultUri, bytes };
}

/**
 * Gönder tuşunda çağrılır: galeriden seçilen videoyu yüklemeden önce sıkıştırır.
 * Başarısızsa `null` (Expo Go istisnası mevcut).
 */
export async function finalizePickedVideoForUpload(
  localUri: string,
  durationMs: number,
  opts?: FinalizePickedVideoOptions,
): Promise<{ uri: string } | null> {
  const purpose = opts?.purpose === "comment" ? "comment" : "message";
  const targetCap = purpose === "comment" ? COMMENT_TARGET_VIDEO_UPLOAD_BYTES : TARGET_VIDEO_UPLOAD_BYTES;
  const maxAfter = purpose === "comment" ? COMMENT_MAX_VIDEO_AFTER_COMPRESS_BYTES : MAX_VIDEO_AFTER_COMPRESS_BYTES;

  let bytes = await getFileBytes(localUri);
  const targetBytes =
    bytes > 0 && bytes <= targetCap
      ? Math.min(targetCap, Math.max(400 * 1024, Math.floor(bytes * 0.92)))
      : targetCap;
  let compressed = await tryCompressVideoToTarget(localUri, targetBytes, durationMs, opts);

  if (compressed.bytes > maxAfter && !isExpoGoEnvironment()) {
    const secondTarget = Math.max(5 * MB, Math.floor(targetBytes * 0.62));
    const pass2 = await tryCompressVideoToTarget(compressed.uri, secondTarget, durationMs, opts);
    if (pass2.bytes > 0 && pass2.bytes < compressed.bytes) compressed = pass2;
  }

  if (compressed.bytes > maxAfter) {
    if (isExpoGoEnvironment() && bytes > 0 && bytes <= maxAfter) {
      return { uri: localUri };
    }
    return null;
  }
  return { uri: compressed.uri };
}

/** Gönder tuşunda: foto sıkıştırma (önizleme ham dosyaydı). */
export async function finalizePickedImageForUpload(
  localUri: string,
  opts?: FinalizePickedImageOptions,
): Promise<{ uri: string } | null> {
  const purpose = opts?.purpose === "comment" ? "comment" : "message";
  const targetCap = purpose === "comment" ? COMMENT_TARGET_IMAGE_UPLOAD_BYTES : TARGET_IMAGE_UPLOAD_BYTES;
  const maxAfter = purpose === "comment" ? COMMENT_MAX_IMAGE_AFTER_COMPRESS_BYTES : MAX_IMAGE_AFTER_COMPRESS_BYTES;
  const divisor = purpose === "comment" ? 4 : 5;
  const minFloor = purpose === "comment" ? 320 * 1024 : 280 * 1024;

  const originalImageBytes = await getFileBytes(localUri);
  if (originalImageBytes > MAX_IMAGE_PICK_BYTES) return null;
  const imageTargetBytes = Math.min(
    targetCap,
    Math.max(minFloor, Math.floor(Math.max(originalImageBytes, 1) / divisor)),
  );
  const compressed = await compressImageForUpload(localUri, imageTargetBytes);
  let imageUri = compressed.uri;
  if (compressed.bytes > maxAfter) {
    const rawOnDisk = await getFileBytes(localUri);
    if (rawOnDisk > 0 && rawOnDisk <= maxAfter) {
      imageUri = localUri;
    } else {
      return null;
    }
  }
  return { uri: imageUri };
}
