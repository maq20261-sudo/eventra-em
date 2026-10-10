import { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Modal } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import Animated, { FadeInDown } from "react-native-reanimated";
import { softPop } from "@/src/ui/motion";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import RazorpayCheckout, { RzpOrder } from "@/src/RazorpayCheckout";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { useQuota } from "@/src/hooks/usePricing";
import { useAuth } from "@/src/AuthContext";
import { Button } from "@/src/ui/Button";
import { PressableScale } from "@/src/ui/PressableScale";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { Confetti } from "@/src/ui/Confetti";
import { Skeleton } from "@/src/ui/Skeleton";
import { Tag } from "@/src/ui/Tag";

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
    // Reset event & booked state when the id changes so we don't
    // briefly render the PREVIOUS event's booking_type (which caused
    // Reserved Seating events to flash as "General Admission" when
    // navigating from one booking screen to another).
    let cancelled = false;
    setEvent(null);
    setLoading(true);
    setBooked({ booked_seats: [], booked_slots: [], total_general_booked: 0 });
    setSelectedSeats([]);
    setNumSeats(1);
    setSlot(null);
    setSlotSeats(1);
    setError(null);
    (async () => {
      try {
        const [e, b] = await Promise.all([api.getEvent(String(id)), api.bookedSeats(String(id))]);
        if (cancelled) return;
        setEvent(e);
        setBooked(b);
        // Determine payment gateway availability so we can hide the online option gracefully
        try {
          const cfg = await api.paymentConfig();
          if (cancelled) return;
          const configured = !!cfg?.configured;
          setGatewayConfigured(configured);
          if (!configured) setPaymentMethod("venue");
        } catch {
          if (!cancelled) {
            setGatewayConfigured(false);
            setPaymentMethod("venue");
          }
        }
      } catch (err) {
        console.log("Booking load error", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
      refreshQuota();
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
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={{ padding: 20, gap: 16 }}>
          <Skeleton width={44} height={44} radius={14} />
          <Skeleton width="60%" height={20} />
          <Skeleton height={260} radius={22} />
          <Skeleton height={90} radius={18} />
        </View>
      </SafeAreaView>
    );
  }

  const ctaTitle = totalPrice > 0
    ? (paymentMethod === "online" ? `Pay ₹${grandTotal.toFixed(0)} & Confirm` : "Reserve · Pay at Venue")
    : "Confirm Booking";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <GlowBackground />
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} style={styles.iconBtn} testID="booking-back-btn" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {event.booking_type === "seat_map"
              ? (isSeatMapWithSlots && !slot ? "Pick a showing" : "Choose seats")
              : event.booking_type === "general" ? "Choose tickets" : "Pick a time slot"}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>{event.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 150, gap: spacing.lg }}>
        {event.booking_type === "seat_map" && isSeatMapWithSlots && (
          <TimeSlots
            slotsInfo={slotsInfo}
            takenSlots={booked.booked_slots}
            value={slot}
            onSelect={(s) => { Haptics.selectionAsync(); setSlot(s); }}
            styles={styles}
            colors={colors}
            label="Showing"
          />
        )}

        {event.booking_type === "seat_map" && (!isSeatMapWithSlots || slot) && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <SeatMap
              rows={event.seat_rows || 6}
              cols={event.seat_cols || 8}
              booked={booked.booked_seats}
              selected={selectedSeats}
              onToggle={toggleSeat}
              styles={styles}
              colors={colors}
            />
            {selectedSeats.length > 0 && (
              <View style={styles.selectedCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>Your seats</Text>
                  <Text style={styles.selectedSeats} numberOfLines={2}>{selectedSeats.join(" · ")}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.cardLabel}>{selectedSeats.length} × ₹{Number(event.price).toFixed(0)}</Text>
                  <Text style={styles.selectedPrice}>₹{totalPrice.toFixed(0)}</Text>
                </View>
              </View>
            )}
          </Animated.View>
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
            label="Available time slots"
          />
        )}

        {event.booking_type === "time_slot" && slot && currentSlotInfo && !currentSlotInfo.sold_out && currentSlotInfo.capacity > 1 && (
          <View style={styles.stepperCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepperTitle}>How many seats?</Text>
              <Text style={styles.stepperHint}>
                {currentSlotInfo.remaining} of {currentSlotInfo.capacity} seat{currentSlotInfo.capacity === 1 ? "" : "s"} available
              </Text>
            </View>
            <Stepper
              value={slotSeats}
              onDec={() => { if (slotSeats > 1) { Haptics.selectionAsync(); setSlotSeats(slotSeats - 1); } }}
              onInc={() => {
                if (slotSeats < currentSlotInfo.remaining) {
                  Haptics.selectionAsync();
                  setSlotSeats(slotSeats + 1);
                }
              }}
              decID="slot-dec-btn"
              incID="slot-inc-btn"
              valueID="slot-seats-count"
              styles={styles}
              colors={colors}
            />
          </View>
        )}

        {event.price > 0 && totalPrice > 0 && (
          <View style={styles.card} testID="fee-breakdown">
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Ticket subtotal</Text>
              <Text style={styles.breakdownValue}>₹{totalPrice.toFixed(0)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { flex: 1 }]}>Platform fee</Text>
              <Text style={[styles.breakdownValue, feeWaived && styles.strikePrice]}>
                ₹{(quota?.attendee?.platform_fee_inr ?? 9).toFixed(0)}
              </Text>
              {feeWaived && <Tag label="FREE" tone="lime" icon="gift" style={{ marginLeft: 8 }} />}
            </View>
            {feeWaived && quota?.attendee && (
              <Text style={styles.freeHint}>
                Free booking applied · {quota.attendee.free_bookings_remaining} of {quota.attendee.free_booking_limit} left
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
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.sectionLabel}>Payment method</Text>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <PayMethodOption
                testID="pay-method-online"
                active={paymentMethod === "online"}
                disabled={!gatewayConfigured}
                icon="card"
                title="Pay online"
                subtitle={gatewayConfigured ? "UPI · cards · netbanking" : "Gateway unavailable"}
                onPress={() => { Haptics.selectionAsync(); setPaymentMethod("online"); }}
                styles={styles}
                colors={colors}
              />
              <PayMethodOption
                testID="pay-method-venue"
                active={paymentMethod === "venue"}
                icon="storefront-outline"
                title="Pay at venue"
                subtitle="Reserve now · pay when you arrive"
                onPress={() => { Haptics.selectionAsync(); setPaymentMethod("venue"); }}
                styles={styles}
                colors={colors}
              />
            </View>
          </View>
        )}

        {error && (
          <View style={styles.error}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText} testID="booking-error">{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.stickyBar}>
        <View style={styles.stickyInner}>
          <View>
            <Text style={styles.stickyLabel}>Total</Text>
            <Text style={styles.stickyPrice}>
              {grandTotal > 0 ? `₹${grandTotal.toFixed(0)}` : "Free"}
            </Text>
          </View>
          <Button
            title={ctaTitle}
            icon={totalPrice > 0 && paymentMethod === "online" ? "lock-closed" : "checkmark-circle"}
            onPress={confirm}
            disabled={!canProceed}
            loading={submitting}
            testID="confirm-booking-btn"
            style={{ flex: 1 }}
          />
        </View>
      </View>

      <Modal visible={!!success} animationType="fade" statusBarTranslucent>
        <SafeAreaView style={styles.successScreen}>
          <GlowBackground variant="success" />
          {success ? <Confetti /> : null}
          <View style={styles.successBody}>
            <Animated.View entering={softPop()} style={styles.successIcon}>
              <Ionicons name="checkmark" size={48} color={colors.onLime} />
            </Animated.View>
            <Animated.Text entering={FadeInDown.delay(150)} style={styles.successTitle}>Booking Confirmed!</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(220)} style={styles.successSub}>You're going. See you there!</Animated.Text>

            <Animated.View entering={FadeInDown.delay(300)} style={styles.successCard}>
              <View style={styles.successEventRow}>
                <Image source={event.image_url} style={styles.successThumb} contentFit="cover" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.successEventTitle} numberOfLines={2}>{event.title}</Text>
                  <Text style={styles.successEventMeta} numberOfLines={1}>
                    {new Date(event.start_date || event.date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </Text>
                  <Text style={styles.successEventMeta} numberOfLines={1}>{event.location_name}</Text>
                </View>
              </View>
              <View style={styles.dash} />
              {/* Full breakdown so the attendee sees the ₹9 platform fee they paid
                  (or that was waived under their first-5-free perk). */}
              {(success?.grand_total_inr ?? 0) > 0 && success?.platform_fee_inr > 0 ? (
                <View style={{ gap: 6 }}>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Ticket</Text>
                    <Text style={styles.breakdownValue}>₹{Number(success.total_price || 0).toFixed(0)}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Platform fee</Text>
                    <Text style={styles.breakdownValue}>₹{Number(success.platform_fee_inr).toFixed(0)}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownTotalLabel}>Total</Text>
                    <Text style={styles.breakdownTotalValue}>₹{Number(success.grand_total_inr).toFixed(0)}</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownTotalLabel}>
                    {success?.platform_fee_waived ? "Total · free booking applied" : "Total"}
                  </Text>
                  <Text style={styles.breakdownTotalValue}>
                    {(success?.grand_total_inr ?? success?.total_price ?? totalPrice) > 0
                      ? `₹${Number(success?.grand_total_inr ?? success?.total_price ?? totalPrice).toFixed(0)}`
                      : "Free entry"}
                  </Text>
                </View>
              )}
            </Animated.View>
          </View>

          <Animated.View entering={FadeInDown.delay(400)} style={styles.successActions}>
            <Button
              title="View my ticket"
              icon="ticket"
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
            />
            <Button
              title="Back to Discover"
              variant="ghost"
              onPress={() => { setSuccess(null); router.replace("/(consumer)/discover" as any); }}
            />
          </Animated.View>
        </SafeAreaView>
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

