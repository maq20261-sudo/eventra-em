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
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { isPhoneAuthSupported, sendOtp, toE164India } from "@/src/firebase";
import { setPhoneSession } from "@/src/phoneSession";

export default function Register() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole = (params.role === "organizer" ? "organizer" : "consumer") as "consumer" | "organizer";
  const [role, setRole] = useState<"consumer" | "organizer">(initialRole);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const phoneSupported = isPhoneAuthSupported();

  const submit = async () => {
    setError(null);
    const cleanMobile = mobile.replace(/\D/g, "");
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (cleanMobile.length !== 10 || !"6789".includes(cleanMobile[0])) {
      setError("Enter a valid 10-digit Indian mobile (starting 6/7/8/9).");
      return;
    }
    if (!phoneSupported) {
      setError(
        "Phone verification requires an Android build. Please click Publish → Deploy → Generate build to test this flow on-device."
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
        name: name.trim(),
        email: email.trim().toLowerCase() || undefined,
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join GatherSpace in seconds</Text>

          {!phoneSupported && (
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={18} color={colors.brand} />
              <Text style={styles.infoBannerText}>
                Phone verification works on the installed Android app. Please open GatherSpace on your phone to create an account.
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
            <Text style={styles.label}>Email (optional)</Text>
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
            <Text style={styles.helperText}>Only used to send booking receipts. You can skip this.</Text>
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg, ...shadows.card,
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: spacing.xl },
  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoBannerText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 18 },
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
  helperText: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
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
  footer: {
    marginTop: "auto",
    flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: spacing.xl,
  },
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: colors.brand, fontSize: 14, fontWeight: "600" },
});
