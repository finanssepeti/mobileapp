import { Linking, Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import {
  cacheDirectory,
  copyAsync,
  documentDirectory,
  getContentUriAsync,
  getInfoAsync,
  makeDirectoryAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

const REL_DIR = "FinansSepeti/Indirilenler/";

export type IndirmeSonucu = {
  dosyaAdi: string;
  byte: number;
  acmaUri: string;
  mimeType: string;
};

function storageRoot(): string {
  const root = documentDirectory ?? cacheDirectory;
  if (!root) throw new Error("Dosya kaydı için depolama kullanılamıyor.");
  return root;
}

async function ensureExportDir(): Promise<string> {
  const dir = `${storageRoot()}${REL_DIR}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function withAndroidContentUriForOpen(fileUri: string): Promise<string> {
  if (Platform.OS !== "android") return fileUri;
  try {
    return await getContentUriAsync(fileUri);
  } catch {
    return fileUri;
  }
}

async function savePdfInternal(printTempUri: string): Promise<IndirmeSonucu> {
  const dir = await ensureExportDir();
  const dosyaAdi = `FinansSepeti_itfa_${Date.now()}.pdf`;
  const hedef = `${dir}${dosyaAdi}`;
  await copyAsync({ from: printTempUri, to: hedef });
  const info = await getInfoAsync(hedef);
  const byte = info.exists ? info.size : 0;
  return { dosyaAdi, byte, acmaUri: hedef, mimeType: "application/pdf" };
}

async function saveCsvInternal(csv: string): Promise<IndirmeSonucu> {
  const dir = await ensureExportDir();
  const dosyaAdi = `FinansSepeti_itfa_${Date.now()}.csv`;
  const hedef = `${dir}${dosyaAdi}`;
  // Excel'in UTF-8 metni bozmaması için BOM eklenir.
  await writeAsStringAsync(hedef, `\uFEFF${csv}`, { encoding: "utf8" });
  const info = await getInfoAsync(hedef);
  const byte = info.exists ? info.size : 0;
  return { dosyaAdi, byte, acmaUri: hedef, mimeType: "text/csv" };
}

async function saveExcelHtmlInternal(html: string): Promise<IndirmeSonucu> {
  const dir = await ensureExportDir();
  const dosyaAdi = `FinansSepeti_itfa_${Date.now()}.xls`;
  const hedef = `${dir}${dosyaAdi}`;
  await writeAsStringAsync(hedef, `\uFEFF${html}`, { encoding: "utf8" });
  const info = await getInfoAsync(hedef);
  const byte = info.exists ? info.size : 0;
  return { dosyaAdi, byte, acmaUri: hedef, mimeType: "application/vnd.ms-excel" };
}

export async function kaydetPdfYazdirmaCiktisi(printTempUri: string): Promise<IndirmeSonucu> {
  return savePdfInternal(printTempUri);
}

export async function kaydetCsvDosyasi(csv: string): Promise<IndirmeSonucu> {
  return saveCsvInternal(csv);
}

export async function kaydetExcelHtmlDosyasi(html: string): Promise<IndirmeSonucu> {
  return saveExcelHtmlInternal(html);
}

export async function indirilenDosyayiAc(acmaUri: string, _mimeType: string): Promise<void> {
  if (Platform.OS === "android") {
    try {
      const contentUri = await withAndroidContentUriForOpen(acmaUri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: _mimeType,
        flags: 1,
      });
      return;
    } catch {}
  }

  try {
    await Linking.openURL(acmaUri);
    return;
  } catch {}

  try {
    const contentUri = await withAndroidContentUriForOpen(acmaUri);
    await Linking.openURL(contentUri);
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Dosya açılamadı: ${msg}`);
  }
}
