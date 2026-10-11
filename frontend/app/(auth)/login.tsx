import { useState, useMemo } from "react";
import { View, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Modal } from "react-native";
import { Text, TextInput } from "@/src/ui/Text";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/AuthContext";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { GlowBackground } from "@/src/ui/GlowBackground";
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
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const router = useRouter();
  const { signIn } = useAuth();

  const doSignIn = async (chosenRole?: "consumer" | "organizer") => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const em = email.trim().toLowerCase();
      const result = await signIn(em, password, chosenRole);
      if ((result as any).multiple_roles) {
        // Two accounts share this email — ask the user to pick one.
        const roles = (result as any).roles as string[];
        setAvailableRoles(roles);
        setRolePickerOpen(true);
        return;
      }
      const user = result as any;
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

  const submit = () => doSignIn();

  const pickRole = async (r: "consumer" | "organizer") => {
    setRolePickerOpen(false);
    await doSignIn(r);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <GlowBackground />
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

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable style={styles.forgotBtn} testID="go-forgot-btn">
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </Link>

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

      {/* Role picker modal — shown when the entered email is registered
          as both attendee and organizer. */}
      <Modal
        visible={rolePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRolePickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="role-picker-modal">
            <View style={styles.modalIconWrap}>
              <Ionicons name="people-circle-outline" size={40} color={colors.brand} />
            </View>
            <Text style={styles.modalTitle}>Which account?</Text>
            <Text style={styles.modalBody}>
              This email is registered as both attendee and organizer. Pick which one to sign in as.
            </Text>
            {availableRoles.includes("consumer") && (
              <Pressable
                testID="pick-consumer-btn"
                style={styles.modalBtn}
                onPress={() => pickRole("consumer")}
              >
                <Ionicons name="ticket-outline" size={20} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalBtnTitle}>Continue as Attendee</Text>
                  <Text style={styles.modalBtnSub}>Discover &amp; book events</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
            {availableRoles.includes("organizer") && (
              <Pressable
                testID="pick-organizer-btn"
                style={styles.modalBtn}
                onPress={() => pickRole("organizer")}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalBtnTitle}>Continue as Organizer</Text>
                  <Text style={styles.modalBtnSub}>Manage &amp; host events</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
            <Pressable
              onPress={() => setRolePickerOpen(false)}
              style={styles.modalCancel}
              testID="role-picker-cancel"
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  back: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", lineHeight: 34, color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: spacing.xl },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.muted, marginBottom: 6, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
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
    backgroundColor: colors.error + "1A", borderWidth: 1, borderColor: colors.error + "55", padding: spacing.md, borderRadius: 16,
  },
  primaryBtn: {
    ...shadows.glow,
    minHeight: 54, justifyContent: "center",
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  forgotBtn: {
    marginTop: spacing.md,
    alignItems: "center",
    paddingVertical: 12,
  },
  forgotText: {
    color: colors.accentText,
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    marginTop: "auto",
    flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: spacing.xl,
  },
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: colors.accentText, fontSize: 14, fontWeight: "600" },

  // Role picker modal
  modalBackdrop: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  modalIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  modalBody: {
    marginTop: spacing.sm,
    fontSize: 14, color: colors.muted,
    textAlign: "center", lineHeight: 20, marginBottom: spacing.lg,
  },
  modalBtn: {
    width: "100%",
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  modalBtnTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  modalBtnSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  modalCancel: { marginTop: spacing.md, paddingVertical: 8 },
  modalCancelText: { color: colors.muted, fontSize: 14, fontWeight: "500" },
});
