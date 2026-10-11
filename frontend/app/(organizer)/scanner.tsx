import { useState, useRef, useEffect, useMemo } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Modal, Linking } from "react-native";
import { Text } from "@/src/ui/Text";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { softPop } from "@/src/ui/motion";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { Confetti } from "@/src/ui/Confetti";
import { Button } from "@/src/ui/Button";
import { PressableScale } from "@/src/ui/PressableScale";

/** Lime scan line sweeping the viewfinder. */
function ScanLine() {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: 20 + y.value * 220 }] }));
  return (
    <Animated.View
      style={[{ position: "absolute", left: 22, right: 22, top: 0, height: 3, borderRadius: 2, backgroundColor: "#C6FF3D", shadowColor: "#C6FF3D", shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 6 }, style]}
    />
  );
}
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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={["top", "bottom"]}>
        <GlowBackground />
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="scanner-back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Ticket Scanner</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.permWrap}>
          <View style={styles.permIcon}>
            <Ionicons name="camera" size={40} color={colors.accentText} />
          </View>
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permSub}>
            Grant camera permission to scan attendee tickets at your event entrance.
          </Text>
          {permission.canAskAgain ? (
            <Button title="Grant Access" icon="camera" onPress={requestPermission} testID="grant-camera-btn" style={{ alignSelf: "stretch", marginTop: spacing.md }} />
          ) : (
            <Button title="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} testID="open-settings-btn" style={{ alignSelf: "stretch", marginTop: spacing.md }} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const previewInvalid = preview && !preview.ok;
  const previewValid = preview && preview.ok;
  const isPaid = preview?.booking?.payment_status === "paid";
  // `grand_total_inr` is the source of truth for what the organizer must
  // collect at the gate (ticket + ₹9 attendee platform fee when not
  // waived). Fall back to ticket + fee for legacy scans; final fallback
  // to ticket alone so nothing breaks on very old bookings.
  const ticketPrice = preview?.booking?.total_price || 0;
  const platformFee = preview?.booking?.platform_fee_inr || 0;
  const grandTotal =
    preview?.booking?.grand_total_inr ??
    (ticketPrice + platformFee);
  const owesMoney = grandTotal > 0 && !isPaid;
  const price = grandTotal;
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
          {scanning && !preview ? <ScanLine /> : null}
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
                <Animated.View entering={softPop()} style={[styles.resultIcon, { backgroundColor: colors.error + "29" }]}>
                  <Ionicons name="close" size={40} color={colors.error} />
                </Animated.View>
                <Text style={styles.resultTitle}>Not Valid</Text>
                <Text style={styles.errorText}>{preview?.error}</Text>
                <Pressable style={styles.primaryBtn} onPress={scanNext} testID="scan-again-btn">
                  <Ionicons name="scan" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.primaryBtnText}>Scan next ticket</Text>
                </Pressable>
              </>
            ) : preview?.cancelled ? (
              <>
                <Animated.View entering={softPop()} style={[styles.resultIcon, { backgroundColor: colors.error + "29" }]}>
                  <Ionicons name="ban" size={36} color={colors.error} />
                </Animated.View>
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
                  <View style={[styles.statusHero, { backgroundColor: colors.warning + "26", borderColor: colors.warning + "66" }]}>
                    <Ionicons name="alert-circle" size={22} color={colors.warning} />
                    <Text style={[styles.statusHeroText, { color: colors.warning }]}>Already Checked In</Text>
                  </View>
                ) : isPaid ? (
                  <View style={[styles.statusHero, { backgroundColor: colors.success + "24", borderColor: colors.success + "66" }]}>
                    <Ionicons name="shield-checkmark" size={22} color={colors.success} />
                    <Text style={[styles.statusHeroText, { color: colors.success }]}>Paid Online</Text>
                  </View>
                ) : owesMoney ? (
                  <View style={[styles.statusHero, { backgroundColor: colors.warning + "26", borderColor: colors.warning + "66" }]}>
                    <Ionicons name="wallet" size={22} color={colors.warning} />
                    <Text style={[styles.statusHeroText, { color: colors.warning }]}>Payment Pending</Text>
                  </View>
                ) : (
                  <View style={[styles.statusHero, { backgroundColor: colors.success + "24", borderColor: colors.success + "66" }]}>
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                    <Text style={[styles.statusHeroText, { color: colors.success }]}>Free Ticket</Text>
                  </View>
                )}

                <Text style={styles.eventTitle} numberOfLines={2}>{preview?.event_title}</Text>

                {preview?.booking?.time_slot && (
                  <View style={styles.slotHighlight} testID="scan-slot-banner">
                    <Ionicons name="time" size={18} color={colors.accentText} />
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
                    <Ionicons name="person" size={16} color={colors.accentText} />
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
                    <Ionicons name={ttype.icon as any} size={16} color={colors.accentText} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>Ticket type</Text>
                    <Text style={styles.rowValue} numberOfLines={2}>{ttype.label}</Text>
                  </View>
                </View>

                {price > 0 && (
                  <View style={styles.rowBlock}>
                    <View style={styles.rowIcon}>
                      <Ionicons name="cash" size={16} color={colors.accentText} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>Amount</Text>
                      <Text style={styles.rowValue}>₹{price.toFixed(0)}</Text>
                      {platformFee > 0 && (
                        <Text style={styles.rowSub}>
                          Ticket ₹{ticketPrice.toFixed(0)} + platform fee ₹{platformFee.toFixed(0)}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {owesMoney && (
                  <View style={styles.collectBanner}>
                    <Ionicons name="alert-circle" size={16} color={colors.warning} />
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

      {/* Success (post check-in) — full-screen celebration */}
      <Modal visible={!!confirmed} animationType="fade" onRequestClose={scanNext} statusBarTranslucent>
        <SafeAreaView style={styles.successScreen}>
          <GlowBackground variant="success" />
          {confirmed ? <Confetti count={40} /> : null}
          <View style={styles.successBody}>
            <Animated.View entering={softPop()} style={styles.successIcon}>
              <Ionicons name="checkmark" size={56} color={colors.onLime} />
            </Animated.View>
            <Animated.Text entering={FadeInDown.delay(150)} style={styles.successTitle}>Welcome!</Animated.Text>
            {confirmed?.attendee_name ? (
              <Animated.Text entering={FadeInDown.delay(220)} style={styles.attendeeName}>{confirmed.attendee_name}</Animated.Text>
            ) : null}
            <Animated.Text entering={FadeInDown.delay(260)} style={styles.successSub}>{confirmed?.event_title}</Animated.Text>
            {confirmed?.booking?.time_slot && (
              <View style={styles.slotSuccessBanner} testID="success-slot-banner">
                <Ionicons name="time" size={16} color={colors.accentText} />
                <Text style={styles.slotSuccessText}>
                  {confirmed.booking.time_slot}
                  {confirmed.booking.num_seats > 1 ? `  ·  ${confirmed.booking.num_seats} seats` : ""}
                </Text>
              </View>
            )}
            <View style={styles.checkedTag}>
              <Text style={styles.checkedTagText}>CHECKED IN · {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
            </View>
          </View>
          <View style={{ padding: 20 }}>
            <Button title="Scan next ticket" icon="scan" variant="lime" onPress={scanNext} testID="scan-next-btn" />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05040C" },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  headerTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  headerTitleLight: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnDark: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(13,11,26,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  overlayTop: { position: "absolute", top: 0, left: 0, right: 0 },

  permWrap: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md },
  permIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
    ...shadows.glow,
  },
  permTitle: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  permSub: { fontSize: 14, color: colors.soft, textAlign: "center", lineHeight: 20 },

  frameWrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", gap: spacing.xl,
  },
  frame: { width: 264, height: 264 },
  corner: { position: "absolute", width: 56, height: 56, borderColor: colors.brandPrimary, borderWidth: 5 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 24 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 24 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 24 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 24 },
  frameHint: {
    color: "#FFFFFF", fontSize: 14, fontWeight: "700",
    backgroundColor: "rgba(13,11,26,0.7)",
    paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.pill,
    overflow: "hidden",
  },

  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  loadingCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radius.pill,
    ...shadows.floating,
  },
  loadingText: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },

  modalBg: {
    flex: 1, backgroundColor: colors.overlay,
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  verifyCard: {
    width: "100%", backgroundColor: colors.sheet,
    borderRadius: 24, borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, gap: spacing.sm, ...shadows.floating,
  },
  statusHero: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: 14, borderRadius: 16, borderWidth: 1,
    marginBottom: spacing.sm,
  },
  statusHeroText: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700" },
  eventTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, textAlign: "center", marginBottom: spacing.sm },
  rowBlock: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, borderRadius: 16,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },
  rowValue: { fontSize: 15, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  rowSub: { fontSize: 12, color: colors.soft, marginTop: 2 },
  collectBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.warning + "1F", borderWidth: 1, borderColor: colors.warning + "55",
    padding: spacing.md, borderRadius: 14,
    marginTop: spacing.xs,
  },
  collectText: { color: colors.warning, fontSize: 13, fontWeight: "800", flex: 1 },
  checkedInHint: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: spacing.xs },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16, height: 52,
    paddingHorizontal: spacing.xl,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    alignSelf: "stretch",
  },
  primaryBtnFlex: { flex: 1, paddingHorizontal: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, height: 52,
    paddingHorizontal: spacing.xl,
    alignItems: "center", justifyContent: "center",
    minWidth: 100,
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "800", fontSize: 15 },
  errorText: { color: colors.error, fontSize: 14, textAlign: "center", marginTop: 4, fontWeight: "600" },

  slotHighlight: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.brand + "1F", borderWidth: 1, borderColor: colors.brand + "66",
    borderRadius: 16,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    marginBottom: spacing.xs,
  },
  slotHighlightLabel: { fontSize: 10, color: colors.accentText, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: "800" },
  slotHighlightValue: { fontSize: 16, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  resultIcon: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  resultTitle: { fontFamily: fonts.display, fontSize: 20, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  resultSub: { fontSize: 15, color: colors.soft, textAlign: "center" },

  // Success (full screen)
  successScreen: { flex: 1, backgroundColor: colors.surface },
  successBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 10 },
  successIcon: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: colors.lime,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.lg,
    shadowColor: colors.lime, shadowOpacity: 0.55, shadowRadius: 34, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  successTitle: { fontFamily: "Unbounded_800ExtraBold", fontSize: 32, color: colors.onSurface },
  attendeeName: { fontFamily: "Unbounded_700Bold", fontSize: 18, color: colors.onSurface, textAlign: "center" },
  successSub: { fontFamily: "Manrope_600SemiBold", fontSize: 14, color: colors.muted, textAlign: "center" },
  slotSuccessBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    marginTop: spacing.sm,
  },
  slotSuccessText: { fontSize: 13, color: colors.onSurface, fontWeight: "800" },
  checkedTag: {
    marginTop: spacing.md, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.lime + "24",
  },
  checkedTagText: { color: colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
});