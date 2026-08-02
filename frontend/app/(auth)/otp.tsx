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
import { sendOtp, verifyOtp } from "@/src/firebase";
import { getPhoneSession, setPhoneSession, clearPhoneSession } from "@/src/phoneSession";

export default function OtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mobile_masked?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signInWithToken } = useAuth();

  const session = getPhoneSession();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const [mobileMasked, setMobileMasked] = useState<string>(
    (params.mobile_masked as string) || session?.confirmation.mobileMasked || ""
  );
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // If someone deep-links to /otp without an active session, kick them back.
    if (!session) {
      router.replace("/(auth)/welcome" as any);
    }
  }, [session, router]);

  const submit = async () => {
    if (otp.length < 6) {
      setError("Enter the 6-digit OTP");
      return;
    }
    if (!session) {
      setError("Session expired. Please restart the flow.");
      return;
    }
    if (!session.email || !session.password || !session.name || !session.role) {
      setError("Signup details missing. Please go back and try again.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const idToken = await verifyOtp(session.confirmation, otp);
      const res = await api.firebaseVerify({
        id_token: idToken,
        name: session.name,
        email: session.email,
        password: session.password,
        role: session.role,
      });
      await signInWithToken(res.access_token, res.user);
      clearPhoneSession();
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
    if (seconds > 0 || resending || !session) return;
    setResending(true);
    setError(null);
    try {
      const rawMobile = session.mobile.replace(/\D/g, "");
      const fresh = await sendOtp(rawMobile);
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
            <Text style={styles.mobile}>{mobileMasked}</Text>
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
  error: { color: colors.error, marginTop: spacing.md, fontSize: 14, textAlign: "center", paddingHorizontal: spacing.md },
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
