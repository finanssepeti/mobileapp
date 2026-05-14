import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Uzak (https) videoyu arka planda önbelleğe indirir; hazır olunca file:// ile değiştirir.
 * İlk ve akış için her zaman uzak URL kullanılır (anında kaynak); yerel dosya gelince oynatıcı yerelde okur.
 */
export function useCachedRemoteVideoUri(remoteUrl: string | undefined, cacheKey: string): string {
  const url = (remoteUrl || "").trim();
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);

  useEffect(() => {
    setLocalFileUri(null);
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setLocalFileUri(url);
      return;
    }
    let cancelled = false;
    const safe = cacheKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
    const dest = `${FileSystem.cacheDirectory}vid-${safe}.mp4`;
    void (async () => {
      try {
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists && typeof info.size === "number" && info.size > 256) {
          if (!cancelled) setLocalFileUri(dest);
          return;
        }
        await FileSystem.downloadAsync(url, dest);
        if (!cancelled) setLocalFileUri(dest);
      } catch {
        /* uzak URL ile devam */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, cacheKey]);

  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return url;
  return localFileUri ?? url;
}
