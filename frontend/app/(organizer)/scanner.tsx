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
import { ticketTypeLine } from "@/src/utils/ticketLabel";

type Preview = {
  ok: boolean;
  already_checked_in?: boolean;
  cancelled?: boolean;
  checked_in_at?: string | null;
  event_title?: string;
  attendee_name?: string | null;
  attendee_email?: string | null;
  booking?: any;
  error?: string;
};

type Confirmed = {
  attendee_name?: string | null;
  event_title?: string;
  booking?: any;
  already_checked_in?: boolean;
};

export default function Scanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);

  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const onScanned = async (data: string) => {
    if (!scanning || previewLoading) return;
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
      setPreview({ ok: false, error: "Invalid QR code. Not a GatherSpace ticket." });
      return;
    }

    setPreviewLoading(true);
    try {
      const r = await api.checkInPreview(bookingId);
      Haptics.notificationAsync(
        r.already_checked_in
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success
      );
      setPreview({ ok: true, ...r });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPreview({ ok: false, error: e?.message || "Ticket lookup failed" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmEntry = async () => {
    if (!preview?.booking?.id || confirming) return;
    setConfirming(true);
    try {
      const r = await api.checkIn(preview.booking.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmed({
        attendee_name: r.attendee_name || preview.attendee_name,
        event_title: r.event_title || preview.event_title,
        booking: r.booking || preview.booking,
        already_checked_in: r.already_checked_in,
      });
      setPreview(null);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPreview({ ok: false, error: e?.message || "Check-in failed" });
    } finally {
      setConfirming(false);
    }
  };

  const cancelPreview = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPreview(null);
    lastScannedRef.current = null;
    setScanning(true);
  };

  const scanNext = () => {
    lastScannedRef.current = null;
    setConfirmed(null);
    setPreview(null);
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

  const previewInvalid = preview && !preview.ok;
  const previewValid = preview && preview.ok;
  const isPaid = preview?.booking?.payment_status === "paid";
  const owesMoney = (preview?.booking?.total_price || 0) > 0 && !isPaid;
  const price = preview?.booking?.total_price || 0;
  const ttype = ticketTypeLine(preview?.booking);
  const canConfirm =
    !!previewValid &&
    !preview?.cancelled &&
    !preview?.already_checked_in &&
    !confirming;

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
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
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

      {previewLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.brand} />
            <Text style={styles.loadingText}>Reading ticket…</Text>
          </View>
        </View>
      )}

      {/* Verification (pre-check-in) modal */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={cancelPreview}>
        <View style={styles.modalBg}>
          <View style={styles.verifyCard}>
            {previewInvalid ? (
              <>
                <View style={[styles.resultIcon, { backgroundColor: colors.error }]}>
                  <Ionicons name="close" size={40} color="#FFFFFF" />
                </View>
                <Text style={styles.resultTitle}>Not Valid</Text>
                <Text style={styles.errorText}>{preview?.error}</Text>
                <Pressable style={styles.primaryBtn} onPress={scanNext} testID="scan-again-btn">
                  <Ionicons name="scan" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.primaryBtnText}>Scan next ticket</Text>
                </Pressable>
              </>
            ) : preview?.cancelled ? (
              <>
                <View style={[styles.resultIcon, { backgroundColor: colors.error }]}>
                  <Ionicons name="ban" size={36} color="#FFFFFF" />
                </View>
                <Text style={styles.resultTitle}>Booking Cancelled</Text>
                <Text style={styles.resultSub}>This ticket was cancelled and cannot be used.</Text>
                <Pressable style={styles.primaryBtn} onPress={scanNext} testID="scan-again-btn">
                  <Ionicons name="scan" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.primaryBtnText}>Scan next ticket</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* Status hero */}
                {preview?.already_checked_in ? (
                  <View style={[styles.statusHero, { backgroundColor: colors.warning }]}>
                    <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
                    <Text style={styles.statusHeroText}>Already Checked In</Text>
                  </View>
                ) : isPaid ? (
                  <View style={[styles.statusHero, { backgroundColor: "#059669" }]}>
                    <Ionicons name="shield-checkmark" size={22} color="#FFFFFF" />
                    <Text style={styles.statusHeroText}>Paid Online</Text>
                  </View>
                ) : owesMoney ? (
                  <View style={[styles.statusHero, { backgroundColor: "#D97706" }]}>
                    <Ionicons name="wallet" size={22} color="#FFFFFF" />
                    <Text style={styles.statusHeroText}>Payment Pending</Text>
                  </View>
                ) : (
                  <View style={[styles.statusHero, { backgroundColor: "#059669" }]}>
                    <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                    <Text style={styles.statusHeroText}>Free Ticket</Text>
                  </View>
                )}

                <Text style={styles.eventTitle} numberOfLines={2}>{preview?.event_title}</Text>

                {preview?.booking?.time_slot && (
                  <View style={styles.slotHighlight} testID="scan-slot-banner">
                    <Ionicons name="time" size={18} color={colors.onBrandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.slotHighlightLabel}>Time slot</Text>
                      <Text style={styles.slotHighlightValue} numberOfLines={1}>
                        {preview.booking.time_slot}
                        {preview.booking.num_seats > 1 ? `  ·  ${preview.booking.num_seats} seats` : ""}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.rowBlock}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="person" size={16} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>Attendee</Text>
                    <Text style={styles.rowValue} numberOfLines={1}>
                      {preview?.attendee_name || "Guest"}
                    </Text>
                    {preview?.attendee_email && (
                      <Text style={styles.rowSub} numberOfLines={1}>{preview.attendee_email}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.rowBlock}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={ttype.icon} size={16} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>Ticket type</Text>
                    <Text style={styles.rowValue} numberOfLines={2}>{ttype.label}</Text>
                  </View>
                </View>

                {price > 0 && (
                  <View style={styles.rowBlock}>
                    <View style={styles.rowIcon}>
                      <Ionicons name="cash" size={16} color={colors.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>Amount</Text>
                      <Text style={styles.rowValue}>₹{price.toFixed(0)}</Text>
                    </View>
                  </View>
                )}

                {owesMoney && (
                  <View style={styles.collectBanner}>
                    <Ionicons name="alert-circle" size={16} color="#92400E" />
                    <Text style={styles.collectText}>
                      Collect ₹{price.toFixed(0)} at the gate before confirming entry
                    </Text>
                  </View>
                )}

                {preview?.already_checked_in && (
                  <Text style={styles.checkedInHint}>
                    {preview.checked_in_at
                      ? `Checked in at ${new Date(preview.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "This ticket has already been used."}
                  </Text>
                )}

                <View style={styles.actionsRow}>
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={cancelPreview}
                    testID="cancel-scan-btn"
                    disabled={confirming}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>
                  {canConfirm ? (
                    <Pressable
                      style={[styles.primaryBtn, styles.primaryBtnFlex]}
                      onPress={confirmEntry}
                      testID="confirm-entry-btn"
                    >
                      {confirming ? (
                        <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color={colors.onBrandPrimary} />
                          <Text style={styles.primaryBtnText}>Confirm Entry</Text>
                        </>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.primaryBtn, styles.primaryBtnFlex]}
                      onPress={scanNext}
                      testID="scan-again-btn"
                    >
                      <Ionicons name="scan" size={18} color={colors.onBrandPrimary} />
                      <Text style={styles.primaryBtnText}>Scan next</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Success (post check-in) modal */}
      <Modal visible={!!confirmed} transparent animationType="fade" onRequestClose={scanNext}>
        <View style={styles.modalBg}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={40} color="#FFFFFF" />
            </View>
            <Text style={styles.successTitle}>Welcome!</Text>
            <Text style={styles.successSub}>{confirmed?.event_title}</Text>
            {confirmed?.attendee_name && (
              <View style={styles.attendeeRow}>
                <Ionicons name="person-outline" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.attendeeName}>{confirmed.attendee_name}</Text>
              </View>
            )}
            {confirmed?.booking?.time_slot && (
              <View style={styles.slotSuccessBanner} testID="success-slot-banner">
                <Ionicons name="time" size={16} color={colors.brand} />
                <Text style={styles.slotSuccessText}>
                  {confirmed.booking.time_slot}
                  {confirmed.booking.num_seats > 1 ? `  ·  ${confirmed.booking.num_seats} seats` : ""}
                </Text>
              </View>
            )}
            <Pressable style={styles.primaryBtn} onPress={scanNext} testID="scan-next-btn">
              <Ionicons name="scan" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.primaryBtnText}>Scan next ticket</Text>
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
  headerTitleLight: { fontSize: 18, fontWeight: "600", color: "#FFFFFF" },
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
    color: "#FFFFFF", fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },

  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  loadingCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radius.pill,
    ...shadows.floating,
  },
  loadingText: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },

  modalBg: {
    flex: 1, backgroundColor: "rgba(17,24,39,0.6)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  verifyCard: {
    width: "100%", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
    gap: spacing.sm, ...shadows.floating,
  },
  statusHero: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: 14, borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  statusHeroText: {
    color: "#FFFFFF", fontSize: 18, fontWeight: "700", letterSpacing: 0.3,
  },
  eventTitle: {
    fontSize: 15, fontWeight: "600", color: colors.onSurface,
    textAlign: "center", marginBottom: spacing.sm,
  },
  rowBlock: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    padding: spacing.md, borderRadius: radius.md,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  rowValue: { fontSize: 15, color: colors.onSurface, fontWeight: "600", marginTop: 2 },
  rowSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },

  collectBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF3C7",
    padding: spacing.md, borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  collectText: { color: "#92400E", fontSize: 13, fontWeight: "600", flex: 1 },
  checkedInHint: {
    fontSize: 13, color: colors.muted, textAlign: "center",
    marginTop: spacing.xs,
  },

  actionsRow: {
    flexDirection: "row", gap: spacing.sm, marginTop: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    alignSelf: "stretch",
  },
  primaryBtnFlex: { flex: 1, paddingHorizontal: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14,
    alignItems: "center", justifyContent: "center",
    minWidth: 100,
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },

  errorText: { color: colors.error, fontSize: 14, textAlign: "center", marginTop: 4 },

  // Success modal
  successCard: {
    width: "100%", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
    alignItems: "center", gap: spacing.sm, ...shadows.floating,
  },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  successTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  successSub: { fontSize: 15, color: colors.muted, textAlign: "center" },
  attendeeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  attendeeName: { fontSize: 15, color: colors.onSurface, fontWeight: "600" },
  slotHighlight: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    marginTop: spacing.md,
  },
  slotHighlightLabel: {
    fontSize: 11, color: colors.onBrandPrimary, opacity: 0.85,
    letterSpacing: 0.5, textTransform: "uppercase", fontWeight: "600",
  },
  slotHighlightValue: {
    fontSize: 16, color: colors.onBrandPrimary, fontWeight: "700", marginTop: 2,
  },
  slotSuccessBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginTop: spacing.sm,
  },
  slotSuccessText: { fontSize: 13, color: colors.brand, fontWeight: "600" },
  resultIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  resultTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  resultSub: { fontSize: 15, color: colors.muted, textAlign: "center" },
});
