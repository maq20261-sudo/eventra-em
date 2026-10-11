import { useState, useMemo } from "react";
import { View, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { Text, TextInput } from "@/src/ui/Text";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { isPhoneAuthSupported, sendOtp, toE164India } from "@/src/firebase";
import { setPhoneSession } from "@/src/phoneSession";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole = (params.role === "organizer" ? "organizer" : "consumer") as "consumer" | "organizer";
  const [role, setRole] = useState<"consumer" | "organizer">(initialRole);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const phoneSupported = isPhoneAuthSupported();

  const submit = async () => {
    setError(null);
    const cleanMobile = mobile.replace(/\D/g, "");
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (!trimmedName) return setError("Please enter your name.");
    if (cleanMobile.length !== 10 || !"6789".includes(cleanMobile[0]))
      return setError("Enter a valid 10-digit Indian mobile (starting 6/7/8/9).");
    if (!EMAIL_RE.test(trimmedEmail))
      return setError("Please enter a valid email address.");
    if (password.length < 8)
      return setError("Password must be at least 8 characters.");

    if (!phoneSupported) {
      setError(
        "Phone sign-up isn't available on this platform. Please open GatherSpace on your phone to continue."
      );
      return;
    }
    setLoading(true);
    try {
      const conf = await sendOtp(cleanMobile);
      setPhoneSession({
        confirmation: conf,
        kind: "register",
        role,
        name: trimmedName,
        email: trimmedEmail,
        password,
        mobile: toE164India(cleanMobile),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/(auth)/otp" as any,
        params: { mobile_masked: conf.mobileMasked },
      });
    } catch (e: any) {
      setError(e?.message || "Couldn't send OTP");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <GlowBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Verify your mobile, set an email + password to sign in later.</Text>

          {!phoneSupported && Platform.OS === "web" && (
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={18} color={colors.brand} />
              <Text style={styles.infoBannerText}>
                Phone verification only works in the installed app. Open GatherSpace on your device to sign up.
              </Text>
            </View>
          )}

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
            <Text style={styles.label}>Mobile (India)</Text>
            <View style={styles.mobileRow}>
              <View style={styles.dialCode}>
                <Text style={styles.dialCodeText}>+91</Text>
              </View>
              <TextInput
                testID="mobile-input"
                style={[styles.input, styles.mobileInput]}
                placeholder="10-digit number"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                maxLength={10}
                value={mobile}
                onChangeText={(v) => setMobile(v.replace(/\D/g, "").slice(0, 10))}
              />
            </View>
          </View>

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
                placeholder="At least 8 characters"
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
            <Text style={styles.helperText}>You&apos;ll use this email + password to sign in later.</Text>
          </View>

          {error && (
            <Text style={styles.error} testID="register-error">
              {error}
            </Text>
          )}

          <Pressable
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
            testID="register-submit-btn"
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Send OTP</Text>
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
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: spacing.xl, lineHeight: 22 },
  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: 16,
    marginBottom: spacing.lg,
  },
  infoBannerText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 18 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    padding: 4,
    borderRadius: 14,
    marginBottom: spacing.xl,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: "center" },
  segmentItemActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 14, color: colors.muted, fontWeight: "500" },
  segmentTextActive: { color: colors.onBrandPrimary, fontWeight: "600" },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.muted, marginBottom: 6, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  helperText: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
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
  mobileRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dialCode: {
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 16,
    borderColor: colors.border, borderWidth: 1,
  },
  dialCodeText: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  mobileInput: { flex: 1 },
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
  footer: {
    marginTop: "auto",
    flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: spacing.xl,
  },
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: colors.accentText, fontSize: 14, fontWeight: "600" },
});
