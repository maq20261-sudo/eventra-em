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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { isPhoneAuthSupported, sendOtp, toE164India } from "@/src/firebase";
import { setPhoneSession } from "@/src/phoneSession";

export default function ForgotPassword() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const phoneSupported = isPhoneAuthSupported();

  const submit = async () => {
    setError(null);
    const cleanMobile = mobile.replace(/\D/g, "");
    if (cleanMobile.length !== 10 || !"6789".includes(cleanMobile[0])) {
      setError("Enter a valid 10-digit Indian mobile (starting 6/7/8/9).");
      return;
    }
    if (!phoneSupported) {
      setError(
        "Phone verification isn't available on this platform. Please open GatherSpace on your phone to reset your password."
      );
      return;
    }
    setLoading(true);
    try {
      const conf = await sendOtp(cleanMobile);
      setPhoneSession({
        confirmation: conf,
        kind: "reset",
        mobile: toE164India(cleanMobile),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/(auth)/reset-password" as any,
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="key-outline" size={32} color={colors.brand} />
          </View>

          <Text style={styles.title}>Forgot password?</Text>
          <Text style={styles.subtitle}>
            Enter the mobile number registered with your account. We&apos;ll send you a 6-digit code to verify.
          </Text>

          {!phoneSupported && Platform.OS === "web" && (
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={18} color={colors.brand} />
              <Text style={styles.infoBannerText}>
                Password reset via OTP only works in the installed app.
              </Text>
            </View>
          )}

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
                autoFocus
              />
            </View>
          </View>

          {error && (
            <Text style={styles.error} testID="forgot-error">
              {error}
            </Text>
          )}

          <Pressable
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
            testID="send-reset-otp-btn"
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.primaryText}>Send OTP</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.footer}>
            <Text style={styles.footerLink}>Back to sign in</Text>
          </Pressable>
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
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontSize: 30, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: spacing.xl, lineHeight: 22 },
  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoBannerText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 18 },
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
  mobileRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dialCode: {
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderColor: colors.border, borderWidth: 1,
  },
  dialCodeText: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  mobileInput: { flex: 1 },
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
  footer: { alignItems: "center", paddingTop: spacing.xl, marginTop: "auto" },
  footerLink: { color: colors.brand, fontSize: 14, fontWeight: "600" },
});
