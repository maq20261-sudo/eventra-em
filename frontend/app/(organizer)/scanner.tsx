import { useState, useRef, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

type Result = {
  ok: boolean;
  already_checked_in?: boolean;
  event_title?: string;
  attendee_name?: string | null;
  booking?: any;
  error?: string;
};

export default function Scanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const onScanned = async (data: string) => {
    if (!scanning) return;
    if (lastScannedRef.current === data) return;
    lastScannedRef.current = data;
    setScanning(false);
    let bookingId: string | null = null;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.t === "gs-ticket" && parsed?.id) bookingId = parsed.id;
    } catch {
      bookingId = data.trim();
    }
    if (!bookingId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setResult({ ok: false, error: "Invalid QR code. Not a GatherSpace ticket." });
      return;
    }
    try {
      const r = await api.checkIn(bookingId);
      Haptics.notificationAsync(
        r.already_checked_in
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success
      );
      setResult({ ok: true, ...r });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setResult({ ok: false, error: e?.message || "Check-in failed" });
    }
  };

  const scanAgain = () => {
    lastScannedRef.current = null;
    setResult(null);
    setScanning(true);
  };

  if (!permission) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="scanner-back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Ticket Scanner</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.permWrap}>
          <View style={styles.permIcon}>
            <Ionicons name="camera" size={40} color={colors.brand} />
          </View>
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permSub}>
            Grant camera permission to scan attendee tickets at your event entrance.
          </Text>
          {permission.canAskAgain ? (
            <Pressable style={styles.permBtn} onPress={requestPermission} testID="grant-camera-btn">
              <Text style={styles.permBtnText}>Grant Access</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.permBtn} onPress={() => Linking.openSettings()} testID="open-settings-btn">
              <Text style={styles.permBtnText}>Open Settings</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanning ? (e) => onScanned(e.data) : undefined}
      />

      <SafeAreaView edges={["top"]} style={styles.overlayTop}>
        <View style={styles.header}>
          <Pressable style={styles.iconBtnDark} onPress={() => router.back()} testID="scanner-back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.surface} />
          </Pressable>
          <Text style={styles.headerTitleLight}>Scan Ticket</Text>
          <View style={styles.iconBtnDark} />
        </View>
      </SafeAreaView>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
        <Text style={styles.frameHint}>Point at attendee&apos;s QR code</Text>
      </View>

      <Modal visible={!!result} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.resultCard}>
            <View style={[
              styles.resultIcon,
              !result?.ok && { backgroundColor: colors.error },
              result?.already_checked_in && { backgroundColor: colors.warning },
            ]}>
              <Ionicons
                name={
                  !result?.ok ? "close" :
                  result?.already_checked_in ? "alert" : "checkmark"
                }
                size={40}
                color={colors.onBrandPrimary}
              />
            </View>
            <Text style={styles.resultTitle}>
              {!result?.ok
                ? "Not Valid"
                : result?.already_checked_in
                ? "Already Checked In"
                : "Welcome!"}
            </Text>
            {result?.ok && result?.event_title && (
              <Text style={styles.resultSub}>{result.event_title}</Text>
            )}
            {result?.ok && result?.attendee_name && (
              <View style={styles.attendeeRow}>
                <Ionicons name="person-outline" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.attendeeName}>{result.attendee_name}</Text>
              </View>
            )}
            {result?.booking && (
              <Text style={styles.bookingLine}>
                {result.booking.seats?.length
                  ? `Seats · ${result.booking.seats.join(", ")}`
                  : result.booking.num_seats
                  ? `${result.booking.num_seats} × ticket`
                  : result.booking.time_slot || ""}
              </Text>
            )}
            {result?.booking?.total_price > 0 && !result.already_checked_in && result?.booking?.payment_status === "paid" && (
              <View style={styles.paidPill}>
                <Ionicons name="shield-checkmark" size={14} color={colors.brand} />
                <Text style={styles.paidText}>Paid online · ${result.booking.total_price.toFixed(2)}</Text>
              </View>
            )}
            {result?.booking?.total_price > 0 && !result.already_checked_in && result?.booking?.payment_status !== "paid" && (
              <View style={styles.payPill}>
                <Ionicons name="wallet-outline" size={14} color={colors.warning} />
                <Text style={styles.payText}>Collect ${result.booking.total_price.toFixed(2)} at venue</Text>
              </View>
            )}
            {result?.error && <Text style={styles.errorText}>{result.error}</Text>}

            <Pressable style={styles.scanBtn} onPress={scanAgain} testID="scan-again-btn">
              <Ionicons name="scan" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.scanBtnText}>Scan next ticket</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface },
  headerTitleLight: { fontSize: 18, fontWeight: "600", color: colors.surface },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnDark: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  overlayTop: { position: "absolute", top: 0, left: 0, right: 0 },

  permWrap: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md },
  permIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  permTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  permSub: { fontSize: 14, color: colors.muted, textAlign: "center" },
  permBtn: {
    marginTop: spacing.md, backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: 14, borderRadius: radius.pill,
  },
  permBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },

  frameWrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", gap: spacing.lg,
  },
  frame: { width: 260, height: 260, borderRadius: radius.lg },
  corner: {
    position: "absolute", width: 40, height: 40, borderColor: colors.brandPrimary, borderWidth: 4,
  },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: radius.md },
  frameHint: {
    color: colors.surface, fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },

  modalBg: {
    flex: 1, backgroundColor: "rgba(17,24,39,0.6)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  resultCard: {
    width: "100%", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
    alignItems: "center", gap: spacing.sm, ...shadows.floating,
  },
  resultIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  resultTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  resultSub: { fontSize: 15, color: colors.muted, textAlign: "center" },
  attendeeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  attendeeName: { fontSize: 15, color: colors.onSurface, fontWeight: "600" },
  bookingLine: { fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 4 },
  payPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FEF3C7", paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, marginTop: spacing.md,
  },
  payText: { color: "#92400E", fontSize: 13, fontWeight: "600" },
  paidPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, marginTop: spacing.md,
  },
  paidText: { color: colors.onBrandTertiary, fontSize: 13, fontWeight: "600" },
  errorText: { color: colors.error, fontSize: 14, textAlign: "center", marginTop: 4 },
  scanBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14,
    alignSelf: "stretch",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  scanBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },
});
