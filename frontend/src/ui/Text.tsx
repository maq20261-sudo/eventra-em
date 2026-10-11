// Drop-in replacements for react-native's Text and TextInput that apply the
// Neon Night fonts. Static font files only render the weight they contain,
// so we map `fontWeight` to the matching family and reset the weight (Android
// would otherwise fake-bold an already bold face).
//
//   <Text style={{ fontWeight: "700" }}>        -> Manrope Bold
//   <Text style={{ fontFamily: fonts.display }}> -> Unbounded (700 by default)
import React, { forwardRef } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from "react-native";

const MANROPE: Record<string, string> = {
  "100": "Manrope_400Regular",
  "200": "Manrope_400Regular",
  "300": "Manrope_400Regular",
  "400": "Manrope_400Regular",
  normal: "Manrope_400Regular",
  "500": "Manrope_500Medium",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
  bold: "Manrope_700Bold",
  "800": "Manrope_800ExtraBold",
  "900": "Manrope_800ExtraBold",
};

const UNBOUNDED: Record<string, string> = {
  "400": "Unbounded_600SemiBold",
  normal: "Unbounded_700Bold",
  "500": "Unbounded_600SemiBold",
  "600": "Unbounded_600SemiBold",
  "700": "Unbounded_700Bold",
  bold: "Unbounded_700Bold",
  "800": "Unbounded_800ExtraBold",
  "900": "Unbounded_800ExtraBold",
};

export function resolveFont(style: TextStyle | undefined): TextStyle {
  const weight = String(style?.fontWeight ?? "");
  const family = style?.fontFamily;
  if (family === "display") {
    return { fontFamily: UNBOUNDED[weight] ?? UNBOUNDED["700"], fontWeight: "normal" };
  }
  if (family) return {};
  return { fontFamily: MANROPE[weight] ?? MANROPE["400"], fontWeight: "normal" };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return <RNText ref={ref} {...rest} style={[style, resolveFont(flat)]} />;
});

// Lets screens keep writing `useRef<TextInput>(null)`.
export type TextInput = RNTextInput;
export type Text = RNText;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return <RNTextInput ref={ref} {...rest} style={[style, resolveFont(flat)]} />;
});
