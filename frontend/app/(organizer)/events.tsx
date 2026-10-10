import { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import RazorpayCheckout, { RzpOrder } from "@/src/RazorpayCheckout";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { PressableScale } from "@/src/ui/PressableScale";
import { Button } from "@/src/ui/Button";
import { Skeleton, SkeletonRow } from "@/src/ui/Skeleton";
import { usePricingConfig } from "@/src/hooks/usePricing";

// Display copy per boost tier; prices always come from the server.
const BOOST_COPY: Record<string, { label: string; note: string; popular?: boolean }> = {
  "24h": { label: "1 Day", note: "Perfect for launches" },
  "7d": { label: "7 Days", note: "Most popular", popular: true },
  "30d": { label: "30 Days", note: "Best value" },
};
import { EmptyState } from "@/src/ui/EmptyState";
import { Confetti } from "@/src/ui/Confetti";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { eventTypeShortLabel, eventTypeIcon } from "@/src/utils/eventTypeLabel";
import { eventStatusMeta } from "@/src/utils/eventStatus";

type EventStatus = "IN_REVIEW" | "ACTIVE" | "REJECTED" | "ON_HOLD";

type Event = {
  id: string; title: string; date: string; start_date?: string; end_date?: string;
  image_url?: string;
  category: string; booked_count: number; location_name: string; price: number;
  booking_type: string; total_seats?: number; seat_rows?: number; seat_cols?: number;
  time_slots?: string[]; slot_capacities?: Record<string, number>; slot_capacity?: number;
  is_featured?: boolean; featured_until?: string | null;
  is_past?: boolean;
  status?: EventStatus | string;
  hold_reasons?: string[];
};

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OrganizerEvents() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const pricing = usePricingConfig();
  const boostTiers = useMemo(
    () =>
      pricing?.boost_tiers?.map((t) => ({
        key: t.key,
        price: t.price_inr,
        label: BOOST_COPY[t.key]?.label ?? t.label,
        note: BOOST_COPY[t.key]?.note ?? "",
        popular: !!BOOST_COPY[t.key]?.popular,
      })) ?? null,
    [pricing],
  );

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
    if (e.booking_type === "time_slot") {
      // Sum per-slot capacities, falling back to slot_capacity for legacy events.
      const labels = e.time_slots || [];
      const caps = e.slot_capacities || {};
      const fallback = e.slot_capacity || 1;
      return labels.reduce((sum, t) => sum + (caps[t] ?? fallback), 0);
    }
    return 0;
  };

  const runBoost = async (tier: "24h" | "7d" | "30d") => {
    if (!boostEvent) return;
    setBoostLoading(tier);
    setBoostError(null);
    try {
      const order = await api.createPaymentOrder({
        kind: "boost",
        boost_event_id: boostEvent.id,
        tier,
      });
      setRzpOrder(order as any);
      setRzpVisible(true);
    } catch (payErr: any) {
      const msg = payErr?.message || "";
      if (msg.includes("not configured") || msg.includes("503")) {
        setBoostError("Payments are not configured. Boost requires an active Razorpay account.");
      } else {
        setBoostError(msg || "Could not start payment");
      }
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
      setBoostSuccess(`Boosted for ₹${amt.toFixed(0)}!`);
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
      <GlowBackground />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Events</Text>
          <Text style={styles.subtitle}>{events.length} event{events.length === 1 ? "" : "s"}</Text>
        </View>
        <Button
          title="New"
          icon="add"
          small
          onPress={() => router.push("/(organizer)/create" as any)}
          testID="new-event-btn"
        />
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 20, gap: 8 }}><SkeletonRow /><SkeletonRow /><SkeletonRow /></View>
      ) : events.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="sparkles-outline"
            title="No events yet"
            subtitle="Create your first event to start selling tickets. Your first 5 events are free."
            actionLabel="Create event"
            onAction={() => router.push("/(organizer)/create" as any)}
            actionTestID="create-first-btn"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand} colors={[colors.brand]} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {(() => {
            // Split events into Upcoming and Past groups so ended events
            // move out of the primary list into a "Past Events" section.
            const upcoming = events.filter((x) => !x.is_past);
            const past = events.filter((x) => x.is_past);
            const renderCard = (e: Event, dim: boolean = false) => {
              const cap = capacity(e);
              const pct = cap > 0 ? Math.min(100, Math.round((e.booked_count / cap) * 100)) : 0;
              return (
                <Animated.View key={e.id} entering={FadeInDown.duration(350)} style={[styles.card, dim && { opacity: 0.6 }]} testID={`org-event-${e.id}`}>
                  <PressableScale
                    style={styles.cardTop}
                    onPress={() => router.push(`/(organizer)/edit/${e.id}` as any)}
                  >
                    <Image source={e.image_url} style={styles.thumb} contentFit="cover" />
                    <View style={styles.body}>
                      <View style={styles.rowTop}>
                        <View style={styles.catBadge}><Text style={styles.catText}>{e.category}</Text></View>
                        <Text style={styles.date}>{fmt(e.start_date || e.date)}</Text>
                      </View>
                      <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
                      <View style={styles.metaRow}>
                        <Ionicons name="location-outline" size={12} color={colors.muted} />
                        <Text style={styles.metaText} numberOfLines={1}>{e.location_name}</Text>
                      </View>
                      <View style={styles.chipsRow}>
                        <View style={styles.typeChip} testID={`event-type-chip-${e.id}`}>
                          <Ionicons name={eventTypeIcon(e.booking_type) as any} size={11} color={colors.brand} />
                          <Text style={styles.typeChipText}>{eventTypeShortLabel(e.booking_type)}</Text>
                        </View>
                        {(() => {
                          const meta = eventStatusMeta(e.status);
                          return (
                            <View
                              style={[styles.statusChip, { backgroundColor: meta.bg }]}
                              testID={`event-status-chip-${e.id}`}
                            >
                              <Ionicons name={meta.icon as any} size={11} color={meta.fg} />
                              <Text style={[styles.statusChipText, { color: meta.fg }]}>
                                {meta.label}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                      {e.hold_reasons && e.hold_reasons.length > 0 && (
                        <View style={styles.holdReasonRow} testID={`event-hold-reasons-${e.id}`}>
                          <Ionicons name="information-circle-outline" size={13} color={colors.warning} />
                          <Text style={styles.holdReasonText} numberOfLines={2}>
                            {e.hold_reasons.join(" · ")}
                          </Text>
                        </View>
                      )}
                      {dim && (
                        <View style={styles.endedChip}>
                          <Ionicons name="time-outline" size={11} color={colors.muted} />
                          <Text style={styles.endedChipText}>Ended</Text>
                        </View>
                      )}
                      <View style={styles.progressWrap}>
                      <View style={styles.progressBg}>
                        <LinearGradient
                          colors={[colors.brand, colors.violet]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[styles.progressFill, { width: `${pct}%` }]}
                        />
                      </View>
                      <Text style={styles.progressText}>{e.booked_count}/{cap} · {pct}%</Text>
                    </View>
                  </View>
                </PressableScale>
                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.boostBtn, e.is_featured && styles.boostBtnActive]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBoostEvent(e); }}
                    testID={`boost-btn-${e.id}`}
                  >
                    <Ionicons name="flame" size={14} color={e.is_featured ? colors.onLime : colors.warning} />
                    <Text style={[styles.boostText, e.is_featured && { color: colors.onLime }]}>
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
              </Animated.View>
            );
            };  // end renderCard
            return (
              <>
                {upcoming.length === 0 && past.length > 0 && (
                  <View style={styles.sectionEmpty}>
                    <Ionicons name="calendar-outline" size={40} color={colors.borderStrong} />
                    <Text style={styles.emptyTitle}>No upcoming events</Text>
                    <Text style={styles.emptySub}>Create a new event or scroll down for past ones.</Text>
                  </View>
                )}
                {upcoming.map((e) => renderCard(e, false))}
                {past.length > 0 && (
                  <View style={styles.sectionHeader} testID="past-events-section">
                    <Ionicons name="time-outline" size={16} color={colors.muted} />
                    <Text style={styles.sectionTitle}>Past Events</Text>
                    <View style={styles.sectionCountPill}>
                      <Text style={styles.sectionCountText}>{past.length}</Text>
                    </View>
                  </View>
                )}
                {past.map((e) => renderCard(e, true))}
              </>
            );
          })()}
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
                <Ionicons name="flame" size={26} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.boostTitle}>Boost this event</Text>
                <Text style={styles.boostSub} numberOfLines={1}>{boostEvent?.title}</Text>
              </View>
            </View>
            <Text style={styles.boostDesc}>
              Featured events appear at the top of Discover with a highlighted badge — get up to 5× more views.
            </Text>

            {/* Prices come from the server (GET /pricing/config) — the same
                table it charges from — so the sheet can never disagree with
                the Razorpay amount. Until they load we show placeholders. */}
            {!boostTiers ? (
              <View style={{ gap: spacing.md }}>
                <Skeleton height={76} radius={18} />
                <Skeleton height={76} radius={18} />
                <Skeleton height={76} radius={18} />
              </View>
            ) : boostTiers.map((t) => (
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
                  <Text style={styles.tierPrice}>₹{t.price.toLocaleString("en-IN")}</Text>
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

      {/* Success: confetti + toast */}
      {boostSuccess && <Confetti count={36} />}
      {boostSuccess && (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={18} color={colors.onLime} />
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

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2, fontWeight: "600" },
  list: { paddingHorizontal: 20, paddingBottom: spacing.lg, gap: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  sectionTitle: { fontFamily: fonts.display, fontSize: 14, fontWeight: "700", color: colors.onSurface },
  sectionCountPill: {
    marginLeft: 4, paddingHorizontal: 8, paddingVertical: 1,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill,
  },
  sectionCountText: { fontSize: 11, color: colors.violetText, fontWeight: "800" },
  sectionEmpty: { alignItems: "center", gap: 4, paddingVertical: spacing.lg },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: "center" },
  endedChip: {
    flexDirection: "row", alignSelf: "flex-start",
    alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 2,
    marginTop: 4,
  },
  endedChipText: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  typeChip: {
    flexDirection: "row", alignSelf: "flex-start",
    alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  typeChipText: { fontSize: 11, color: colors.violetText, fontWeight: "700" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 },
  statusChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusChipText: { fontSize: 11, fontWeight: "800" },
  holdReasonRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.warning + "1A",
  },
  holdReasonText: { flex: 1, fontSize: 12, color: colors.warning, fontWeight: "700", lineHeight: 16 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    overflow: "hidden",
  },
  cardTop: { flexDirection: "row", gap: spacing.md, padding: 12 },
  cardActions: {
    flexDirection: "row", gap: spacing.sm,
    padding: 12,
    borderTopColor: colors.border, borderTopWidth: 1,
  },
  boostBtn: {
    flex: 1, height: 40,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.warning + "1F",
    borderWidth: 1, borderColor: colors.warning + "55",
    borderRadius: 12,
  },
  boostBtnActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  boostText: { fontSize: 13, color: colors.warning, fontWeight: "800" },
  editBtn: {
    flex: 1, height: 40,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12,
  },
  editText: { fontSize: 13, color: colors.onSurface, fontWeight: "800" },
  thumb: { width: 84, height: 84, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  body: { flex: 1, gap: 4, justifyContent: "space-between" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catBadge: {
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
  },
  catText: { fontSize: 10, color: colors.accentText, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  date: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  eventTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.muted, flex: 1 },
  progressWrap: { gap: 4, marginTop: 4 },
  progressBg: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  progressText: { fontSize: 11, color: colors.soft, fontWeight: "700" },

  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderTopWidth: 1, borderColor: colors.border,
    padding: spacing.xl, paddingTop: 12, paddingBottom: 40, gap: spacing.md,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 4 },
  boostHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  boostIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: colors.warning + "29",
    alignItems: "center", justifyContent: "center",
  },
  boostTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  boostSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  boostDesc: { fontSize: 14, color: colors.soft, lineHeight: 20 },
  tierRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 18,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  // Opaque tint: Android draws an elevation shadow *through* translucent
  // backgrounds, which showed up as a dark rectangle inside this card.
  tierRowPopular: {
    borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandTertiary,
    ...shadows.glow,
  },
  tierLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tierLabel: { fontSize: 16, color: colors.onSurface, fontWeight: "800" },
  popularPill: { backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  popularText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  tierNote: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tierPrice: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface, fontWeight: "800" },
  tierAction: { fontSize: 12, color: colors.accentText, fontWeight: "800", marginTop: 2 },
  boostFine: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: spacing.sm },

  toast: {
    position: "absolute", top: 80, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.lime,
    paddingHorizontal: spacing.lg, paddingVertical: 12,
    borderRadius: radius.pill, ...shadows.floating,
  },
  toastText: { color: colors.onLime, fontWeight: "800" },
});