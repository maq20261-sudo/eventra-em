import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import RazorpayCheckout, { RzpOrder } from "@/src/RazorpayCheckout";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { useQuota } from "@/src/hooks/usePricing";
import { useAuth } from "@/src/AuthContext";

const SEAT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export default function Booking() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { quota, refresh: refreshQuota } = useQuota(!!user);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [booked, setBooked] = useState<{ booked_seats: string[]; booked_slots: string[]; total_general_booked: number }>({
    booked_seats: [], booked_slots: [], total_general_booked: 0,
  });

  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [numSeats, setNumSeats] = useState(1);
  const [slot, setSlot] = useState<string | null>(null);
  // Group booking size for time_slot events (defaults to 1 for back-compat).
  const [slotSeats, setSlotSeats] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [rzpOrder, setRzpOrder] = useState<RzpOrder | null>(null);
  const [rzpVisible, setRzpVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"online" | "venue">("online");
  const [gatewayConfigured, setGatewayConfigured] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [e, b] = await Promise.all([api.getEvent(String(id)), api.bookedSeats(String(id))]);
        setEvent(e);
        setBooked(b);
        // Determine payment gateway availability so we can hide the online option gracefully
        try {
          const cfg = await api.paymentConfig();
          const configured = !!cfg?.configured;
          setGatewayConfigured(configured);
          if (!configured) setPaymentMethod("venue");
        } catch {
          setGatewayConfigured(false);
          setPaymentMethod("venue");
        }
      } catch (err) {
        console.log("Booking load error", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Whether this event is a seat_map with time slots (Task 3).
  const isSeatMapWithSlots = useMemo(
    () => !!event && event.booking_type === "seat_map" && Array.isArray(event.time_slots) && event.time_slots.length > 0,
    [event],
  );

  // For seat_map+slots, once the user picks a slot, refresh booked seats
  // filtered by that slot so we render the map correctly.
  useEffect(() => {
    if (!isSeatMapWithSlots || !slot) return;
    (async () => {
      try {
        const b = await api.bookedSeats(String(id), slot);
        setBooked(b);
        setSelectedSeats([]);
      } catch (err) { console.log("Slot seats err", err); }
    })();
  }, [slot, id, isSeatMapWithSlots]);

  const slotsInfo: Array<{ time: string; capacity: number; booked: number; remaining: number; sold_out: boolean }> = useMemo(() => {
    if (!event) return [];
    if (Array.isArray(event.slots_info)) return event.slots_info;
    // Fallback for legacy responses without slots_info: synthesize from time_slots.
    return (event.time_slots || []).map((t: string) => ({
      time: t, capacity: event.slot_capacity || 1, booked: 0,
      remaining: event.slot_capacity || 1, sold_out: booked.booked_slots.includes(t),
    }));
  }, [event, booked]);

  const currentSlotInfo = useMemo(
    () => slotsInfo.find((s) => s.time === slot) || null,
    [slotsInfo, slot],
  );

  // Clamp slotSeats to the remaining seats of the picked slot.
  useEffect(() => {
    if (currentSlotInfo && slotSeats > currentSlotInfo.remaining) {
      setSlotSeats(Math.max(1, currentSlotInfo.remaining));
    }
  }, [currentSlotInfo?.remaining]);

  const totalPrice = useMemo(() => {
    if (!event) return 0;
    if (event.booking_type === "seat_map") return event.price * selectedSeats.length;
    if (event.booking_type === "general") return event.price * numSeats;
    if (event.booking_type === "time_slot") return event.price * Math.max(1, slotSeats);
    return event.price;
  }, [event, selectedSeats, numSeats, slotSeats]);

  // Attendee platform fee (₹9) — waived while the user still has free
  // bookings in their perk. Free events never incur a fee.
  const platformFee = useMemo(() => {
    if (!event || totalPrice <= 0) return 0;
    const remaining = quota?.attendee?.free_bookings_remaining ?? 0;
    if (remaining > 0) return 0;
    return quota?.attendee?.platform_fee_inr ?? 9;
  }, [event, totalPrice, quota]);

  const feeWaived = totalPrice > 0 && platformFee === 0;
  const grandTotal = totalPrice + platformFee;

  const canProceed = useMemo(() => {
    if (!event) return false;
    if (event.booking_type === "seat_map") {
      if (isSeatMapWithSlots && !slot) return false;
      return selectedSeats.length > 0;
    }
    if (event.booking_type === "general") return numSeats > 0;
    if (event.booking_type === "time_slot") {
      if (!slot) return false;
      if (!currentSlotInfo) return true;
      return slotSeats > 0 && slotSeats <= currentSlotInfo.remaining && !currentSlotInfo.sold_out;
    }
    return false;
  }, [event, selectedSeats, numSeats, slot, slotSeats, currentSlotInfo, isSeatMapWithSlots]);

  const toggleSeat = (seat: string) => {
    if (booked.booked_seats.includes(seat)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedSeats((prev) => prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]);
  };

  const confirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const wantsOnline = event.price > 0 && totalPrice > 0 && paymentMethod === "online";

      if (wantsOnline) {
        try {
          const order = await api.createPaymentOrder({
            kind: "booking",
            event_id: String(id),
            seats: event.booking_type === "seat_map" ? selectedSeats : undefined,
            num_seats:
              event.booking_type === "general" ? numSeats
              : event.booking_type === "time_slot" ? slotSeats
              : undefined,
            time_slot:
              event.booking_type === "time_slot" ? slot
              : (isSeatMapWithSlots ? slot : undefined),
          });
          setRzpOrder(order as any);
          setRzpVisible(true);
          setSubmitting(false);
          return;
        } catch (payErr: any) {
          const msg = payErr?.message || "";
          if (msg.includes("not configured") || msg.includes("503")) {
            // Gateway went down mid-session — fall back gracefully
            setGatewayConfigured(false);
            setPaymentMethod("venue");
          } else {
            setError(msg);
            setSubmitting(false);
            return;
          }
        }
      }

      // Pay-at-venue path (or free event)
      const body: any = { event_id: String(id) };
      if (event.booking_type === "seat_map") {
        body.seats = selectedSeats;
        if (isSeatMapWithSlots) body.time_slot = slot;
      }
      if (event.booking_type === "general") body.num_seats = numSeats;
      if (event.booking_type === "time_slot") {
        body.time_slot = slot;
        if (slotSeats > 1) body.num_seats = slotSeats;
      }
      const res = await api.createBooking(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(res);
      refreshQuota();
    } catch (e: any) {
      setError(e?.message || "Booking failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = async (payload: any) => {
    setRzpVisible(false);
    setSubmitting(true);
    try {
      const res = await api.verifyPayment(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(res.result.booking);
    } catch (e: any) {
      setError(e?.message || "Payment verification failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
      setRzpOrder(null);
    }
  };

  if (loading || !event) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="booking-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{event.title}</Text>
          <Text style={styles.headerSub}>
            {event.booking_type === "seat_map"
              ? (isSeatMapWithSlots && !slot ? "Pick a showing" : "Select your seats")
              : event.booking_type === "general" ? "Choose tickets" : "Pick a time slot"}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {event.booking_type === "seat_map" && isSeatMapWithSlots && (
          <TimeSlots
            slotsInfo={slotsInfo}
            takenSlots={booked.booked_slots}
            value={slot}
            onSelect={(s) => { Haptics.selectionAsync(); setSlot(s); }}
            styles={styles}
            colors={colors}
          />
        )}

        {event.booking_type === "seat_map" && (!isSeatMapWithSlots || slot) && (
          <View style={{ marginTop: isSeatMapWithSlots ? spacing.xl : 0 }}>
            {isSeatMapWithSlots && (
              <View style={styles.slotHeader}>
                <Ionicons name="time" size={14} color={colors.brand} />
                <Text style={styles.slotHeaderText}>Showing: <Text style={styles.slotHeaderStrong}>{slot}</Text></Text>
              </View>
            )}
            <SeatMap
              rows={event.seat_rows || 6}
              cols={event.seat_cols || 8}
              booked={booked.booked_seats}
              selected={selectedSeats}
              onToggle={toggleSeat}
              styles={styles}
              colors={colors}
            />
          </View>
        )}

        {event.booking_type === "general" && (
          <GeneralPicker
            total={event.total_seats || 100}
            takenGeneral={booked.total_general_booked}
            value={numSeats}
            onChange={setNumSeats}
            styles={styles}
            colors={colors}
          />
        )}

        {event.booking_type === "time_slot" && (
          <TimeSlots
            slotsInfo={slotsInfo}
            takenSlots={booked.booked_slots}
            value={slot}
            onSelect={(s) => { Haptics.selectionAsync(); setSlot(s); setSlotSeats(1); }}
            styles={styles}
            colors={colors}
          />
        )}

        {event.booking_type === "time_slot" && slot && currentSlotInfo && !currentSlotInfo.sold_out && currentSlotInfo.capacity > 1 && (
          <View style={styles.slotStepperWrap}>
            <Text style={styles.generalLabel}>How many seats?</Text>
            <View style={styles.stepperRow}>
              <Pressable
                testID="slot-dec-btn"
                style={styles.stepBtn}
                onPress={() => { if (slotSeats > 1) { Haptics.selectionAsync(); setSlotSeats(slotSeats - 1); } }}
              >
                <Ionicons name="remove" size={22} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.stepValue} testID="slot-seats-count">{slotSeats}</Text>
              <Pressable
                testID="slot-inc-btn"
                style={styles.stepBtn}
                onPress={() => {
                  if (slotSeats < currentSlotInfo.remaining) {
                    Haptics.selectionAsync();
                    setSlotSeats(slotSeats + 1);
                  }
                }}
              >
                <Ionicons name="add" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.slotStepperHint}>
              {currentSlotInfo.remaining} of {currentSlotInfo.capacity} seat{currentSlotInfo.capacity === 1 ? "" : "s"} available
            </Text>
          </View>
        )}

        {event.price > 0 && totalPrice > 0 && (
          <View style={styles.breakdownCard} testID="fee-breakdown">
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Ticket subtotal</Text>
              <Text style={styles.breakdownValue}>₹{totalPrice.toFixed(0)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                <Text style={styles.breakdownLabel}>Platform fee</Text>
                {feeWaived && (
                  <View style={styles.freeChip}>
                    <Ionicons name="gift-outline" size={11} color="#0F766E" />
                    <Text style={styles.freeChipText}>FREE</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.breakdownValue, feeWaived && styles.strikePrice]}>
                ₹{(quota?.attendee?.platform_fee_inr ?? 9).toFixed(0)}
              </Text>
            </View>
            {feeWaived && quota?.attendee && (
              <Text style={styles.freeHint}>
                🎉 {quota.attendee.free_bookings_remaining} of {quota.attendee.free_booking_limit} free
                booking{quota.attendee.free_bookings_remaining === 1 ? "" : "s"} left
              </Text>
            )}
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownTotalLabel}>Total</Text>
              <Text style={styles.breakdownTotalValue}>₹{grandTotal.toFixed(0)}</Text>
            </View>
          </View>
        )}

        {event.price > 0 && totalPrice > 0 && (
          <View style={styles.payMethodBlock}>
            <Text style={styles.payMethodTitle}>Payment method</Text>
            <PayMethodOption
              testID="pay-method-online"
              active={paymentMethod === "online"}
              disabled={!gatewayConfigured}
              icon="card"
              title="Pay online"
              subtitle={gatewayConfigured ? "Secure checkout via Razorpay · instant confirmation" : "Payment gateway unavailable"}
              onPress={() => { Haptics.selectionAsync(); setPaymentMethod("online"); }}
              styles={styles}
              colors={colors}
            />
            <PayMethodOption
              testID="pay-method-venue"
              active={paymentMethod === "venue"}
              icon="cash-outline"
              title="Pay at venue"
              subtitle="Reserve now · pay when you arrive"
              onPress={() => { Haptics.selectionAsync(); setPaymentMethod("venue"); }}
              styles={styles}
              colors={colors}
            />
          </View>
        )}

        {error && <Text style={styles.error} testID="booking-error">{error}</Text>}
      </ScrollView>

      <View style={styles.stickyBar}>
        <View style={styles.stickyInner}>
          <View>
            <Text style={styles.stickyLabel}>Total</Text>
            <Text style={styles.stickyPrice}>
              {grandTotal > 0 ? `₹${grandTotal.toFixed(0)}` : "Free"}
            </Text>
          </View>
          <Pressable
            style={[styles.cta, !canProceed && styles.ctaDisabled]}
            disabled={!canProceed || submitting}
            onPress={confirm}
            testID="confirm-booking-btn"
          >
            {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Text style={styles.ctaText}>
                  {totalPrice > 0
                    ? (paymentMethod === "online" ? "Pay & Confirm" : "Reserve · Pay at Venue")
                    : "Confirm Booking"}
                </Text>
                <Ionicons
                  name={totalPrice > 0 && paymentMethod === "online" ? "card" : "checkmark-circle"}
                  size={18}
                  color={colors.onBrandPrimary}
                />
              </>
            )}
          </Pressable>
        </View>
      </View>

      <Modal visible={!!success} transparent animationType="fade">
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={40} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.successTitle}>Booking Confirmed!</Text>
            <Text style={styles.successSub}>Your ticket for {event.title}</Text>
            {/* Full breakdown so the attendee sees the ₹9 platform fee they paid
                (or that was waived under their first-5-free perk). */}
            {(success?.grand_total_inr ?? 0) > 0 && success?.platform_fee_inr > 0 ? (
              <View style={styles.successBreakdown}>
                <View style={styles.successRow}>
                  <Text style={styles.successRowLabel}>Ticket</Text>
                  <Text style={styles.successRowValue}>₹{Number(success.total_price || 0).toFixed(0)}</Text>
                </View>
                <View style={styles.successRow}>
                  <Text style={styles.successRowLabel}>Platform fee</Text>
                  <Text style={styles.successRowValue}>₹{Number(success.platform_fee_inr).toFixed(0)}</Text>
                </View>
                <View style={styles.successRowDivider} />
                <View style={styles.successRow}>
                  <Text style={styles.successRowTotal}>Total</Text>
                  <Text style={styles.successRowTotalVal}>₹{Number(success.grand_total_inr).toFixed(0)}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.successPrice}>
                {(success?.grand_total_inr ?? success?.total_price ?? totalPrice) > 0
                  ? `₹${Number(success?.grand_total_inr ?? success?.total_price ?? totalPrice).toFixed(0)}`
                  : "Free entry"}
                {success?.platform_fee_waived ? "  ·  Free-tier applied 🎉" : ""}
              </Text>
            )}
            <Pressable
              style={styles.successBtn}
              testID="view-tickets-btn"
              onPress={() => {
                if (success?.id) {
                  setSuccess(null);
                  router.replace(`/ticket/${success.id}` as any);
                } else {
                  setSuccess(null);
                  router.replace("/(consumer)/bookings" as any);
                }
              }}
            >
              <Text style={styles.successBtnText}>View my ticket</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <RazorpayCheckout
        visible={rzpVisible}
        order={rzpOrder}
        onSuccess={handlePaymentSuccess}
        onCancel={() => { setRzpVisible(false); setRzpOrder(null); }}
        onError={(msg) => { setRzpVisible(false); setError(msg); setRzpOrder(null); }}
      />
    </SafeAreaView>
  );
}

