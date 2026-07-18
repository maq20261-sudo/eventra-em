import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/AuthContext";
import { colors, spacing, radius, shadows } from "@/src/theme";

export default function Register() {
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole = (params.role === "organizer" ? "organizer" : "consumer") as "consumer" | "organizer";
  const [role, setRole] = useState<"consumer" | "organizer">(initialRole);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { signUp } = useAuth();

  const submit = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError("Fill in all fields. Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const user = await signUp(email.trim().toLowerCase(), password, name.trim(), role);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (user.role === "organizer") router.replace("/(organizer)/events");
      else router.replace("/(consumer)/discover");
    } catch (e: any) {
      setError(e?.message || "Registration failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join GatherSpace in seconds</Text>

          <View style={styles.segment}>
            <Pressable
              testID="role-consumer-tab"
              style={[styles.segmentItem, role === "consumer" && styles.segmentItemActive]}
              onPress={() => setRole("consumer")}
            >
              <Text style={[styles.segmentText, role === "consumer" && styles.segmentTextActive]}>Attendee</Text>
            </Pressable>
            <Pressable
              testID="role-organizer-tab"
              style={[styles.segmentItem, role === "organizer" && styles.segmentItemActive]}
              onPress={() => setRole("organizer")}
            >
              <Text style={[styles.segmentText, role === "organizer" && styles.segmentTextActive]}>Organizer</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              testID="name-input"
              style={styles.input}
              placeholder="Sam Rivera"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="email-input"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="password-input"
              style={styles.input}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          {error && <Text style={styles.error} testID="register-error">{error}</Text>}

          <Pressable style={styles.primaryBtn} onPress={submit} disabled={loading} testID="register-submit-btn">
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Create Account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href={`/(auth)/login?role=${role}` as any} asChild>
              <Pressable testID="go-login-btn">
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  back: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg, ...shadows.card,
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: spacing.xl },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    padding: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.xl,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center" },
  segmentItemActive: { backgroundColor: colors.surfaceSecondary, ...shadows.card },
  segmentText: { fontSize: 14, color: colors.muted, fontWeight: "500" },
  segmentTextActive: { color: colors.onSurface, fontWeight: "600" },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, marginBottom: spacing.xs, fontWeight: "500" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.onSurface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  error: {
    color: colors.error, fontSize: 14, marginBottom: spacing.md,
    backgroundColor: "#FEF2F2", padding: spacing.md, borderRadius: radius.md,
  },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  footer: {
    marginTop: "auto",
    flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: spacing.xl,
  },
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: colors.brand, fontSize: 14, fontWeight: "600" },
});
