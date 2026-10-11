import { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { spacing, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { ticketTypeLabel } from "@/src/utils/ticketLabel";
import { startsInLabel } from "@/src/utils/countdown";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { PressableScale } from "@/src/ui/PressableScale";
import { SkeletonRow } from "@/src/ui/Skeleton";
import { EmptyState } from "@/src/ui/EmptyState";
import { Tag, type TagTone } from "@/src/ui/Tag";

type Booking = {
  id: string;
  event_id: string;
  event: any;
  seats?: string[];
  num_seats?: number;
  time_slot?: string;
  total_price: number;
  status: string;
  payment_status?: string;
  checked_in?: boolean;
  cancelled_at?: string;
  refund?: { status?: string; amount_inr?: number; id?: string } | null;
  created_at: string;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function statusOf(b: Booking): { label: string; tone: TagTone } {
  if (b.status === "cancelled") {
    if (b.payment_status === "refund_pending") return { label: "CANCELLED · REFUND IN PROGRESS", tone: "bad" };
    if (b.payment_status === "refund_failed") return { label: "CANCELLED · REFUND REVIEW", tone: "bad" };
    return { label: "CANCELLED", tone: "bad" };
  }
  if (b.checked_in) return { label: "CHECKED IN", tone: "info" };
  if (b.payment_status === "paid") return { label: "CONFIRMED · PAID", tone: "ok" };
  if (b.total_price > 0) return { label: "PAY AT VENUE", tone: "warn" };
  return { label: "CONFIRMED · FREE", tone: "ok" };
}

function seatSummary(b: Booking) {
  return b.seats?.length
    ? (b.time_slot ? `${b.seats.join(", ")} · ${b.time_slot}` : b.seats.join(", "))
    : b.time_slot
    ? (b.num_seats && b.num_seats > 1 ? `${b.time_slot} · ${b.num_seats} seats` : b.time_slot)
    : b.num_seats
    ? `${b.num_seats} × ticket`
    : "General";
}

export default function MyBookings() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<"upcoming" | "completed">("upcoming");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const list = await api.myBookings();
      setBookings(list);
    } catch (e) {
      console.log("Bookings error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const now = new Date();
  const isUpcoming = (b: Booking) =>
    b.status !== "cancelled" && new Date(b.event.end_date || b.event.date) >= now;
  const withEvent = bookings.filter((b) => !!b.event);
  const upcomingCount = withEvent.filter(isUpcoming).length;
  const filtered = withEvent.filter((b) => (tab === "upcoming" ? isUpcoming(b) : !isUpcoming(b)));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <GlowBackground />
      <View style={styles.header}>
        <Text style={styles.title}>My Tickets</Text>
      </View>

      <View style={styles.segment}>
        <Pressable
          testID="tab-upcoming"
          style={[styles.segItem, tab === "upcoming" && styles.segItemActive]}
          onPress={() => setTab("upcoming")}
        >
          <Text style={[styles.segText, tab === "upcoming" && styles.segTextActive]}>
            Upcoming{upcomingCount ? ` · ${upcomingCount}` : ""}
          </Text>
        </Pressable>
        <Pressable
          testID="tab-completed"
          style={[styles.segItem, tab === "completed" && styles.segItemActive]}
          onPress={() => setTab("completed")}
        >
          <Text style={[styles.segText, tab === "completed" && styles.segTextActive]}>Completed</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="ticket-outline"
            title={tab === "upcoming" ? "No plans yet?" : "No completed tickets"}
            subtitle={tab === "upcoming"
              ? "Book your next unforgettable experience — concerts, comedy, workshops and more."
              : "Tickets for events you've attended or cancelled will show up here."}
            actionLabel="Discover events"
            onAction={() => router.push("/(consumer)/discover" as any)}
            actionTestID="go-discover-btn"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand} colors={[colors.brand]} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {filtered.map((b, i) => {
            const st = statusOf(b);
            const when = b.event.start_date || b.event.date;
            const countdown = tab === "upcoming" ? startsInLabel(when) : null;
            const dim = b.status === "cancelled";
            return (
              <Animated.View key={b.id} entering={FadeInDown.delay(Math.min(i, 8) * 50).duration(350)}>
                <PressableScale
                  testID={`booking-card-${b.id}`}
                  style={[styles.card, dim && { opacity: 0.6 }]}
                  onPress={() => router.push(`/ticket/${b.id}` as any)}
                >
                  <Image source={b.event?.image_url} style={styles.thumb} contentFit="cover" />
                  <View style={styles.body}>
                    <Tag label={st.label} tone={st.tone} />
                    <Text style={styles.eventTitle} numberOfLines={1}>{b.event?.title}</Text>
                    <Text style={styles.metaText} numberOfLines={1}>{fmtDate(when)} · {b.event?.location_name}</Text>
                    <Text style={styles.metaText} numberOfLines={1}>
                      <Text style={styles.metaLabel}>{ticketTypeLabel(b)}: </Text>{seatSummary(b)}
                    </Text>
                    <View style={styles.bottomRow}>
                      {countdown ? <Text style={styles.countdown}>{countdown}</Text> : <View />}
                      <Text style={styles.priceValue}>
                        {b.total_price > 0 ? `₹${b.total_price.toFixed(0)}` : "Free"}
                      </Text>
                    </View>
                  </View>
                  {/* ticket-stub notches */}
                  <View style={[styles.notch, { top: -9 }]} />
                  <View style={[styles.notch, { bottom: -9 }]} />
                </PressableScale>
              </Animated.View>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", color: colors.onSurface },
  segment: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    padding: 4, borderRadius: 14, marginHorizontal: 20, marginBottom: spacing.lg,
  },
  segItem: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segItemActive: { backgroundColor: colors.brand },
  segText: { fontSize: 14, color: colors.muted, fontWeight: "700" },
  segTextActive: { color: colors.onBrandPrimary, fontWeight: "800" },
  list: { paddingHorizontal: 20, gap: 14 },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    overflow: "hidden",
  },
  thumb: { width: 96, alignSelf: "stretch", minHeight: 132, backgroundColor: colors.surfaceTertiary },
  notch: { position: "absolute", left: 87, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
  body: { flex: 1, padding: 12, gap: 4 },
  eventTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  metaText: { fontSize: 12, color: colors.muted },
  metaLabel: { fontSize: 12, color: colors.soft, fontWeight: "700" },
  bottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  countdown: { fontSize: 12, fontWeight: "800", color: colors.accentText },
  priceValue: { fontSize: 15, color: colors.onSurface, fontWeight: "800" },
});