function Stepper({ value, onDec, onInc, decID, incID, valueID, styles, colors }: {
  value: number; onDec: () => void; onInc: () => void; decID: string; incID: string; valueID: string; styles: any; colors: Colors;
}) {
  return (
    <View style={styles.stepperRow}>
      <PressableScale style={styles.stepBtn} onPress={onDec} testID={decID} accessibilityLabel="Fewer" pressedScale={0.9}>
        <Ionicons name="remove" size={20} color={colors.onSurface} />
      </PressableScale>
      <Text style={styles.stepValue} testID={valueID}>{value}</Text>
      <PressableScale style={[styles.stepBtn, styles.stepBtnPlus]} onPress={onInc} testID={incID} accessibilityLabel="More" pressedScale={0.9}>
        <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
      </PressableScale>
    </View>
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
    <PressableScale
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[styles.payOpt, active && styles.payOptActive]}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Ionicons name={icon} size={22} color={active ? colors.accentText : colors.muted} />
        <View style={[styles.payRadio, active && styles.payRadioActive]}>
          {active && <View style={styles.payRadioDot} />}
        </View>
      </View>
      <Text style={[styles.payOptTitle, disabled && { color: colors.muted }]}>{title}</Text>
      <Text style={styles.payOptSub}>{subtitle}</Text>
    </PressableScale>
  );
}

