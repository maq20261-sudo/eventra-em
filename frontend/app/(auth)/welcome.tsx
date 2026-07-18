import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/theme";

export default function Welcome() {
  const router = useRouter();

  const go = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  };

  return (
    <View style={styles.container} testID="welcome-screen">
      <Image
        source="https://images.pexels.com/photos/894557/pexels-photo-894557.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(31,41,55,0.15)", "rgba(31,41,55,0.55)", "rgba(31,41,55,0.95)"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <Ionicons name="sparkles" size={20} color={colors.surface} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  topRow: {
    paddingTop: 64,
    paddingHorizontal: spacing.xl,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoText: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: "600",
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
