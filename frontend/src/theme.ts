import { DARK_COLORS } from "@/src/ThemeContext";

// Static palette for the few components that don't read the theme context
// (EventMap, LocationPicker). Matches the default dark Neon Night theme.
export const colors = DARK_COLORS;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 24,
  pill: 999,
};

// Font families loaded in app/_layout.tsx. Use `fonts.display` for headings;
// body text gets Manrope automatically via src/ui/Text.
export const fonts = {
  display: "display", // resolved by src/ui/Text to the Unbounded weight
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  extrabold: "Manrope_800ExtraBold",
};

export const typography = {
  display: { fontFamily: fonts.display as string | undefined, fontWeight: "700" as const },
  text: { fontFamily: fonts.regular as string | undefined, fontWeight: "400" as const },
};

export const shadows = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 3,
  },
  floating: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  // Pink glow under featured / hero elements.
  glow: {
    shadowColor: "#FF3D8B",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 26,
    elevation: 12,
  },
};
