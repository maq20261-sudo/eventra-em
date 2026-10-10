// Soft coloured glows behind a screen (the Neon Night "reflected light").
// Render as the first child of a screen container; it fills the parent and
// ignores touches.
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "@/src/ThemeContext";

type Glow = { cx: string; cy: string; r: string; color: string; opacity: number };

const PRESETS: Record<string, Glow[]> = {
  // pink top-right, violet left — default screen glow
  default: [
    { cx: "100%", cy: "8%", r: "55%", color: "#FF3D8B", opacity: 0.22 },
    { cx: "0%", cy: "55%", r: "60%", color: "#7C5CFF", opacity: 0.2 },
  ],
  // lime centre — success / celebration screens
  success: [
    { cx: "50%", cy: "28%", r: "55%", color: "#C6FF3D", opacity: 0.2 },
    { cx: "100%", cy: "70%", r: "50%", color: "#FF3D8B", opacity: 0.16 },
  ],
  // violet centre — ticket / OTP screens
  violet: [{ cx: "50%", cy: "25%", r: "65%", color: "#7C5CFF", opacity: 0.28 }],
};

export function GlowBackground({ variant = "default" }: { variant?: keyof typeof PRESETS }) {
  const { mode } = useTheme();
  const glows = PRESETS[variant];
  const strength = mode === "dark" ? 1 : 0.45;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          {glows.map((g, i) => (
            <RadialGradient key={i} id={`glow${i}`} cx={g.cx} cy={g.cy} r={g.r} gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={g.color} stopOpacity={g.opacity * strength} />
              <Stop offset="1" stopColor={g.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {glows.map((_, i) => (
          <Rect key={i} x="0" y="0" width="100%" height="100%" fill={`url(#glow${i})`} />
        ))}
      </Svg>
    </View>
  );
}
