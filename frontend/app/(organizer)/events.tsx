import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal,
} from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import RazorpayCheckout, { RzpOrder } from "@/src/RazorpayCheckout";
import { colors, spacing, radius, shadows } from "@/src/theme";

type Event = {
  id: string; title: string; date: string; image_url?: string;
  category: string; booked_count: number; location_name: string; price: number;
  booking_type: string; total_seats?: number; seat_rows?: number; seat_cols?: number;
  time_slots?: string[]; is_featured?: boolean; featured_until?: string | null;
};

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OrganizerEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [boostEvent, setBoostEvent] = useState<Event | null>(null);
  const [boostLoading, setBoostLoading] = useState<string | null>(null);
  const [boostSuccess, setBoostSuccess] = useState<string | null>(null);
  const [rzpOrder, setRzpOrder] = useState<RzpOrder | null>(null);
  const [rzpVisible, setRzpVisible] = useState(false);
  const [boostError, setBoostError] = useState<string | null>(null);
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

  const runBoost = async (tier: "24h" | "7d" | "30d") => {
    if (!boostEvent) return;
    setBoostLoading(tier);
    setBoostError(null);
    try {
      // Try Razorpay checkout first
      try {
        const order = await api.createPaymentOrder({
          kind: "boost",
          boost_event_id: boostEvent.id,
          tier,
        });
        setRzpOrder(order as any);
        setRzpVisible(true);
        setBoostLoading(null);
        return;
      } catch (payErr: any) {
        const msg = payErr?.message || "";
        if (msg.includes("not configured") || msg.includes("503")) {
          // fall through to simulated boost
        } else {
          setBoostError(msg);
          setBoostLoading(null);
          return;
        }
      }

      // Simulated boost (payments not configured)
      const res = await api.featureEvent(boostEvent.id, tier);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBoostSuccess(`Boosted for $${res.amount_charged.toFixed(2)} (simulated)`);
      setBoostEvent(null);
      await load();
      setTimeout(() => setBoostSuccess(null), 2500);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBoostLoading(null);
    }
  };

  const handleBoostPaymentSuccess = async (payload: any) => {
    setRzpVisible(false);
    try {
      const verify = await api.verifyPayment(payload);
      const amt = verify?.result?.amount_charged || 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBoostSuccess(`Boosted for $${amt.toFixed(2)}!`);
      setBoostEvent(null);
      await load();
      setTimeout(() => setBoostSuccess(null), 2500);
    } catch (e: any) {
      setBoostError(e?.message || "Payment verification failed");
    } finally {
      setRzpOrder(null);
    }
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
              <View key={e.id} style={styles.card} testID={`org-event-${e.id}`}>
                <Pressable
                  style={styles.cardTop}
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
                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.boostBtn, e.is_featured && styles.boostBtnActive]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBoostEvent(e); }}
                    testID={`boost-btn-${e.id}`}
                  >
                    <Ionicons name="flame" size={14} color={e.is_featured ? colors.onBrandPrimary : "#F59E0B"} />
                    <Text style={[styles.boostText, e.is_featured && { color: colors.onBrandPrimary }]}>
                      {e.is_featured ? "Featured" : "Boost"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.editBtn}
                    onPress={() => router.push(`/(organizer)/edit/${e.id}` as any)}
                    testID={`edit-btn-${e.id}`}
                  >
                    <Ionicons name="create-outline" size={14} color={colors.onSurface} />
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Boost modal */}
      <Modal visible={!!boostEvent} transparent animationType="slide" onRequestClose={() => setBoostEvent(null)}>
        <Pressable style={styles.modalBg} onPress={() => setBoostEvent(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.boostHeader}>
              <View style={styles.boostIcon}>
                <Ionicons name="flame" size={24} color="#F59E0B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.boostTitle}>Boost this event</Text>
                <Text style={styles.boostSub} numberOfLines={1}>{boostEvent?.title}</Text>
              </View>
            </View>
            <Text style={styles.boostDesc}>
              Featured events appear at the top of Discover with a highlighted badge — get up to 5× more views.
            </Text>

            {[
              { key: "24h", price: 4.99, label: "1 Day", note: "Perfect for launches" },
              { key: "7d", price: 14.99, label: "7 Days", note: "Most popular", popular: true },
              { key: "30d", price: 39.99, label: "30 Days", note: "Best value" },
            ].map((t: any) => (
              <Pressable
                key={t.key}
                style={[styles.tierRow, t.popular && styles.tierRowPopular]}
                onPress={() => runBoost(t.key)}
                disabled={!!boostLoading}
                testID={`boost-tier-${t.key}`}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.tierLabelRow}>
                    <Text style={styles.tierLabel}>{t.label}</Text>
                    {t.popular && <View style={styles.popularPill}><Text style={styles.popularText}>Popular</Text></View>}
                  </View>
                  <Text style={styles.tierNote}>{t.note}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.tierPrice}>${t.price.toFixed(2)}</Text>
                  {boostLoading === t.key ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <Text style={styles.tierAction}>Boost →</Text>
                  )}
                </View>
              </Pressable>
            ))}
            <Text style={styles.boostFine}>
              {boostError
                ? boostError
                : "Powered by Razorpay · secure test-mode checkout"}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Success toast */}
      {boostSuccess && (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.toastText}>{boostSuccess}</Text>
        </View>
      )}

      <RazorpayCheckout
        visible={rzpVisible}
        order={rzpOrder}
        onSuccess={handleBoostPaymentSuccess}
        onCancel={() => { setRzpVisible(false); setRzpOrder(null); }}
        onError={(msg) => { setRzpVisible(false); setRzpOrder(null); setBoostError(msg); }}
      />
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
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.card,
  },
  cardTop: {
    flexDirection: "row", gap: spacing.md,
  },
  cardActions: {
    flexDirection: "row", gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopColor: colors.divider, borderTopWidth: 1,
  },
  boostBtn: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: "#FEF3C7",
    paddingVertical: 10, borderRadius: radius.pill,
  },
  boostBtnActive: {
    backgroundColor: "#F59E0B",
  },
  boostText: { fontSize: 13, color: "#92400E", fontWeight: "600" },
  editBtn: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: colors.surfaceTertiary,
    paddingVertical: 10, borderRadius: radius.pill,
  },
  editText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
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

  modalBg: { flex: 1, backgroundColor: "rgba(17,24,39,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.xl, paddingBottom: 48, gap: spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center",
  },
  boostHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  boostIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center",
  },
  boostTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  boostSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  boostDesc: { fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  tierRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surface,
  },
  tierRowPopular: {
    borderColor: colors.brand, backgroundColor: colors.brandTertiary,
  },
  tierLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tierLabel: { fontSize: 16, color: colors.onSurface, fontWeight: "700" },
  popularPill: {
    backgroundColor: colors.brand, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  popularText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  tierNote: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tierPrice: { fontSize: 18, color: colors.onSurface, fontWeight: "700" },
  tierAction: { fontSize: 12, color: colors.brand, fontWeight: "600", marginTop: 2 },
  boostFine: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: spacing.sm },

  toast: {
    position: "absolute", top: 80, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg, paddingVertical: 12,
    borderRadius: radius.pill, ...shadows.floating,
  },
  toastText: { color: colors.onBrandPrimary, fontWeight: "600" },
});
