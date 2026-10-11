// One-shot confetti burst for celebration moments (booking confirmed,
// attendee checked in). Pure Reanimated — no native dependency.
import React, { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const COLORS = ["#FF3D8B", "#C6FF3D", "#7C5CFF", "#FFB547", "#5EEAD4", "#FFFFFF"];
const { width: W, height: H } = Dimensions.get("window");

function Piece({ seed }: { seed: number }) {
  const rnd = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  const startX = W / 2 + (rnd(1) - 0.5) * 60;
  const endX = rnd(2) * W;
  const peak = H * (0.12 + rnd(3) * 0.2);
  const delay = rnd(4) * 180;
  const size = 6 + rnd(5) * 6;
  const color = COLORS[Math.floor(rnd(6) * COLORS.length)];
  const spin = (rnd(7) - 0.5) * 1440;
  const round = rnd(8) > 0.6;

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 1900 + rnd(9) * 700, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    // up quickly to the peak, then fall past the bottom
    const y = p < 0.25 ? H * 0.42 - (H * 0.42 - peak) * (p / 0.25) : peak + (H * 1.05 - peak) * ((p - 0.25) / 0.75) ** 1.6;
    return {
      opacity: p > 0.85 ? (1 - p) / 0.15 : 1,
      transform: [
        { translateX: startX + (endX - startX) * p },
        { translateY: y },
        { rotate: `${spin * p}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        { width: size, height: round ? size : size * 0.45, borderRadius: round ? size / 2 : 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export function Confetti({ count = 46, burstKey = 0 }: { count?: number; burstKey?: number }) {
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => i + 1 + burstKey * 1000), [count, burstKey]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {seeds.map((s) => <Piece key={s} seed={s} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute", left: 0, top: 0 },
});
