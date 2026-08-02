import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { useAuth } from "@/src/AuthContext";
import { spacing, radius } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { sendOtp, verifyOtp } from "@/src/firebase";
import { getPhoneSession, setPhoneSession, clearPhoneSession } from "@/src/phoneSession";

export default function ResetPassword() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mobile_masked?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signInWithToken } = useAuth();

  const session = getPhoneSession();
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const [mobileMasked, setMobileMasked] = useState<string>(
    (params.mobile_masked as string) || session?.confirmation.mobileMasked || ""
  );
  const otpRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => otpRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!session || session.kind !== "reset") {
      router.replace("/(auth)/forgot-password" as any);
    }
  }, [session, router]);

  const submit = async () => {
    setError(null);
    if (otp.length < 6) return setError("Enter the 6-digit OTP");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    if (!session) return setError("Session expired. Please start again.");

    setLoading(true);
    try {
      const idToken = await verifyOtp(session.confirmation, otp);
      const res = await api.passwordResetVerify({
        id_token: idToken,
        new_password: password,
      });
      await signInWithToken(res.access_token, res.user);
      clearPhoneSession();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Password updated",
        "You've been signed in with your new password.",
        [
          {
            text: "OK",
            onPress: () => {
              if (res.user?.role === "organizer") router.replace("/(organizer)/events" as any);
              else router.replace("/(consumer)/discover" as any);
            },
          },
        ]
      );
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Couldn't reset password.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (seconds > 0 || resending || !session) return;
    setResending(true);
    setError(null);
    try {
      const rawMobile = session.mobile.replace(/\D/g, "");
      const fresh = await sendOtp(rawMobile, true);
      setPhoneSession({ ...session, confirmation: fresh });
      setMobileMasked(fresh.mobileMasked);
      setOtp("");
      setSeconds(30);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert("OTP resent", `A new code was sent to ${fresh.mobileMasked}`);
    } catch (e: any) {
      setError(e?.message || "Couldn't resend");
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="reset-back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={32} color={colors.brand} />
          </View>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to{"\n"}
            <Text style={styles.mobile}>{mobileMasked}</Text>
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>OTP</Text>
            <TextInput
              ref={otpRef}
              testID="otp-input"
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="••••••"
              placeholderTextColor={colors.muted}
              style={styles.otpInput}
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>New Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="new-password-input"
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
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput
              testID="confirm-password-input"
              style={styles.input}
              placeholder="Re-enter password"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showPassword}
              value={confirm}
              onChangeText={setConfirm}
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            testID="reset-submit-btn"
            style={[styles.primaryBtn, (loading || otp.length < 6) && { opacity: 0.55 }]}
            onPress={submit}
            disabled={loading || otp.length < 6}
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Reset Password</Text>
            )}
          </Pressable>

          <View style={styles.resendRow}>
            <Text style={styles.resendLabel}>Didn&apos;t receive it?</Text>
            <Pressable onPress={resend} disabled={seconds > 0 || resending} testID="reset-resend-btn">
              <Text style={[styles.resendLink, (seconds > 0 || resending) && { color: colors.muted }]}>
                {seconds > 0 ? `Resend in ${seconds}s` : resending ? "Sending…" : "Resend OTP"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, alignItems: "center" },
  iconWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginTop: spacing.md, marginBottom: spacing.lg,
  },
  title: { fontSize: 24, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22, marginBottom: spacing.lg },
  mobile: { fontWeight: "700", color: colors.onSurface },
  field: { width: "100%", marginBottom: spacing.md },
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
  otpInput: {
    width: "100%",
    fontSize: 28, fontWeight: "700", letterSpacing: 12,
    textAlign: "center",
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: 14,
  },
  passwordRow: { position: "relative" },
  passwordInput: { paddingRight: 44 },
  eyeBtn: {
    position: "absolute", right: 4, top: 0, bottom: 0,
    width: 44, alignItems: "center", justifyContent: "center",
  },
  error: {
    color: colors.error, fontSize: 14,
    backgroundColor: "#FEF2F2", padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.md, textAlign: "center", width: "100%",
  },
  primaryBtn: {
    marginTop: spacing.sm, width: "100%",
    backgroundColor: colors.brandPrimary,
    paddingVertical: 16, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  resendRow: { flexDirection: "row", gap: 6, marginTop: spacing.lg },
  resendLabel: { fontSize: 14, color: colors.muted },
  resendLink: { fontSize: 14, color: colors.brand, fontWeight: "600" },
});
