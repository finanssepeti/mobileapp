import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { StoredProfile } from "../lib/profileStorage";
import { loadProfile } from "../lib/profileStorage";
import type { ThemePalette } from "./palettes";
import { paletteDark, paletteLight } from "./palettes";

type Scheme = StoredProfile["siteGorunumu"];
type Lang = StoredProfile["dil"];

type ThemeContextValue = {
  scheme: Scheme;
  lang: Lang;
  palette: ThemePalette;
  isLight: boolean;
  setScheme: (s: Scheme) => void;
  setLang: (l: Lang) => void;
  refreshFromProfile: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>("koyu");
  const [lang, setLangState] = useState<Lang>("tr");

  const refreshFromProfile = useCallback(async () => {
    const p = await loadProfile();
    setSchemeState(p.siteGorunumu === "acik" ? "acik" : "koyu");
    setLangState(p.dil ?? "tr");
  }, []);

  useEffect(() => {
    void refreshFromProfile();
  }, [refreshFromProfile]);

  const setScheme = useCallback((s: Scheme) => {
    setSchemeState(s === "acik" ? "acik" : "koyu");
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l ?? "tr");
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const isLight = scheme === "acik";
    return {
      scheme,
      lang,
      palette: isLight ? paletteLight : paletteDark,
      isLight,
      setScheme,
      setLang,
      refreshFromProfile,
    };
  }, [scheme, lang, setScheme, setLang, refreshFromProfile]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      scheme: "koyu",
      lang: "tr",
      palette: paletteDark,
      isLight: false,
      setScheme: () => {},
      setLang: () => {},
      refreshFromProfile: async () => {},
    };
  }
  return ctx;
}

/** Kısayol: mevcut palet (useAppTheme().palette ile aynı). */
export function useThemeColors(): ThemePalette {
  return useAppTheme().palette;
}
