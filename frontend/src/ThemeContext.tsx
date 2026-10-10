import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { storage } from "@/src/utils/storage";

export type ThemeMode = "light" | "dark";

export type Colors = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  surfaceInverse: string;
  onSurfaceInverse: string;
  brand: string;
  brandPrimary: string;
  onBrandPrimary: string;
  brandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  borderStrong: string;
  divider: string;
  muted: string;
  // Neon Night additions
  accentText: string; // pink that reads well as text on the surface
  violet: string;
  violetText: string;
  lime: string;
  onLime: string;
  soft: string; // secondary body text (lighter than muted)
  sheet: string; // bottom sheets / modals
  overlay: string; // scrim behind sheets
};

// Neon Night (design 1). All base colours are 6-digit hex because some
// screens append an alpha suffix, e.g. `colors.brand + "22"`.
export const DARK_COLORS: Colors = {
  surface: "#0D0B1A",
  onSurface: "#F5F3FF",
  surfaceSecondary: "#1A1630",
  onSurfaceSecondary: "#F5F3FF",
  surfaceTertiary: "#1E1838",
  onSurfaceTertiary: "#CFC9EA",
  surfaceInverse: "#F5F3FF",
  onSurfaceInverse: "#0D0B1A",
  brand: "#FF3D8B",
  brandPrimary: "#FF3D8B",
  onBrandPrimary: "#14061D",
  brandSecondary: "#7C5CFF",
  brandTertiary: "#3A1530",
  onBrandTertiary: "#FF9AC2",
  success: "#C6FF3D",
  warning: "#FFB547",
  error: "#FF6B6B",
  info: "#A39DC0",
  border: "#2C2550",
  borderStrong: "#3A3366",
  divider: "#241E42",
  muted: "#A39DC0",
  accentText: "#FF6FA8",
  violet: "#7C5CFF",
  violetText: "#C9B8FF",
  lime: "#C6FF3D",
  onLime: "#14061D",
  soft: "#CFC9EA",
  sheet: "#15122A",
  overlay: "rgba(5,4,12,0.62)",
};

// Light variant of the same palette, kept so the Profile "Dark theme"
// switch still works.
export const LIGHT_COLORS: Colors = {
  surface: "#FAF8FF",
  onSurface: "#17112E",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#17112E",
  surfaceTertiary: "#F1EDFB",
  onSurfaceTertiary: "#3B3360",
  surfaceInverse: "#17112E",
  onSurfaceInverse: "#FAF8FF",
  brand: "#E5246F",
  brandPrimary: "#E5246F",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#6D4AFF",
  brandTertiary: "#FFE3EF",
  onBrandTertiary: "#A3124B",
  success: "#3E7F00",
  warning: "#B45309",
  error: "#DC2626",
  info: "#5B5480",
  border: "#E6E0F5",
  borderStrong: "#D3CBEA",
  divider: "#F1EDFB",
  muted: "#6B6390",
  accentText: "#C2185B",
  violet: "#6D4AFF",
  violetText: "#5B3FD9",
  lime: "#C6FF3D",
  onLime: "#14061D",
  soft: "#4A4270",
  sheet: "#FFFFFF",
  overlay: "rgba(23,17,46,0.45)",
};

type Ctx = {
  mode: ThemeMode;
  colors: Colors;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleMode: () => Promise<void>;
};

const ThemeContext = createContext<Ctx | undefined>(undefined);

// v2: the Neon Night redesign defaults everyone to dark, so earlier saved
// "light" preferences (the old default) are intentionally not carried over.
const STORAGE_KEY = "gs_theme_mode_v2";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(STORAGE_KEY, "");
      if (saved === "dark" || saved === "light") setModeState(saved);
    })();
  }, []);

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m);
    await storage.setItem(STORAGE_KEY, m);
  }, []);

  const toggleMode = useCallback(async () => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    setModeState(next);
    await storage.setItem(STORAGE_KEY, next);
  }, [mode]);

  const value = useMemo<Ctx>(() => ({
    mode,
    colors: mode === "dark" ? DARK_COLORS : LIGHT_COLORS,
    setMode,
    toggleMode,
  }), [mode, setMode, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
