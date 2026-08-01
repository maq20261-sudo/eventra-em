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
        source="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxjb25jZXJ0fGVufDB8fHx8MTc4NDQ4MTk1NXww&ixlib=rb-4.1.0&q=85&w=900"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(15,15,20,0.35)", "rgba(15,15,20,0.75)", "rgba(15,15,20,0.98)"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <Ionicons name="sparkles" size={22} color={colors.brand} />
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
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.3,
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
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "800",
    lineHeight: 44,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
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
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    borderColor: "rgba(255,255,255,0.4)",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  secondaryText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
});
