import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius, shadows } from "@/src/theme";

const SEAT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export default function Booking() {
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
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [e, b] = await Promise.all([api.getEvent(String(id)), api.bookedSeats(String(id))]);
        setEvent(e);
        setBooked(b);
      } catch (err) {
        console.log("Booking load error", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totalPrice = useMemo(() => {
    if (!event) return 0;
    if (event.booking_type === "seat_map") return event.price * selectedSeats.length;
    if (event.booking_type === "general") return event.price * numSeats;
    return event.price;
  }, [event, selectedSeats, numSeats]);

  const canProceed = useMemo(() => {
    if (!event) return false;
    if (event.booking_type === "seat_map") return selectedSeats.length > 0;
    if (event.booking_type === "general") return numSeats > 0;
    if (event.booking_type === "time_slot") return !!slot;
    return false;
  }, [event, selectedSeats, numSeats, slot]);

  const toggleSeat = (seat: string) => {
    if (booked.booked_seats.includes(seat)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedSeats((prev) => prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]);
  };

  const confirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body: any = { event_id: String(id) };
      if (event.booking_type === "seat_map") body.seats = selectedSeats;
      if (event.booking_type === "general") body.num_seats = numSeats;
      if (event.booking_type === "time_slot") body.time_slot = slot;
      const res = await api.createBooking(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(res);
    } catch (e: any) {
      setError(e?.message || "Booking failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
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
            {event.booking_type === "seat_map" ? "Select your seats" :
             event.booking_type === "general" ? "Choose tickets" : "Pick a time slot"}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {event.booking_type === "seat_map" && (
          <SeatMap
            rows={event.seat_rows || 6}
            cols={event.seat_cols || 8}
            booked={booked.booked_seats}
            selected={selectedSeats}
            onToggle={toggleSeat}
          />
        )}

        {event.booking_type === "general" && (
          <GeneralPicker
            total={event.total_seats || 100}
            takenGeneral={booked.total_general_booked}
            value={numSeats}
            onChange={setNumSeats}
          />
        )}

        {event.booking_type === "time_slot" && (
          <TimeSlots
            slots={event.time_slots || []}
            takenSlots={booked.booked_slots}
            value={slot}
            onSelect={(s) => { Haptics.selectionAsync(); setSlot(s); }}
          />
        )}

        {error && <Text style={styles.error} testID="booking-error">{error}</Text>}
      </ScrollView>

      <View style={styles.stickyBar}>
        <View style={styles.stickyInner}>
          <View>
            <Text style={styles.stickyLabel}>Total</Text>
            <Text style={styles.stickyPrice}>
              {totalPrice > 0 ? `$${totalPrice.toFixed(2)}` : "Free"}
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
                <Text style={styles.ctaText}>Confirm Booking</Text>
                <Ionicons name="checkmark-circle" size={18} color={colors.onBrandPrimary} />
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
            <Text style={styles.successPrice}>
              {totalPrice > 0 ? `$${totalPrice.toFixed(2)}` : "Free entry"}
            </Text>
            <Pressable
              style={styles.successBtn}
              testID="view-tickets-btn"
              onPress={() => {
                setSuccess(null);
                router.replace("/(consumer)/bookings" as any);
              }}
            >
              <Text style={styles.successBtnText}>View my tickets</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SeatMap({ rows, cols, booked, selected, onToggle }: {
  rows: number; cols: number; booked: string[]; selected: string[]; onToggle: (s: string) => void;
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

function GeneralPicker({ total, takenGeneral, value, onChange }: {
  total: number; takenGeneral: number; value: number; onChange: (n: number) => void;
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

function TimeSlots({ slots, takenSlots, value, onSelect }: {
  slots: string[]; takenSlots: string[]; value: string | null; onSelect: (s: string) => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.generalLabel}>Available time slots</Text>
      {slots.map((s) => {
        const isTaken = takenSlots.includes(s);
        const isActive = value === s;
        return (
          <Pressable
            key={s}
            testID={`slot-${s}`}
            style={[styles.slot, isActive && styles.slotActive, isTaken && styles.slotTaken]}
            disabled={isTaken}
            onPress={() => onSelect(s)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.slotText, isActive && { color: colors.onBrandPrimary }, isTaken && { color: colors.muted }]}>
                {s}
              </Text>
              {isTaken && <Text style={styles.slotTakenText}>Fully booked</Text>}
            </View>
            {isActive && <Ionicons name="checkmark-circle" size={20} color={colors.onBrandPrimary} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
  successBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14, alignSelf: "stretch", alignItems: "center",
  },
  successBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },
});