function SeatMap({ rows, cols, booked, selected, onToggle, styles, colors }: {
  rows: number; cols: number; booked: string[]; selected: string[]; onToggle: (s: string) => void; styles: any; colors: Colors;
}) {
  return (
    <View style={styles.seatWrap}>
      <View style={styles.stage}>
        <Text style={styles.stageText}>STAGE</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
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
                      style={({ pressed }) => [
                        styles.seat,
                        isBooked && styles.seatTaken,
                        isSelected && styles.seatSelected,
                        pressed && { transform: [{ scale: 0.88 }] },
                      ]}
                      onPress={() => onToggle(seat)}
                      disabled={isBooked}
                    >
                      <Text style={[
                        styles.seatText,
                        isSelected && { color: colors.onBrandPrimary, fontWeight: "800" },
                        isBooked && { color: colors.borderStrong },
                      ]}>{c + 1}</Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.borderStrong }]} /><Text style={styles.legendText}>Available</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brandPrimary }]} /><Text style={styles.legendText}>Selected</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }]} /><Text style={styles.legendText}>Taken</Text></View>
      </View>
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
    <View style={{ gap: spacing.md }}>
      <Tag
        label={remaining <= 20 ? `Only ${remaining} tickets left` : `${remaining} tickets available`}
        tone={remaining <= 20 ? "pink" : "violet"}
        icon="people"
      />
      <View style={styles.stepperCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepperTitle}>How many tickets?</Text>
          <Text style={styles.stepperHint}>General admission</Text>
        </View>
        <Stepper value={value} onDec={dec} onInc={inc} decID="dec-seats-btn" incID="inc-seats-btn" valueID="general-count" styles={styles} colors={colors} />
      </View>
    </View>
  );
}

