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
};

export const LIGHT_COLORS: Colors = {
  surface: "#F5F5F7",
  onSurface: "#0F0F1A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#0F0F1A",
  surfaceTertiary: "#EEEEF3",
  onSurfaceTertiary: "#3D3D4D",
  surfaceInverse: "#0F0F14",
  onSurfaceInverse: "#F5F5F7",
  brand: "#F84464",
  brandPrimary: "#F84464",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#DC1F3F",
  brandTertiary: "#FCE7EE",
  onBrandTertiary: "#B0102F",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#4B5563",
  border: "#E4E4EC",
  borderStrong: "#D0D0DC",
  divider: "#EEEEF3",
  muted: "#6B7280",
};

export const DARK_COLORS: Colors = {
  surface: "#0F0F14",
  onSurface: "#F5F5F7",
  surfaceSecondary: "#181822",
  onSurfaceSecondary: "#F5F5F7",
  surfaceTertiary: "#22222E",
  onSurfaceTertiary: "#D0D0DC",
  surfaceInverse: "#F5F5F7",
  onSurfaceInverse: "#0F0F14",
  brand: "#F84464",
  brandPrimary: "#F84464",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#FF6B85",
  brandTertiary: "#3A1420",
  onBrandTertiary: "#FFCAD4",
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#F87171",
  info: "#9CA3AF",
  border: "#22222E",
  borderStrong: "#3A3A4A",
  divider: "#22222E",
  muted: "#9CA3AF",
};

type Ctx = {
  mode: ThemeMode;
  colors: Colors;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleMode: () => Promise<void>;
};

const ThemeContext = createContext<Ctx | undefined>(undefined);

const STORAGE_KEY = "gs_theme_mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to dark — the BookMyShow-inspired brand feels most alive on the
  // deep charcoal surface. Users can flip to light in Profile.
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
