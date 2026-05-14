import { StyleSheet } from "react-native";
import type { ThemePalette } from "../theme/palettes";

export function createTradingViewChartModalStyles(palette: ThemePalette) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  backBtn: { minWidth: 88, paddingVertical: 6 },
  backText: { color: palette.accent, fontSize: 16, fontWeight: "800" },
  title: { flex: 1, color: palette.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  refreshBtn: { paddingVertical: 6 },
  browserBtn: { minWidth: 72, paddingVertical: 6, alignItems: "flex-end" },
  browserBtnText: { color: palette.accent, fontSize: 13, fontWeight: "700" },
  webWrap: { flex: 1, backgroundColor: "#0f172a" },
  web: { flex: 1, backgroundColor: "#0f172a" },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  fallbackWrap: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.surface },
  fallbackText: { color: palette.textMuted, fontSize: 12 },
});
}
