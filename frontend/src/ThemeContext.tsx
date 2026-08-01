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
  surface: "#F9FAFB",
  onSurface: "#111827",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#111827",
  surfaceTertiary: "#F3F4F6",
  onSurfaceTertiary: "#374151",
  surfaceInverse: "#1F2937",
  onSurfaceInverse: "#F9FAFB",
  brand: "#059669",
  brandPrimary: "#059669",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#10B981",
  brandTertiary: "#D1FAE5",
  onBrandTertiary: "#065F46",
  success: "#059669",
  warning: "#D97706",
  error: "#DC2626",
  info: "#4B5563",
  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  divider: "#F3F4F6",
  muted: "#6B7280",
};

export const DARK_COLORS: Colors = {
  surface: "#0B0F14",
  onSurface: "#F9FAFB",
  surfaceSecondary: "#111827",
  onSurfaceSecondary: "#F9FAFB",
  surfaceTertiary: "#1F2937",
  onSurfaceTertiary: "#D1D5DB",
  surfaceInverse: "#F9FAFB",
  onSurfaceInverse: "#111827",
  brand: "#10B981",
  brandPrimary: "#10B981",
  onBrandPrimary: "#02231A",
  brandSecondary: "#34D399",
  brandTertiary: "#064E3B",
  onBrandTertiary: "#A7F3D0",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#F87171",
  info: "#9CA3AF",
  border: "#1F2937",
  borderStrong: "#374151",
  divider: "#1F2937",
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
  const [mode, setModeState] = useState<ThemeMode>("light");

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
