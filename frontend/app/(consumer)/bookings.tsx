import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, shadows } from "@/src/theme";

type Booking = {
  id: string;
  event_id: string;
  event: any;
  seats?: string[];
  num_seats?: number;
  time_slot?: string;
  total_price: number;
  status: string;
  created_at: string;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MyBookings() {
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
  const filtered = bookings.filter((b) => {
    if (!b.event) return false;
    if (b.status === "cancelled") return tab === "completed";
    const isPast = new Date(b.event.date) < now;
    return tab === "upcoming" ? !isPast : isPast;
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Tickets</Text>
      </View>

      <View style={styles.segment}>
        <Pressable
          testID="tab-upcoming"
          style={[styles.segItem, tab === "upcoming" && styles.segItemActive]}
          onPress={() => setTab("upcoming")}
        >
          <Text style={[styles.segText, tab === "upcoming" && styles.segTextActive]}>Upcoming</Text>
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
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="ticket-outline" size={64} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No {tab} tickets</Text>
          <Text style={styles.emptySub}>Book your next unforgettable experience.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.push("/(consumer)/discover" as any)} testID="go-discover-btn">
            <Text style={styles.emptyBtnText}>Discover events</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {filtered.map((b) => (
            <Pressable
              key={b.id}
              testID={`booking-card-${b.id}`}
              style={styles.card}
              onPress={() => router.push(`/ticket/${b.id}` as any)}
            >
              <View style={styles.top}>
                <Image source={b.event?.image_url} style={styles.thumb} contentFit="cover" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.eventTitle} numberOfLines={2}>{b.event?.title}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={13} color={colors.muted} />
                    <Text style={styles.metaText}>{b.event ? fmtDate(b.event.date) : ""}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={colors.muted} />
                    <Text style={styles.metaText} numberOfLines={1}>{b.event?.location_name}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.dashRow}>
                {Array.from({ length: 20 }).map((_, i) => <View key={i} style={styles.dash} />)}
              </View>

              <View style={styles.bottom}>
                <View>
                  <Text style={styles.smallLabel}>
                    {b.seats ? "Seats" : b.num_seats ? "Tickets" : "Time slot"}
                  </Text>
                  <Text style={styles.smallValue} numberOfLines={1}>
                    {b.seats?.join(", ") || (b.num_seats ? `${b.num_seats} × ticket` : b.time_slot)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.smallLabel}>Total</Text>
                  <Text style={styles.priceValue}>
                    {b.total_price > 0 ? `$${b.total_price.toFixed(2)}` : "Free"}
                  </Text>
                </View>
                {b.status !== "confirmed" && (
                  <View style={styles.cancelledBadge}><Text style={styles.cancelledText}>Cancelled</Text></View>
                )}
              </View>
            </Pressable>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  segment: {
    flexDirection: "row", backgroundColor: colors.surfaceTertiary,
    padding: 4, borderRadius: radius.pill, marginHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center" },
  segItemActive: { backgroundColor: colors.surfaceSecondary, ...shadows.card },
  segText: { fontSize: 14, color: colors.muted, fontWeight: "500" },
  segTextActive: { color: colors.onSurface, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: "center" },
  emptyBtn: {
    marginTop: spacing.md, backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill,
  },
  emptyBtnText: { color: colors.onBrandPrimary, fontWeight: "600" },
  list: { padding: spacing.lg },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  top: { flexDirection: "row", gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  eventTitle: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.muted, flex: 1 },
  dashRow: {
    flexDirection: "row", justifyContent: "space-between",
    marginVertical: spacing.md,
  },
  dash: { width: 8, height: 1, backgroundColor: colors.borderStrong },
  bottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: spacing.md },
  smallLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  smallValue: { fontSize: 14, color: colors.onSurface, fontWeight: "500", marginTop: 2 },
  priceValue: { fontSize: 18, color: colors.brand, fontWeight: "700", marginTop: 2 },
  cancelledBadge: {
    backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
  },
  cancelledText: { color: colors.error, fontSize: 11, fontWeight: "600" },
});
