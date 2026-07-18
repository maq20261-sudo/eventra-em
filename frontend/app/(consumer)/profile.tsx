import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/AuthContext";
import { colors, spacing, radius, shadows } from "@/src/theme";

export default function Profile() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const doSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace("/(auth)/welcome");
  };

  const initial = user?.name?.charAt(0).toUpperCase() || "U";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons
              name={user?.role === "organizer" ? "star" : "ticket"}
              size={12}
              color={colors.onBrandTertiary}
            />
            <Text style={styles.roleText}>{user?.role === "organizer" ? "Organizer" : "Attendee"}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Row icon="notifications-outline" label="Notifications" />
          <Row icon="lock-closed-outline" label="Privacy" />
          <Row icon="help-circle-outline" label="Help & Support" />
          <Row icon="information-circle-outline" label="About" />
        </View>

        <Pressable style={styles.signOut} onPress={doSignOut} testID="sign-out-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label }: { icon: any; label: string }) {
  return (
    <Pressable style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={18} color={colors.onSurfaceTertiary} />
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.xl, alignItems: "center", gap: 6, ...shadows.card,
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 30, fontWeight: "700", color: colors.onBrandTertiary },
  name: { fontSize: 20, fontWeight: "600", color: colors.onSurface },
  email: { fontSize: 14, color: colors.muted },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  roleText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: "600" },
  section: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, ...shadows.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: 14,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 15, color: colors.onSurface },
  signOut: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    padding: spacing.md, borderRadius: radius.md,
  },
  signOutText: { color: colors.error, fontWeight: "600", fontSize: 15 },
});
