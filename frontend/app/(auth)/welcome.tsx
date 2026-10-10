import { useEffect, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { spacing, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { Button } from "@/src/ui/Button";

const HERO = "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&h=1200&w=800";

export default function Welcome() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  // Slow "Ken Burns" zoom on the hero photo.
  const zoom = useSharedValue(1);
  useEffect(() => {
    zoom.value = withRepeat(withTiming(1.12, { duration: 12000, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [zoom]);
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));

  return (
    <View style={styles.container} testID="welcome-screen">
      <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
        <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      </Animated.View>
      <LinearGradient
        colors={["rgba(13,11,26,0.25)", "rgba(13,11,26,0.45)", "#0D0B1A"]}
        locations={[0, 0.45, 0.78]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.bottom}>
        <Animated.View entering={FadeInDown.duration(500)} style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>G</Text>
          </View>
          <Text style={styles.logoText}>GatherSpace</Text>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(120).duration(500)} style={styles.title}>
          Find the <Animated.Text style={[styles.title, { color: colors.brand }]}>vibe</Animated.Text>.{"\n"}Book in seconds.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(220).duration(500)} style={styles.subtitle}>
          Concerts, comedy, workshops and more — happening near you.
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(340).duration(500)} style={{ gap: spacing.sm }}>
          <Button
            testID="continue-consumer-btn"
            title="I'm here to discover events"
            icon="compass"
            onPress={() => router.push("/(auth)/login?role=consumer" as any)}
          />
          <Button
            testID="continue-organizer-btn"
            title="I'm organizing events"
            icon="calendar"
            variant="ghost"
            onPress={() => router.push("/(auth)/login?role=organizer" as any)}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0B1A", overflow: "hidden" },
  bottom: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: 24, paddingBottom: 44,
    gap: spacing.md,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBadge: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.brand, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  logoBadgeText: { fontFamily: fonts.display, color: colors.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  logoText: { fontFamily: fonts.display, color: "#F5F3FF", fontSize: 18, fontWeight: "700" },
  title: { fontFamily: "Unbounded_800ExtraBold", color: "#F5F3FF", fontSize: 32, lineHeight: 40 },
  subtitle: { fontFamily: "Manrope_500Medium", color: "#CFC9EA", fontSize: 15, lineHeight: 22, marginBottom: spacing.md },
});
