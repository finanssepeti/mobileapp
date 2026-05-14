import { useMemo } from "react";
import { StyleSheet } from "react-native";
import type { ThemePalette } from "./palettes";
import { useThemeColors } from "./ThemeProvider";

/**
 * Modal / ekran stillerini profil paletinden (`siteGorunumu`) yeniden oluşturmak için kullanın.
 */
export function useThemedStylesheet<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemePalette) => T,
): T {
  const colors = useThemeColors();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
