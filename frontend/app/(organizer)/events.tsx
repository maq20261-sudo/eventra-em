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

type Event = {
  id: string; title: string; date: string; image_url?: string;
  category: string; booked_count: number; location_name: string; price: number;
  booking_type: string; total_seats?: number; seat_rows?: number; seat_cols?: number;
  time_slots?: string[];
};

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OrganizerEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const list = await api.myOrgEvents();
      setEvents(list);
    } catch (e) {
      console.log("Org events error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const capacity = (e: Event) => {
    if (e.booking_type === "seat_map") return (e.seat_rows || 0) * (e.seat_cols || 0);
    if (e.booking_type === "general") return e.total_seats || 0;
    if (e.booking_type === "time_slot") return e.time_slots?.length || 0;
    return 0;
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Events</Text>
          <Text style={styles.subtitle}>{events.length} event{events.length === 1 ? "" : "s"}</Text>
        </View>
        <Pressable
          style={styles.newBtn}
          onPress={() => router.push("/(organizer)/create" as any)}
          testID="new-event-btn"
        >
          <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.newBtnText}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={64} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptySub}>Create your first event to start selling tickets.</Text>
          <Pressable
            style={styles.emptyBtn}
            onPress={() => router.push("/(organizer)/create" as any)}
            testID="create-first-btn"
          >
            <Text style={styles.emptyBtnText}>Create event</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {events.map((e) => {
            const cap = capacity(e);
            const pct = cap > 0 ? Math.min(100, Math.round((e.booked_count / cap) * 100)) : 0;
            return (
              <Pressable
                key={e.id}
                testID={`org-event-${e.id}`}
                style={styles.card}
                onPress={() => router.push(`/(organizer)/edit/${e.id}` as any)}
              >
                <Image source={e.image_url} style={styles.thumb} contentFit="cover" />
                <View style={styles.body}>
                  <View style={styles.rowTop}>
                    <View style={styles.catBadge}><Text style={styles.catText}>{e.category}</Text></View>
                    <Text style={styles.date}>{fmt(e.date)}</Text>
                  </View>
                  <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={12} color={colors.muted} />
                    <Text style={styles.metaText} numberOfLines={1}>{e.location_name}</Text>
                  </View>
                  <View style={styles.progressWrap}>
                    <View style={styles.progressBg}>
                      <View style={[styles.progressFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{e.booked_count}/{cap} · {pct}%</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  newBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },
  newBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: "center" },
  emptyBtn: {
    marginTop: spacing.md, backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill,
  },
  emptyBtnText: { color: colors.onBrandPrimary, fontWeight: "600" },
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    flexDirection: "row", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.card,
  },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  body: { flex: 1, gap: 4, justifyContent: "space-between" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catBadge: {
    backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm,
  },
  catText: { fontSize: 10, color: colors.onBrandTertiary, fontWeight: "600" },
  date: { fontSize: 12, color: colors.muted, fontWeight: "500" },
  eventTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, color: colors.muted, flex: 1 },
  progressWrap: { gap: 4 },
  progressBg: {
    height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.brand, borderRadius: 3 },
  progressText: { fontSize: 11, color: colors.muted, fontWeight: "500" },
});