function PayMethodOption({ active, disabled, icon, title, subtitle, onPress, testID, styles, colors }: {
  active: boolean;
  disabled?: boolean;
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
  styles: any;
  colors: Colors;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.payOpt,
        active && styles.payOptActive,
        disabled && styles.payOptDisabled,
      ]}
    >
      <View style={[styles.payOptIcon, active && styles.payOptIconActive]}>
        <Ionicons name={icon} size={18} color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.payOptTitle, disabled && { color: colors.muted }]}>{title}</Text>
        <Text style={styles.payOptSub}>{subtitle}</Text>
      </View>
      <View style={[styles.payRadio, active && styles.payRadioActive]}>
        {active && <View style={styles.payRadioDot} />}
      </View>
    </Pressable>
  );
}

function SeatMap({ rows, cols, booked, selected, onToggle, styles, colors }: {
  rows: number; cols: number; booked: string[]; selected: string[]; onToggle: (s: string) => void; styles: any; colors: Colors;
}) {
  return (
    <View>
      <View style={styles.screenBar}>
        <Text style={styles.screenText}>STAGE</Text>
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1 }]} /><Text style={styles.legendText}>Available</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brandPrimary }]} /><Text style={styles.legendText}>Selected</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.surfaceTertiary }]} /><Text style={styles.legendText}>Taken</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingVertical: spacing.md }}>
          {Array.from({ length: rows }).map((_, r) => {
            const rowLetter = SEAT_LETTERS[r];
            return (
              <View key={r} style={styles.seatRow}>
                <Text style={styles.rowLabel}>{rowLetter}</Text>
                {Array.from({ length: cols }).map((_, c) => {
                  const seat = `${rowLetter}${c + 1}`;
                  const isBooked = booked.includes(seat);
                  const isSelected = selected.includes(seat);
                  return (
                    <Pressable
                      key={seat}
                      testID={`seat-${seat}`}
                      style={[
                        styles.seat,
                        isBooked && styles.seatTaken,
                        isSelected && styles.seatSelected,
                      ]}
                      onPress={() => onToggle(seat)}
                      disabled={isBooked}
                    >
                      <Text style={[
                        styles.seatText,
                        isSelected && { color: colors.onBrandPrimary },
                        isBooked && { color: colors.muted },
                      ]}>{c + 1}</Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {selected.length > 0 && (
        <Text style={styles.selectedLine}>
          Selected: {selected.join(", ")}
        </Text>
      )}
    </View>
  );
}

function GeneralPicker({ total, takenGeneral, value, onChange, styles, colors }: {
  total: number; takenGeneral: number; value: number; onChange: (n: number) => void; styles: any; colors: Colors;
}) {
  const remaining = Math.max(0, total - takenGeneral);
  const dec = () => { if (value > 1) { Haptics.selectionAsync(); onChange(value - 1); } };
  const inc = () => { if (value < remaining) { Haptics.selectionAsync(); onChange(value + 1); } };

  return (
    <View style={styles.generalWrap}>
      <View style={styles.availChip}>
        <Ionicons name="people" size={14} color={colors.onBrandTertiary} />
        <Text style={styles.availText}>{remaining} tickets available</Text>
      </View>
      <Text style={styles.generalLabel}>How many tickets?</Text>
      <View style={styles.stepperRow}>
        <Pressable style={styles.stepBtn} onPress={dec} testID="dec-seats-btn">
          <Ionicons name="remove" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.stepValue} testID="general-count">{value}</Text>
        <Pressable style={styles.stepBtn} onPress={inc} testID="inc-seats-btn">
          <Ionicons name="add" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

function TimeSlots({ slotsInfo, takenSlots, value, onSelect, styles, colors }: {
  slotsInfo: Array<{ time: string; capacity: number; booked: number; remaining: number; sold_out: boolean }>;
  takenSlots: string[]; value: string | null; onSelect: (s: string) => void; styles: any; colors: Colors;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.generalLabel}>Available time slots</Text>
      {slotsInfo.map((info) => {
        const s = info.time;
        // Trust slots_info as the source of truth. Fall back to legacy
        // takenSlots (only used if slots_info missing).
        const soldOut = info.sold_out || (info.capacity <= 1 && takenSlots.includes(s));
        const isActive = value === s;
        const remaining = info.remaining;
        const capacity = info.capacity;
        return (
          <Pressable
            key={s}
            testID={`slot-${s}`}
            style={[styles.slot, isActive && styles.slotActive, soldOut && styles.slotTaken]}
            disabled={soldOut}
            onPress={() => onSelect(s)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.slotText, isActive && { color: colors.onBrandPrimary }, soldOut && { color: colors.muted }]}>
                {s}
              </Text>
              {soldOut ? (
                <Text style={styles.slotTakenText}>Fully booked</Text>
              ) : capacity > 1 ? (
                <Text style={[styles.slotRemainingText, isActive && { color: colors.onBrandPrimary, opacity: 0.85 }]}>
                  {remaining} of {capacity} seat{capacity === 1 ? "" : "s"} left
                </Text>
              ) : null}
            </View>
            {isActive && <Ionicons name="checkmark-circle" size={20} color={colors.onBrandPrimary} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  error: {
    color: colors.error, fontSize: 14, marginTop: spacing.md,
    backgroundColor: "#FEF2F2", padding: spacing.md, borderRadius: radius.md,
  },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopColor: colors.border, borderTopWidth: 1,
    paddingBottom: 24,
    ...shadows.floating,
  },
  stickyInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg, gap: spacing.md,
  },
  stickyLabel: { fontSize: 12, color: colors.muted },
  stickyPrice: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: 2 },
  cta: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 15 },

  // Seat map
  screenBar: {
    marginHorizontal: spacing.xl,
    height: 32, borderRadius: radius.pill,
    backgroundColor: colors.onSurface,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  screenText: { color: colors.surface, fontSize: 12, letterSpacing: 2, fontWeight: "600" },
  legendRow: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, marginBottom: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.muted },
  seatRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  rowLabel: { width: 20, fontSize: 12, color: colors.muted, fontWeight: "600" },
  seat: {
    width: 32, height: 32, borderRadius: 6,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.borderStrong, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  seatSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  seatTaken: { backgroundColor: colors.surfaceTertiary, borderColor: colors.surfaceTertiary },
  seatText: { fontSize: 11, color: colors.onSurface, fontWeight: "500" },
  selectedLine: {
    marginTop: spacing.md, fontSize: 14, color: colors.brand, fontWeight: "600",
  },

  // General
  generalWrap: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  availChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  availText: { fontSize: 12, color: colors.onBrandTertiary, fontWeight: "600" },
  generalLabel: { fontSize: 16, color: colors.onSurface, fontWeight: "600", marginTop: spacing.md },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.xl, marginTop: spacing.lg },
  stepBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", ...shadows.card,
  },
  stepValue: { fontSize: 44, fontWeight: "700", color: colors.onSurface, minWidth: 80, textAlign: "center" },

  // Slots
  slot: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
  },
  slotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  slotTaken: { backgroundColor: colors.surfaceTertiary, borderColor: colors.surfaceTertiary },
  slotText: { fontSize: 15, color: colors.onSurface, fontWeight: "500" },
  slotTakenText: { fontSize: 12, color: colors.muted, marginTop: 2 },
  slotRemainingText: { fontSize: 12, color: colors.muted, marginTop: 2, fontWeight: "500" },
  slotStepperWrap: {
    alignItems: "center", padding: spacing.xl, gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg,
  },
  slotStepperHint: { fontSize: 12, color: colors.muted, marginTop: -4 },
  slotHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginBottom: spacing.md,
  },
  slotHeaderText: { fontSize: 13, color: colors.onSurface },
  slotHeaderStrong: { fontWeight: "700", color: colors.brand },

  // Success
  successOverlay: {
    flex: 1, backgroundColor: "rgba(17,24,39,0.6)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  successCard: {
    width: "100%", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
    alignItems: "center", gap: spacing.sm,
  },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  successTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  successSub: { fontSize: 14, color: colors.muted, textAlign: "center" },
  successPrice: { fontSize: 28, fontWeight: "700", color: colors.brand, marginVertical: spacing.md },
  successBreakdown: {
    width: "100%", marginTop: spacing.sm, marginBottom: 4,
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
  },
  successRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  successRowLabel: { color: colors.muted, fontSize: 13 },
  successRowValue: { color: colors.onSurface, fontSize: 13, fontWeight: "500" },
  successRowDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  successRowTotal: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  successRowTotalVal: { color: colors.brand, fontSize: 15, fontWeight: "800" },
  successBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14, alignSelf: "stretch", alignItems: "center",
  },
  successBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },

  // Payment method selector
  payMethodBlock: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  breakdownCard: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  breakdownRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 6,
  },
  breakdownLabel: { color: colors.muted, fontSize: 14 },
  breakdownValue: { color: colors.onSurface, fontSize: 14, fontWeight: "500" },
  strikePrice: { textDecorationLine: "line-through", color: colors.muted },
  freeChip: {
    flexDirection: "row", alignItems: "center", gap: 2,
    backgroundColor: "#DCFCE7",
    borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  freeChipText: { color: "#0F766E", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  freeHint: { color: "#0F766E", fontSize: 12, fontWeight: "500", marginTop: 2, marginBottom: 4 },
  breakdownDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  breakdownTotalLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  breakdownTotalValue: { color: colors.brand, fontSize: 18, fontWeight: "800" },
  payMethodTitle: {
    fontSize: 16, fontWeight: "700", color: colors.onSurface,
    marginBottom: 4,
  },
  payOpt: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
  },
  payOptActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  payOptDisabled: {
    opacity: 0.5,
  },
  payOptIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  payOptIconActive: { backgroundColor: colors.brandPrimary },
  payOptTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  payOptSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  payRadio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  payRadioActive: { borderColor: colors.brand },
  payRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
});
