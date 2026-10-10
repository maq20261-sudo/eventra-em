// Small pill labels: FEATURED, category, status, urgency ("12 seats left").
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/src/ui/Text";
import { useTheme } from "@/src/ThemeContext";

export type TagTone = "lime" | "pink" | "dark" | "violet" | "ok" | "warn" | "bad" | "info";

export function Tag({ label, tone = "violet", icon, style, testID }: {
  label: string;
  tone?: TagTone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const tones: Record<TagTone, { bg: string; fg: string }> = {
    lime: { bg: colors.lime, fg: colors.onLime },
    pink: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    dark: { bg: "rgba(13,11,26,0.68)", fg: "#F5F3FF" },
    violet: { bg: colors.surfaceTertiary, fg: colors.violetText },
    ok: { bg: colors.success + "24", fg: colors.success },
    warn: { bg: colors.warning + "29", fg: colors.warning },
    bad: { bg: colors.error + "29", fg: colors.error },
    info: { bg: colors.violet + "33", fg: colors.violetText },
  };
  const t = tones[tone];
  return (
    <View testID={testID} style={[styles.tag, { backgroundColor: t.bg }, style]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
});
