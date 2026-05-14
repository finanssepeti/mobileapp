import * as FileSystem from "expo-file-system/legacy";
import type { FirebaseStorage } from "firebase/storage";
import { getDownloadURL, ref, uploadString } from "firebase/storage";

/**
 * React Native'de `fetch(file://...)` / `content://` çoğu cihazda Blob üretmez veya boş döner.
 * Firebase Storage için base64 + uploadString güvenilir yol.
 */
export async function uploadLocalUriToStoragePath(
  storage: FirebaseStorage,
  path: string,
  localUri: string,
  contentType: string,
  opts?: { base64?: string },
): Promise<string> {
  const uri = (localUri || "").trim();
  if (!uri) throw new Error("Dosya yolu boş.");

  let b64: string | undefined = (opts?.base64 || "").trim() || undefined;
  try {
    if (!b64?.length) b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Dosya okunamadı (FileSystem): ${msg}`);
  }
  if (!b64?.length) throw new Error("Dosya boş veya okunamadı.");

  const rf = ref(storage, path);
  await uploadString(rf, b64, "base64", { contentType });
  return getDownloadURL(rf);
}
