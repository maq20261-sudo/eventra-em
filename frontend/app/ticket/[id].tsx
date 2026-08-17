import { useEffect, useState, useMemo, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, Alert,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/src/api";
import EventMap from "@/src/EventMap";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { eventDateRange } from "@/src/utils/eventDate";
import { ticketTypeLabel, ticketTypeValue } from "@/src/utils/ticketLabel";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!booking || !booking.event) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ padding: spacing.xl, color: colors.onSurface }}>Ticket not found.</Text>
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
  const hrsLeft = hoursUntil(e.start_date || e.date);
  const canCancel =
    !isCancelled &&
    !booking.checked_in &&
    hrsLeft > CANCEL_CUTOFF_HOURS;
  const refundAmount = Number(booking.total_price || 0);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="ticket-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My Ticket</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        <View style={[styles.card, isCancelled && styles.cardCancelled]}>
          <Image source={e.image_url} style={styles.hero} contentFit="cover" />
          <View style={styles.cardBody}>
            <View style={styles.catRow}>
              <View style={styles.catBadge}>
                <Text style={styles.catText}>{e.category}</Text>
              </View>
              {booking.checked_in && (
                <View style={styles.checkedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.checkedText}>Checked In</Text>
                </View>
              )}
              {isCancelled && (
                <View style={styles.cancelBadge}>
                  <Ionicons name="close-circle" size={12} color={colors.error} />
                  <Text style={styles.cancelText}>Cancelled</Text>
                </View>
              )}
              {isRefundPending && (
                <View style={styles.refundBadge}>
                  <Ionicons name="cash-outline" size={12} color="#92400E" />
                  <Text style={styles.refundBadgeText}>Refund in progress</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>{e.title}</Text>

            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.muted} />
              <Text style={styles.metaText}>{eventDateRange(e)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={14} color={colors.muted} />
              <Text style={styles.metaText}>{e.location_name}</Text>
            </View>

            {isTimeSlot && (
              <View style={styles.slotHighlight} testID="ticket-slot-banner">
                <View style={styles.slotHighlightIcon}>
                  <Ionicons name="time" size={18} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.slotHighlightLabel}>Your time slot</Text>
                  <Text style={styles.slotHighlightValue} numberOfLines={1}>
                    {booking.time_slot}
                  </Text>
                </View>
                {(hasSeats && booking.seats.length >= 1) || (booking.num_seats && booking.num_seats > 1) ? (
                  <View style={styles.slotSeatsBadge}>
                    <Ionicons name="people" size={12} color={colors.onBrandPrimary} />
                    <Text style={styles.slotSeatsText}>
                      {hasSeats ? booking.seats.length : booking.num_seats}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.dashRow}>
              {Array.from({ length: 24 }).map((_, i) => <View key={i} style={styles.dash} />)}
            </View>

            <View style={styles.detailsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>{primaryLabel}</Text>
                <Text style={styles.smallValue}>{seatLine}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.smallLabel}>Total</Text>
                <Text style={styles.priceValue}>
                  {booking.total_price > 0 ? `₹${booking.total_price.toFixed(0)}` : "Free"}
                </Text>
              </View>
            </View>

            {/* Show the QR only for live tickets, not for cancelled ones. */}
            {!isCancelled && (
              <View style={styles.qrWrap}>
                <View style={styles.qrBox}>
                  <QRCode
                    value={qrPayload}
                    size={200}
                    color={colors.onSurface}
                    backgroundColor={colors.surfaceSecondary}
                  />
                </View>
                <Text style={styles.qrHint}>Show this QR at the entrance</Text>
                <Text style={styles.bookingId} testID="ticket-id">ID · {booking.id.slice(0, 8).toUpperCase()}</Text>
              </View>
            )}
            {isCancelled && (
              <View style={styles.qrWrap}>
                <View style={[styles.qrBox, styles.qrBoxCancelled]}>
                  <Ionicons name="ban-outline" size={80} color={colors.error} />
                  <Text style={styles.qrCancelledLabel}>Ticket cancelled</Text>
                </View>
                {booking.cancelled_at && (
                  <Text style={styles.bookingId}>
                    Cancelled · {fmtDate(booking.cancelled_at)}
                  </Text>
                )}
              </View>
            )}

            {/* Refund state cards */}
            {isRefundPending && booking.refund && (
              <View style={styles.refundCard}>
                <Ionicons name="time-outline" size={20} color="#92400E" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.refundTitle}>Refund initiated</Text>
                  <Text style={styles.refundBody}>
                    ₹{Number(booking.refund.amount_inr ?? refundAmount).toFixed(0)} will be credited to your original payment method within 5-7 business days.
                  </Text>
                  {booking.refund.id && (
                    <Text style={styles.refundRef}>Ref: {booking.refund.id}</Text>
                  )}
                </View>
              </View>
            )}
            {isRefundFailed && (
              <View style={styles.refundFailedCard}>
                <Ionicons name="warning-outline" size={20} color={colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.refundFailedTitle}>Refund needs manual review</Text>
                  <Text style={styles.refundFailedBody}>
                    We couldn&apos;t process the refund automatically. Our team will get it done within 24 hours.
                  </Text>
                </View>
              </View>
            )}

            {/* Live-ticket notices */}
            {!isCancelled && booking.total_price > 0 && !booking.checked_in && booking.payment_status !== "paid" && (
              <View style={styles.notice}>
                <Ionicons name="wallet-outline" size={16} color={colors.warning} />
                <Text style={styles.noticeText}>
                  Pay ₹{booking.total_price.toFixed(0)} at the venue when scanned
                </Text>
              </View>
            )}
            {!isCancelled && isPaidOnline && (
              <View style={styles.paidNotice}>
                <Ionicons name="shield-checkmark" size={16} color={colors.brand} />
                <Text style={styles.paidNoticeText}>
                  Paid online · No payment needed at venue
                </Text>
              </View>
            )}

            <View style={styles.venueBlock}>
              <Text style={styles.venueTitle}>Venue</Text>
              <EventMap
                latitude={e.latitude}
                longitude={e.longitude}
                label={e.location_name}
                height={160}
              />
            </View>

            {/* Cancel CTA */}
            {canCancel && (
              <Pressable
                testID="cancel-booking-btn"
                onPress={() => setConfirmOpen(true)}
                style={styles.cancelBookingBtn}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text style={styles.cancelBookingText}>Cancel booking</Text>
              </Pressable>
            )}
            {!canCancel && !isCancelled && !booking.checked_in && hrsLeft <= CANCEL_CUTOFF_HOURS && hrsLeft > 0 && (
              <View style={styles.cancelClosed}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
                <Text style={styles.cancelClosedText}>
                  Cancellations closed within {CANCEL_CUTOFF_HOURS}h of start
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Confirmation modal */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="cancel-confirm-modal">
            <View style={styles.modalIconWrap}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
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
              <Pressable
                onPress={() => setConfirmOpen(false)}
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                testID="cancel-keep-btn"
                disabled={cancelling}
              >
                <Text style={styles.modalBtnSecondaryText}>Keep ticket</Text>
              </Pressable>
              <Pressable
                onPress={performCancel}
                style={[styles.modalBtn, styles.modalBtnDanger, cancelling && { opacity: 0.6 }]}
                testID="cancel-confirm-btn"
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Yes, cancel</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface },

  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  cardCancelled: { opacity: 0.9 },
  hero: { width: "100%", height: 180, backgroundColor: colors.surfaceTertiary },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  catBadge: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  catText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: "600" },
  checkedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  checkedText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "600" },
  cancelBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  cancelText: { fontSize: 11, color: colors.error, fontWeight: "600" },
  refundBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  refundBadgeText: { fontSize: 11, color: "#92400E", fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, color: colors.muted },

  dashRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: spacing.md },
  dash: { width: 6, height: 1, backgroundColor: colors.borderStrong },

  slotHighlight: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    marginTop: spacing.md,
  },
  slotHighlightIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  slotHighlightLabel: {
    fontSize: 11, color: colors.onBrandPrimary, opacity: 0.85,
    letterSpacing: 0.5, textTransform: "uppercase", fontWeight: "600",
  },
  slotHighlightValue: {
    fontSize: 17, color: colors.onBrandPrimary, fontWeight: "700", marginTop: 2,
  },
  slotSeatsBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  slotSeatsText: { fontSize: 13, color: colors.onBrandPrimary, fontWeight: "700" },

  detailsRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  smallLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  smallValue: { fontSize: 15, color: colors.onSurface, fontWeight: "500", marginTop: 2 },
  priceValue: { fontSize: 20, color: colors.brand, fontWeight: "700", marginTop: 2 },

  qrWrap: { alignItems: "center", marginTop: spacing.lg, gap: 6 },
  qrBox: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  qrBoxCancelled: {
    alignItems: "center", justifyContent: "center",
    width: 240, height: 240,
    backgroundColor: colors.surfaceTertiary,
    borderStyle: "dashed",
  },
  qrCancelledLabel: { marginTop: spacing.sm, fontSize: 14, color: colors.error, fontWeight: "600" },
  qrHint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  bookingId: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: "600", letterSpacing: 1 },

  refundCard: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#FEF3C7",
    padding: spacing.md, borderRadius: radius.md,
    borderLeftWidth: 4, borderLeftColor: "#F59E0B",
  },
  refundTitle: { fontSize: 14, fontWeight: "700", color: "#92400E", marginBottom: 2 },
  refundBody: { fontSize: 13, color: "#92400E", lineHeight: 18 },
  refundRef: { fontSize: 11, color: "#92400E", fontWeight: "600", marginTop: 4, opacity: 0.75 },
  refundFailedCard: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#FEE2E2",
    padding: spacing.md, borderRadius: radius.md,
    borderLeftWidth: 4, borderLeftColor: colors.error,
  },
  refundFailedTitle: { fontSize: 14, fontWeight: "700", color: colors.error, marginBottom: 2 },
  refundFailedBody: { fontSize: 13, color: colors.error, lineHeight: 18 },

  notice: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF3C7",
    padding: spacing.md, borderRadius: radius.md,
  },
  noticeText: { fontSize: 13, color: "#92400E", flex: 1, fontWeight: "500" },
  paidNotice: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: radius.md,
  },
  paidNoticeText: { fontSize: 13, color: colors.onBrandTertiary, flex: 1, fontWeight: "500" },
  venueBlock: { marginTop: spacing.lg, gap: spacing.sm },
  venueTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },

  cancelBookingBtn: {
    marginTop: spacing.lg,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: "#FEF2F2",
    borderWidth: 1, borderColor: "#FCA5A5",
  },
  cancelBookingText: { color: colors.error, fontSize: 15, fontWeight: "600" },
  cancelClosed: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  cancelClosedText: { color: colors.muted, fontSize: 12 },

  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    ...shadows.card,
  },
  modalIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#FEE2E2",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  modalBody: {
    marginTop: spacing.sm,
    fontSize: 14, color: colors.muted,
    textAlign: "center", lineHeight: 20,
  },
  modalActions: {
    flexDirection: "row", gap: 12, marginTop: spacing.xl, width: "100%",
  },
  modalBtn: {
    flex: 1, paddingVertical: 14, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnSecondary: { backgroundColor: colors.surfaceTertiary },
  modalBtnSecondaryText: { color: colors.onSurface, fontWeight: "600" },
  modalBtnDanger: { backgroundColor: colors.error },
  modalBtnDangerText: { color: "#fff", fontWeight: "700" },
});
