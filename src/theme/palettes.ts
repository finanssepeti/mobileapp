/** Koyu: mevcut uygulama (varsayılan). */
export const paletteDark = {
  primary: "#1a237e",
  primaryLight: "#283593",
  accent: "#ff6d00",
  background: "#0d1558",
  surface: "#111c6b",
  text: "#ffffff",
  textMuted: "#d1d5db",
  border: "#334155",
  error: "#ef4444",
  success: "#10b981",
} as const;

/** Açık: beyaz zemin, lacivert yazı; turuncu vurgular korunur. */
export const paletteLight = {
  primary: "#1a237e",
  primaryLight: "#283593",
  accent: "#ff6d00",
  background: "#ffffff",
  surface: "#f1f5f9",
  text: "#0d1558",
  textMuted: "#334155",
  border: "#cbd5e1",
  error: "#ef4444",
  success: "#059669",
} as const;

export type ThemePalette = typeof paletteDark | typeof paletteLight;
