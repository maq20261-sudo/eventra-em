import { useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { spacing, radius } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

export default function Welcome() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const go = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  };

  return (
    <View style={styles.container} testID="welcome-screen">
      <Image
        source="https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=1200&w=800"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(3,15,10,0.20)", "rgba(3,15,10,0.55)", "rgba(3,15,10,0.95)"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>GS</Text>
          </View>
          <Text style={styles.logoText}>GatherSpace</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.title}>Discover events{"\n"}worth remembering.</Text>
        <Text style={styles.subtitle}>
          Concerts, art shows, tech meetups — all near you, all in one place.
        </Text>

        <Pressable
          testID="continue-consumer-btn"
          style={styles.primaryBtn}
          onPress={() => go("/(auth)/login?role=consumer")}
        >
          <Text style={styles.primaryText}>I&apos;m here to discover events</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
        </Pressable>

        <Pressable
          testID="continue-organizer-btn"
          style={styles.secondaryBtn}
          onPress={() => go("/(auth)/login?role=organizer")}
        >
          <Text style={styles.secondaryText}>I&apos;m organizing events</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  topRow: {
    paddingTop: 64,
    paddingHorizontal: spacing.xl,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  logoBadgeText: {
    color: colors.onBrandPrimary,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  logoText: {
    color: colors.surface,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    paddingBottom: 48,
    gap: spacing.md,
  },
  title: {
    color: colors.surface,
    fontSize: 34,
    fontWeight: "700",
    lineHeight: 40,
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryText: {
    color: colors.onBrandPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderColor: "rgba(255,255,255,0.4)",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "500",
  },
});
