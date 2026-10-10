import { useEffect, useState, useMemo, useCallback } from "react";
import { View, StyleSheet, ScrollView, Modal, Alert } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { softPop } from "@/src/ui/motion";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/src/api";
import EventMap from "@/src/EventMap";
import { spacing, shadows, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { eventDateRange } from "@/src/utils/eventDate";
import { ticketTypeLabel, ticketTypeValue } from "@/src/utils/ticketLabel";
import { startsInLabel } from "@/src/utils/countdown";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { PressableScale } from "@/src/ui/PressableScale";
import { Button } from "@/src/ui/Button";
import { Tag } from "@/src/ui/Tag";
import { Skeleton } from "@/src/ui/Skeleton";
import { EmptyState } from "@/src/ui/EmptyState";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function hoursUntil(iso: string): number {
  const d = new Date(iso).getTime();
  return (d - Date.now()) / 3_600_000;
}

const CANCEL_CUTOFF_HOURS = 2;

export default function TicketScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    // Reset while fetching so we don't flash the previous ticket's data
    // (source of "wrong booking type" symptom when navigating tickets).
    setBooking(null);
    setLoading(true);
    try {
      const list = await api.myBookings();
      const found = list.find((b: any) => b.id === String(id));
      setBooking(found);
    } catch (e) {
      console.log("ticket load err", e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const performCancel = async () => {
    if (!booking) return;
    setCancelling(true);
    try {
      const res = await api.cancelBooking(booking.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmOpen(false);
      await load();
      const refundStatus = res?.refund?.status;
      if (refundStatus === "refund_pending") {
        Alert.alert(
          "Booking cancelled",
          `Refund of ₹${Number(res.refund.amount_inr ?? booking.total_price).toFixed(0)} initiated to your original payment method. It typically reflects in 5-7 business days.`
        );
      } else if (refundStatus === "refund_failed") {
        Alert.alert(
          "Cancelled — refund pending manual review",
          "We couldn't process the refund automatically. Our team will process it within 24 hours."
        );
      } else {
        Alert.alert("Booking cancelled", res?.message || "Your booking has been cancelled.");
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't cancel", e?.message || "Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ padding: 20, gap: 16 }}>
          <Skeleton width={44} height={44} radius={14} />
          <Skeleton height={520} radius={24} />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking || !booking.event) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="ticket-outline" title="Ticket not found." actionLabel="Go back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const e = booking.event;
  const qrPayload = JSON.stringify({ t: "gs-ticket", id: booking.id });
  const isTimeSlot = !!booking.time_slot;
  const hasSeats = !!(booking.seats && booking.seats.length);
  // Priority lives in one place — @/src/utils/ticketLabel.
  const primaryLabel = ticketTypeLabel(booking);
  const seatLine = ticketTypeValue(booking);

  const isCancelled = booking.status === "cancelled";
  const isPaidOnline = booking.payment_status === "paid";
  const isRefundPending = booking.payment_status === "refund_pending";
  const isRefundFailed = booking.payment_status === "refund_failed";
  const startIso = e.start_date || e.date;
  const hrsLeft = hoursUntil(startIso);
  const canCancel =
    !isCancelled &&
    !booking.checked_in &&
    hrsLeft > CANCEL_CUTOFF_HOURS;
  const refundAmount = Number(booking.total_price || 0);
  const countdown = !isCancelled && !booking.checked_in ? startsInLabel(startIso) : null;

  const statusTag = isCancelled
    ? <Tag label="CANCELLED" tone="bad" icon="close-circle" />
    : booking.checked_in
    ? <Tag label="CHECKED IN" tone="info" icon="checkmark-circle" />
    : isPaidOnline
    ? <Tag label="CONFIRMED · PAID ONLINE" tone="ok" icon="shield-checkmark" />
    : booking.total_price > 0
    ? <Tag label="PAY AT VENUE" tone="warn" icon="wallet" />
    : <Tag label="CONFIRMED · FREE" tone="ok" icon="checkmark-circle" />;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <GlowBackground variant="violet" />
      <View style={styles.header}>
        <PressableScale style={styles.iconBtn} onPress={() => router.back()} testID="ticket-back-btn" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </PressableScale>
        <Text style={styles.headerTitle}>My Ticket</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: spacing.lg }}>
        <Animated.View entering={FadeInDown.duration(400)} style={[styles.ticket, isCancelled && { opacity: 0.85 }]}>
          <View style={styles.heroWrap}>
            <Image source={e.image_url} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={["rgba(26,22,48,0.05)", "rgba(26,22,48,0.97)"]} style={StyleSheet.absoluteFill} />
            <View style={styles.heroContent}>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {statusTag}
                {isRefundPending && <Tag label="Refund in progress" tone="warn" icon="cash-outline" />}
              </View>
              <Text style={styles.title} numberOfLines={2}>{e.title}</Text>
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Text style={styles.smallLabel}>Date</Text>
              <Text style={styles.smallValue}>{eventDateRange(e)}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.smallLabel}>{primaryLabel}</Text>
              <Text style={styles.smallValue}>{seatLine}</Text>
            </View>
            {isTimeSlot && (
              <View style={styles.gridCell} testID="ticket-slot-banner">
                <Text style={styles.smallLabel}>Your time slot</Text>
                <Text style={styles.smallValue} numberOfLines={2}>
                  {booking.time_slot}
                  {(hasSeats && booking.seats.length >= 1) || (booking.num_seats && booking.num_seats > 1)
                    ? ` · ${hasSeats ? booking.seats.length : booking.num_seats} people`
                    : ""}
                </Text>
              </View>
            )}
            <View style={styles.gridCell}>
              <Text style={styles.smallLabel}>Venue</Text>
              <Text style={styles.smallValue} numberOfLines={2}>{e.location_name}</Text>
            </View>
          </View>

          {/* tear line */}
          <View style={styles.tear}>
            <View style={styles.tearDash} />
            <View style={[styles.tearNotch, { left: -12 }]} />
            <View style={[styles.tearNotch, { right: -12 }]} />
          </View>

          {/* Show the QR only for live tickets, not for cancelled ones. */}
          {!isCancelled ? (
            <Animated.View entering={softPop(150)} style={styles.qrWrap}>
              <View style={styles.qrBox}>
                <QRCode value={qrPayload} size={184} color="#14061D" backgroundColor="#FFFFFF" />
              </View>
              <Text style={styles.qrHint}>Show this QR at the entrance</Text>
              <Text style={styles.bookingId} testID="ticket-id">ID · {booking.id.slice(0, 8).toUpperCase()}</Text>
              {countdown ? <Tag label={countdown} tone="pink" icon="time" style={{ alignSelf: "center", marginTop: 4 }} /> : null}
            </Animated.View>
          ) : (
            <View style={styles.qrWrap}>
              <View style={styles.qrCancelled}>
                <Ionicons name="ban-outline" size={72} color={colors.error} />
                <Text style={styles.qrCancelledLabel}>Ticket cancelled</Text>
              </View>
              {booking.cancelled_at && (
                <Text style={styles.bookingId}>Cancelled · {fmtDate(booking.cancelled_at)}</Text>
              )}
            </View>
          )}

          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              {booking.platform_fee_inr > 0 ? (
                <Text style={styles.feeHint}>incl. ₹{Number(booking.platform_fee_inr).toFixed(0)} platform fee</Text>
              ) : booking.platform_fee_waived ? (
                <Text style={[styles.feeHint, { color: colors.success }]}>Platform fee waived</Text>
              ) : null}
            </View>
            <Text style={styles.footerLabel}>Total</Text>
            <Text style={styles.priceValue}>
              {(booking.grand_total_inr ?? booking.total_price) > 0
                ? `₹${Number(booking.grand_total_inr ?? booking.total_price).toFixed(0)}`
                : "Free"}
            </Text>
          </View>
        </Animated.View>

        {/* Refund state cards */}
        {isRefundPending && booking.refund && (
          <View style={[styles.noticeCard, { borderColor: colors.warning + "66", backgroundColor: colors.warning + "1A" }]}>
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.noticeTitle, { color: colors.warning }]}>Refund initiated</Text>
              <Text style={styles.noticeBody}>
                ₹{Number(booking.refund.amount_inr ?? refundAmount).toFixed(0)} will be credited to your original payment method within 5-7 business days.
              </Text>
              {booking.refund.id && <Text style={styles.noticeRef}>Ref: {booking.refund.id}</Text>}
            </View>
          </View>
        )}
        {isRefundFailed && (
          <View style={[styles.noticeCard, { borderColor: colors.error + "66", backgroundColor: colors.error + "1A" }]}>
            <Ionicons name="warning-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.noticeTitle, { color: colors.error }]}>Refund needs manual review</Text>
              <Text style={styles.noticeBody}>
                We couldn&apos;t process the refund automatically. Our team will get it done within 24 hours.
              </Text>
            </View>
          </View>
        )}

        {/* Live-ticket notices */}
        {!isCancelled && booking.total_price > 0 && !booking.checked_in && booking.payment_status !== "paid" && (
          <View style={[styles.noticeCard, { borderColor: colors.warning + "66", backgroundColor: colors.warning + "1A" }]}>
            <Ionicons name="wallet-outline" size={18} color={colors.warning} />
            <Text style={[styles.noticeBody, { flex: 1, color: colors.onSurface, fontWeight: "700" }]}>
              Pay ₹{Number(booking.grand_total_inr ?? booking.total_price).toFixed(0)} at the venue when scanned
            </Text>
          </View>
        )}
        {!isCancelled && isPaidOnline && (
          <View style={[styles.noticeCard, { borderColor: colors.success + "55", backgroundColor: colors.success + "14" }]}>
            <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            <Text style={[styles.noticeBody, { flex: 1, color: colors.onSurface, fontWeight: "700" }]}>
              Paid online · No payment needed at venue
            </Text>
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.sectionTitle}>Venue</Text>
          <EventMap latitude={e.latitude} longitude={e.longitude} label={e.location_name} height={160} />
        </View>

        {/* Cancel CTA */}
        {canCancel && (
          <View style={{ gap: 6 }}>
            <Button title="Cancel booking" variant="danger" icon="close-circle-outline" onPress={() => setConfirmOpen(true)} testID="cancel-booking-btn" />
            <Text style={styles.cancelHint}>Free cancellation until {CANCEL_CUTOFF_HOURS} hours before start</Text>
          </View>
        )}
        {!canCancel && !isCancelled && !booking.checked_in && hrsLeft <= CANCEL_CUTOFF_HOURS && hrsLeft > 0 && (
          <View style={styles.cancelClosed}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
            <Text style={styles.cancelHint}>Cancellations closed within {CANCEL_CUTOFF_HOURS}h of start</Text>
          </View>
        )}
      </ScrollView>

      {/* Confirmation sheet */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Animated.View entering={softPop()} style={styles.modalCard} testID="cancel-confirm-modal">
            <View style={styles.modalIconWrap}>
              <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
            </View>
            <Text style={styles.modalTitle}>Cancel this booking?</Text>
            <Text style={styles.modalBody}>
              {isPaidOnline
                ? `You paid ₹${refundAmount.toFixed(0)} for this ticket. If you cancel now, we'll refund the full amount to your original payment method within 5-7 business days.`
                : booking.total_price > 0
                ? `This ticket was reserved as pay-at-venue. Cancelling will free the seat/slot for other users; no money changes hands.`
                : `This is a free booking. Cancelling frees the seat for others.`}
            </Text>
            <View style={styles.modalActions}>
              <Button
                title="Keep ticket"
                variant="ghost"
                onPress={() => setConfirmOpen(false)}
                testID="cancel-keep-btn"
                disabled={cancelling}
                style={{ flex: 1 }}
              />
              <Button
                title="Yes, cancel"
                onPress={performCancel}
                testID="cancel-confirm-btn"
                loading={cancelling}
                style={{ flex: 1, backgroundColor: colors.error, shadowOpacity: 0 }}
              />
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.onSurface },

  ticket: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 24,
    borderWidth: 1, borderColor: colors.border,
    ...shadows.glow,
  },
  heroWrap: { height: 150, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  heroContent: { position: "absolute", left: 16, right: 16, bottom: 12, gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", color: "#FFFFFF", lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 16, rowGap: 14 },
  gridCell: { width: "50%", paddingRight: 8, gap: 3 },
  smallLabel: { fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },
  smallValue: { fontSize: 13, color: colors.onSurface, fontWeight: "800" },
  tear: { height: 24, justifyContent: "center" },
  tearDash: { marginHorizontal: 20, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.border },
  tearNotch: {
    position: "absolute", top: 0, width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  qrWrap: { alignItems: "center", paddingVertical: 14, gap: 6 },
  qrBox: { padding: 14, backgroundColor: "#FFFFFF", borderRadius: 18 },
  qrHint: { fontSize: 13, color: colors.soft, fontWeight: "700", marginTop: 6 },
  bookingId: { fontSize: 12, color: colors.muted, fontWeight: "700", letterSpacing: 1.5 },
  qrCancelled: {
    alignItems: "center", justifyContent: "center",
    width: 212, height: 212, borderRadius: 18,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.error + "88",
  },
  qrCancelledLabel: { marginTop: spacing.sm, fontSize: 14, color: colors.error, fontWeight: "800" },
  footer: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.sheet,
    borderTopWidth: 1, borderColor: colors.border,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  footerLabel: { fontSize: 12, color: colors.muted },
  priceValue: { fontFamily: fonts.display, fontSize: 17, color: colors.onSurface, fontWeight: "800" },
  feeHint: { fontSize: 12, color: colors.muted, fontWeight: "700" },

  noticeCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: spacing.md, borderRadius: 16, borderWidth: 1,
  },
  noticeTitle: { fontSize: 14, fontWeight: "800", marginBottom: 2 },
  noticeBody: { fontSize: 13, color: colors.soft, lineHeight: 19 },
  noticeRef: { fontSize: 11, color: colors.muted, fontWeight: "700", marginTop: 4 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  cancelHint: { color: colors.muted, fontSize: 12, textAlign: "center" },
  cancelClosed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },

  modalBackdrop: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.sheet,
    borderRadius: 24, borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl,
    alignItems: "center",
  },
  modalIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.error + "26",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  modalBody: { marginTop: spacing.sm, fontSize: 14, color: colors.soft, textAlign: "center", lineHeight: 20 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: spacing.xl, width: "100%" },
});
