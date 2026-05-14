import { StyleSheet } from "react-native";
import type { ThemePalette } from "../theme/palettes";

export function createMarketTileStyles(c: ThemePalette, isLight: boolean) {
  return StyleSheet.create({
    addFabInner: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    addFabInnerCompact: {
      width: 22,
      height: 22,
      borderRadius: 11,
    },
    addFabText: { color: "#1e2675", fontSize: 17, fontWeight: "900", lineHeight: 19, marginTop: -1 },
    addFabTextCompact: { fontSize: 16, lineHeight: 18, marginTop: 0 },
    chartFabInner: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: isLight ? "rgba(241, 245, 249, 0.98)" : "rgba(15,23,42,0.95)",
      borderWidth: 1,
      borderColor: isLight ? c.border : "#64748b",
      alignItems: "center",
      justifyContent: "center",
    },
    chartFabInnerCompact: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    card: {
      backgroundColor: isLight ? c.background : "#1e2675",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
      minHeight: 88,
      overflow: "hidden",
    },
    cardWithSubtitle: { minHeight: 108 },
    cardExpandInGrid: { flex: 1, alignSelf: "stretch" },
    cardCompact: {
      minHeight: 66,
      paddingHorizontal: 7,
      paddingVertical: 5,
      borderRadius: 10,
    },
    cardTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 6,
    },
    cardTopRowCompact: {
      gap: 4,
    },
    cardBottomRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
      gap: 8,
    },
    cardBottomRowCompact: {
      marginTop: 4,
      gap: 4,
    },
    cardTitle: { color: isLight ? c.text : "#dbeafe", fontSize: 11, fontWeight: "700" },
    cardTitleCompact: { fontSize: 12 },
    cardTitleFlex: { flex: 1, minWidth: 0, paddingRight: 4 },
    cardSubtitle: { color: isLight ? c.textMuted : "#94a3b8", fontSize: 9, fontWeight: "600", marginTop: 4, lineHeight: 12 },
    cardValue: { color: c.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
    cardValueAfterSubtitle: { marginTop: 4 },
    cardValueCompact: { fontSize: 17, fontWeight: "800", marginTop: 3 },
    cardChange: { fontSize: 11, fontWeight: "700", flex: 1, minWidth: 0, marginRight: 6 },
    cardChangeCompact: { fontSize: 12, marginRight: 4 },
    up: { color: isLight ? c.success : "#22c55e" },
    down: { color: "#ef4444" },
  });
}
