// Pulsing placeholder blocks shown while content loads (replaces spinners).
import React, { useEffect } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "@/src/ThemeContext";

export function Skeleton({ width = "100%", height = 16, radius = 10, style }: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceTertiary }, animated, style]}
    />
  );
}

/** A list-row skeleton: thumbnail + three text lines. */
export function SkeletonRow() {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 8 }}>
      <Skeleton width={76} height={76} radius={14} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="50%" height={12} />
        <Skeleton width="35%" height={12} />
      </View>
    </View>
  );
}

/** A large card skeleton (featured / image cards). */
export function SkeletonCard({ height = 200 }: { height?: number }) {
  return <Skeleton height={height} radius={24} />;
}
