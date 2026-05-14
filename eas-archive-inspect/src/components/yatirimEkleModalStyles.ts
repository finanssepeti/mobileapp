import { StyleSheet } from "react-native";
import type { ThemePalette } from "../theme/palettes";

export function createYatirimEkleModalStyles(colors: ThemePalette, isLight: boolean) {
  const inputBg = isLight ? colors.background : "#0a1040";
  const noteColor = isLight ? colors.text : "#dbeafe";
  const noteBg = isLight ? "rgba(26,35,126,0.08)" : "rgba(59,130,246,0.14)";
  const noteBorder = isLight ? "rgba(26,35,126,0.25)" : "rgba(147,197,253,0.45)";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    headerPad: { minWidth: 44, alignItems: "center" },
    title: { color: colors.text, fontSize: 17, fontWeight: "800" },
    close: { color: colors.text, fontSize: 22 },
    content: { padding: 14 },
    noteText: {
      color: noteColor,
      backgroundColor: noteBg,
      borderWidth: 1,
      borderColor: noteBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 11,
      lineHeight: 16,
      marginBottom: 6,
    },
    label: { color: colors.textMuted, fontSize: 12, marginTop: 10, marginBottom: 4 },
    input: {
      backgroundColor: inputBg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    inputPressable: {
      backgroundColor: inputBg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    inputPressableText: { color: colors.text, fontSize: 15 },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    searchInput: { flex: 1 },
    searchBtn: {
      width: 76,
      backgroundColor: colors.accent,
      borderWidth: 1,
      borderColor: "#ffd7b0",
      borderRadius: 10,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    searchBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
    totalLabel: { color: colors.textMuted, fontWeight: "700" },
    totalValue: { color: colors.text, fontWeight: "900" },
    saveBtn: {
      marginTop: 14,
      backgroundColor: colors.accent,
      borderColor: "#ffd7b0",
      borderWidth: 1,
      borderRadius: 12,
      alignItems: "center",
      paddingVertical: 12,
    },
    saveText: { color: "#fff", fontSize: 15, fontWeight: "800" },
    iosWrap: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
    iosHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8 },
    iosTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    iosDone: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  });
}
