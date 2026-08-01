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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { useAuth } from "@/src/AuthContext";
import { spacing, radius } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

export default function OtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    kind: "register" | "login";
    challenge_id: string;
    mobile_masked: string;
    expires_in?: string;
  }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signInWithToken } = useAuth();

  const [challengeId, setChallengeId] = useState(String(params.challenge_id || ""));
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [challengeId]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const submit = async () => {
    if (otp.length < 6) {
      setError("Enter the 6-digit OTP");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const call = params.kind === "register" ? api.registerVerify : api.loginVerify;
      const res = await call({ challenge_id: challengeId, otp });
      await signInWithToken(res.access_token, res.user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res.user?.role === "organizer") router.replace("/(organizer)/events" as any);
      else router.replace("/(consumer)/discover" as any);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (seconds > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await api.otpResend({ challenge_id: challengeId });
      setChallengeId(res.challenge_id);
      setOtp("");
      setSeconds(30);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert("OTP resent", `A new code was sent to ${res.mobile_masked}`);
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
          <Pressable onPress={() => router.back()} testID="otp-back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name="phone-portrait" size={40} color={colors.brand} />
          </View>
          <Text style={styles.title}>Verify your mobile</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to{"\n"}
            <Text style={styles.mobile}>{params.mobile_masked}</Text>
          </Text>

          <View style={styles.otpBox}>
            <TextInput
              ref={inputRef}
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

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            testID="otp-verify-btn"
            style={[styles.primaryBtn, (loading || otp.length < 6) && { opacity: 0.55 }]}
            onPress={submit}
            disabled={loading || otp.length < 6}
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Verify & Continue</Text>
            )}
          </Pressable>

          <View style={styles.resendRow}>
            <Text style={styles.resendLabel}>Didn&apos;t receive it?</Text>
            <Pressable onPress={resend} disabled={seconds > 0 || resending} testID="otp-resend-btn">
              <Text style={[styles.resendLink, (seconds > 0 || resending) && { color: colors.muted }]}>
                {seconds > 0 ? `Resend in ${seconds}s` : resending ? "Sending…" : "Resend OTP"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  body: { flex: 1, paddingHorizontal: spacing.xl, alignItems: "center" },
  iconWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginTop: spacing.xl, marginBottom: spacing.lg,
  },
  title: { fontSize: 26, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },
  mobile: { fontWeight: "700", color: colors.onSurface },
  otpBox: { marginTop: spacing.xl, width: "100%", alignItems: "center" },
  otpInput: {
    width: 240,
    fontSize: 32, fontWeight: "700", letterSpacing: 14,
    textAlign: "center",
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: 16,
  },
  error: { color: colors.error, marginTop: spacing.md, fontSize: 14 },
  primaryBtn: {
    marginTop: spacing.xl, width: "100%",
    backgroundColor: colors.brandPrimary,
    paddingVertical: 16, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  resendRow: { flexDirection: "row", gap: 6, marginTop: spacing.lg },
  resendLabel: { fontSize: 14, color: colors.muted },
  resendLink: { fontSize: 14, color: colors.brand, fontWeight: "600" },
});
