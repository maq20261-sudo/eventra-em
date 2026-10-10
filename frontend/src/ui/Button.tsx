import React from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/src/ui/Text";
import { PressableScale } from "@/src/ui/PressableScale";
import { useTheme } from "@/src/ThemeContext";

type Variant = "primary" | "ghost" | "lime" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  small,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const palette: Record<Variant, { bg: string; fg: string; border?: string; glow?: string }> = {
    primary: { bg: colors.brandPrimary, fg: colors.onBrandPrimary, glow: colors.brandPrimary },
    ghost: { bg: colors.surfaceTertiary, fg: colors.onSurface, border: colors.border },
    lime: { bg: colors.lime, fg: colors.onLime, glow: colors.lime },
    danger: { bg: "transparent", fg: colors.error, border: colors.error + "66" },
  };
  const p = palette[variant];
  return (
    <PressableScale
      testID={testID}
      haptic
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        small && styles.small,
        { backgroundColor: p.bg, borderColor: p.border ?? "transparent", borderWidth: p.border ? 1 : 0 },
        p.glow && !small ? { shadowColor: p.glow, shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={p.fg} /> : null}
          <Text style={[styles.label, small && styles.labelSmall, { color: p.fg }]}>{title}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  small: { height: 40, borderRadius: 12, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, fontWeight: "800" },
  labelSmall: { fontSize: 13 },
});
