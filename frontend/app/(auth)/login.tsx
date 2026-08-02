import { useState, useMemo } from "react";
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
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

export default function Login() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole = (params.role === "organizer" ? "organizer" : "consumer") as "consumer" | "organizer";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { signIn } = useAuth();

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const em = email.trim().toLowerCase();
      const user = await signIn(em, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (user.role === "organizer") router.replace("/(organizer)/events");
      else router.replace("/(consumer)/discover");
    } catch (e: any) {
      setError(e?.message || "Login failed");
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

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in with your email &amp; password.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="email-input"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="password-input"
                style={[styles.input, styles.passwordInput]}
                placeholder="Your password"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
                testID="toggle-password-btn"
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={colors.muted}
                />
              </Pressable>
            </View>
          </View>

          {error && <Text style={styles.error} testID="login-error">{error}</Text>}

          <Pressable
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
            testID="login-submit-btn"
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account?</Text>
            <Link href={`/(auth)/register?role=${initialRole}` as any} asChild>
              <Pressable testID="go-register-btn">
                <Text style={styles.footerLink}>Create one</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  passwordRow: { position: "relative" },
  passwordInput: { paddingRight: 44 },
  eyeBtn: {
    position: "absolute", right: 4, top: 0, bottom: 0,
    width: 44, alignItems: "center", justifyContent: "center",
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