function TimeSlots({ slotsInfo, takenSlots, value, onSelect, styles, colors, label }: {
  slotsInfo: Array<{ time: string; capacity: number; booked: number; remaining: number; sold_out: boolean }>;
  takenSlots: string[]; value: string | null; onSelect: (s: string) => void; styles: any; colors: Colors; label: string;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {slotsInfo.map((info, i) => {
        const s = info.time;
        // Trust slots_info as the source of truth. Fall back to legacy
        // takenSlots (only used if slots_info missing).
        const soldOut = info.sold_out || (info.capacity <= 1 && takenSlots.includes(s));
        const isActive = value === s;
        const remaining = info.remaining;
        const capacity = info.capacity;
        const low = !soldOut && capacity > 1 && remaining <= Math.max(3, Math.ceil(capacity * 0.2));
        return (
          <Animated.View key={s} entering={FadeInDown.delay(i * 40).duration(300)}>
            <PressableScale
              testID={`slot-${s}`}
              style={[styles.slot, isActive && styles.slotActive, soldOut && styles.slotTaken]}
              disabled={soldOut}
              onPress={() => onSelect(s)}
            >
              <Ionicons name="time-outline" size={18} color={isActive ? colors.accentText : colors.muted} />
              <Text style={[styles.slotText, soldOut && { color: colors.muted, textDecorationLine: "line-through" }]} numberOfLines={1}>
                {s}
              </Text>
              {soldOut ? (
                <Tag label="Fully booked" tone="bad" />
              ) : capacity > 1 ? (
                low ? <Tag label={`${remaining} left`} tone="warn" /> : <Text style={styles.slotRemainingText}>{remaining} of {capacity} left</Text>
              ) : null}
              {isActive && <Ionicons name="checkmark-circle" size={20} color={colors.brand} />}
            </PressableScale>
          </Animated.View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  sectionLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  cardLabel: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  card: {
    padding: spacing.lg, gap: 4,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  error: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.error + "1F", padding: spacing.md, borderRadius: 14,
    borderWidth: 1, borderColor: colors.error + "55",
  },
  errorText: { color: colors.error, fontSize: 14, flex: 1, fontWeight: "600" },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopColor: colors.border, borderTopWidth: 1,
    paddingBottom: 24,
    ...shadows.floating,
  },
  stickyInner: { flexDirection: "row", alignItems: "center", padding: spacing.lg, gap: spacing.lg },
  stickyLabel: { fontSize: 12, color: colors.muted },
  stickyPrice: { fontFamily: fonts.display, fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: 2 },

  // Seat map
  seatWrap: {
    borderRadius: 22, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm,
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.border,
    overflow: "hidden",
  },
  stage: {
    alignSelf: "center", width: "70%", height: 30,
    borderBottomLeftRadius: 120, borderBottomRightRadius: 120,
    borderBottomWidth: 3, borderColor: colors.brand,
    alignItems: "center", justifyContent: "flex-start",
    shadowColor: colors.brand, shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  stageText: { color: colors.accentText, fontSize: 11, letterSpacing: 4, fontWeight: "800" },
  legendRow: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.soft, fontWeight: "700" },
  seatRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  rowLabel: { width: 16, fontSize: 11, color: colors.muted, fontWeight: "700" },
  seat: {
    width: 30, height: 30, borderRadius: 8, borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
    backgroundColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  seatSelected: {
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.brand, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  seatTaken: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  seatText: { fontSize: 10, color: colors.soft, fontWeight: "600" },
  selectedCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md,
    padding: spacing.lg, borderRadius: 18,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  selectedSeats: { fontFamily: fonts.display, fontSize: 16, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  selectedPrice: { fontSize: 16, fontWeight: "800", color: colors.onSurface, marginTop: 2 },

  // Stepper
  stepperCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  stepperTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  stepperHint: { fontSize: 12, color: colors.muted, marginTop: 2 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  stepBtnPlus: { backgroundColor: colors.brandPrimary },
  stepValue: { fontFamily: fonts.display, fontSize: 20, fontWeight: "800", color: colors.onSurface, minWidth: 28, textAlign: "center" },

  // Slots
  slot: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, minHeight: 58, borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
  },
  slotActive: { backgroundColor: colors.brand + "1F", borderColor: colors.brand, borderWidth: 1.5 },
  slotTaken: { opacity: 0.6 },
  slotText: { flex: 1, fontSize: 15, color: colors.onSurface, fontWeight: "800" },
  slotRemainingText: { fontSize: 12, color: colors.muted, fontWeight: "700" },

  // Breakdown
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  breakdownLabel: { color: colors.soft, fontSize: 14 },
  breakdownValue: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  strikePrice: { textDecorationLine: "line-through", color: colors.muted },
  freeHint: { color: colors.success, fontSize: 12, fontWeight: "700", marginBottom: 2 },
  breakdownDivider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  breakdownTotalLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  breakdownTotalValue: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 18, fontWeight: "800" },

  // Payment method
  payOpt: {
    flex: 1, gap: 4, padding: spacing.md, borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
  },
  payOptActive: { borderColor: colors.brand, borderWidth: 1.5, backgroundColor: colors.brand + "1A" },
  payOptTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  payOptSub: { fontSize: 11, color: colors.muted },
  payRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  payRadioActive: { borderColor: colors.brand },
  payRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand },

  // Success (full screen celebration)
  successScreen: { flex: 1, backgroundColor: colors.surface },
  successBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, gap: 12 },
  successIcon: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: colors.lime,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
    shadowColor: colors.lime, shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  successTitle: { fontFamily: "Unbounded_800ExtraBold", fontSize: 24, color: colors.onSurface, textAlign: "center" },
  successSub: { fontFamily: "Manrope_500Medium", fontSize: 15, color: colors.soft, textAlign: "center" },
  successCard: {
    alignSelf: "stretch", marginTop: spacing.lg, padding: spacing.lg, gap: spacing.md,
    borderRadius: 22, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  successEventRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  successThumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  successEventTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  successEventMeta: { fontSize: 12, color: colors.muted },
  dash: { borderTopWidth: 1.5, borderStyle: "dashed", borderColor: colors.border },
  successActions: { padding: 20, gap: spacing.sm },
});
