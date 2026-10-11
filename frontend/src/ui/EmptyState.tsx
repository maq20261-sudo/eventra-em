// Friendly empty screen: glowing icon, title, hint and an action.
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import { Text } from "@/src/ui/Text";
import { Button } from "@/src/ui/Button";
import { useTheme } from "@/src/ThemeContext";
import { fonts } from "@/src/theme";

export function EmptyState({ icon, title, subtitle, actionLabel, onAction, testID, actionTestID }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  actionTestID?: string;
}) {
  const { colors } = useTheme();
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [float]);
  const floating = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));

  return (
    <View style={styles.wrap} testID={testID}>
      <Animated.View style={floating}>
        <View style={[styles.halo, { backgroundColor: colors.brand + "1F" }]}>
          <View style={[styles.circle, { backgroundColor: colors.surfaceTertiary, borderColor: colors.border, shadowColor: colors.brand }]}>
            <Ionicons name={icon} size={38} color={colors.accentText} />
          </View>
        </View>
      </Animated.View>
      <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
      {subtitle ? <Text style={[styles.sub, { color: colors.muted }]}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} testID={actionTestID} style={{ marginTop: 8, alignSelf: "center", paddingHorizontal: 28 }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 40, gap: 10 },
  halo: { width: 132, height: 132, borderRadius: 66, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  circle: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  title: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
