import { useState, useCallback, useMemo, useEffect } from "react";
import { View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { Text } from "@/src/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import { api } from "@/src/api";
import { spacing, shadows, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { Skeleton } from "@/src/ui/Skeleton";

type AnalyticsData = {
  total_revenue: number;
  total_tickets: number;
  checked_in_tickets?: number;
  total_events: number;
  unique_attendees: number;
  per_event: { event_id: string; title: string; revenue: number; tickets: number; date: string }[];
  category_breakdown: Record<string, number>;
};

const CAT_COLORS = ["#FF3D8B", "#7C5CFF", "#C6FF3D", "#5EEAD4", "#FFB547", "#7DD3FC"];

/** Counts up from 0 to `value` over ~0.9s — makes the numbers feel alive. */
function useCountUp(value: number, duration = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function Analytics() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.organizerAnalytics();
      setData(d);
    } catch (e) {
      console.log("analytics err", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const revenue = useCountUp(Math.round(data?.total_revenue || 0));

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width={160} height={26} />
          <Skeleton height={130} radius={22} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Skeleton height={86} radius={18} style={{ flex: 1 }} />
            <Skeleton height={86} radius={18} style={{ flex: 1 }} />
          </View>
          <Skeleton height={140} radius={20} />
        </View>
      </SafeAreaView>
    );
  }

  const catEntries = data ? Object.entries(data.category_breakdown) : [];
  const catTotal = catEntries.reduce((a, [, v]) => a + v, 0);
  const topEvents = data ? [...data.per_event].sort((a, b) => b.revenue - a.revenue).slice(0, 5) : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <GlowBackground />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand} colors={[colors.brand]} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>Overview of your events</Text>
        </View>

        <Animated.View entering={FadeInDown.duration(400)} style={styles.revenueCard} testID="kpi-revenue">
          <LinearGradient
            colors={["#5A1A6E", "#2A1650", "#1A1630"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.revenueGlow} />
          <View style={styles.revenueHead}>
            <Ionicons name="cash-outline" size={16} color="#E9DFFF" />
            <Text style={styles.revenueLabel}>Revenue</Text>
          </View>
          <Text style={styles.revenueValue}>{inr(revenue)}</Text>
          <Text style={styles.revenueSub}>Across all your events</Text>
        </Animated.View>

        <View style={styles.grid}>
          <KPICard icon="ticket-outline" label="Tickets Sold" value={data?.total_tickets || 0} testID="kpi-tickets" styles={styles} colors={colors} delay={60} />
          <KPICard icon="checkmark-done-outline" label="Checked In" value={data?.checked_in_tickets || 0} testID="kpi-checkedin" styles={styles} colors={colors} delay={100} accent={colors.lime} />
          <KPICard icon="calendar-outline" label="Events" value={data?.total_events || 0} testID="kpi-events" styles={styles} colors={colors} delay={140} />
          <KPICard icon="people-outline" label="Attendees" value={data?.unique_attendees || 0} testID="kpi-attendees" styles={styles} colors={colors} delay={180} />
        </View>

        {/* Category breakdown */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Event Categories</Text>
          {catEntries.length === 0 ? (
            <Text style={styles.emptyText}>No events yet.</Text>
          ) : catEntries.map(([cat, count], idx) => {
            const pct = catTotal ? Math.round((count / catTotal) * 100) : 0;
            const c = CAT_COLORS[idx % CAT_COLORS.length];
            return (
              <View key={cat} style={styles.catRow}>
                <View style={styles.catLabel}>
                  <View style={[styles.catDot, { backgroundColor: c }]} />
                  <Text style={styles.catName} numberOfLines={1}>{cat}</Text>
                </View>
                <View style={styles.catBarWrap}>
                  <AnimatedBar pct={pct} color={c} />
                </View>
                <Text style={styles.catCount}>{count}</Text>
              </View>
            );
          })}
        </View>

        {/* Top events */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Top Events by Revenue</Text>
          {topEvents.length === 0 ? (
            <Text style={styles.emptyText}>Create and sell tickets to see rankings here.</Text>
          ) : topEvents.map((e, i) => (
            <View key={e.event_id} style={[styles.topRow, i === topEvents.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[styles.rank, i === 0 && { backgroundColor: colors.brand }]}>
                <Text style={[styles.rankText, i === 0 && { color: colors.onBrandPrimary }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.topTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={styles.topSub}>{e.tickets} ticket{e.tickets === 1 ? "" : "s"} sold</Text>
              </View>
              <Text style={styles.topRevenue}>{inr(Math.round(e.revenue))}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AnimatedBar({ pct, color }: { pct: number; color: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(pct, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [pct, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return <Animated.View style={[{ height: "100%", borderRadius: 4, backgroundColor: color }, style]} />;
}

function KPICard({ icon, label, value, testID, styles, colors, delay = 0, accent }: {
  icon: any; label: string; value: number; testID: string; styles: any; colors: Colors; delay?: number; accent?: string;
}) {
  const shown = useCountUp(value);
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(350)} style={styles.kpiCard} testID={testID}>
      <View style={styles.kpiHead}>
        <Ionicons name={icon} size={14} color={colors.muted} />
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
      <Text style={[styles.kpiValue, accent ? { color: accent } : null]}>{shown.toLocaleString("en-IN")}</Text>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2, fontWeight: "600" },
  revenueCard: {
    borderRadius: 22, padding: spacing.lg, gap: 4, overflow: "hidden",
    borderWidth: 1, borderColor: colors.border,
    ...shadows.glow,
  },
  revenueGlow: {
    position: "absolute", right: -40, top: -50, width: 180, height: 180, borderRadius: 90,
    backgroundColor: "#FF3D8B", opacity: 0.35,
  },
  revenueHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  revenueLabel: { fontSize: 12, color: "#E9DFFF", fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  revenueValue: { fontFamily: fonts.display, fontSize: 32, fontWeight: "800", color: "#FFFFFF", marginTop: 4 },
  revenueSub: { fontSize: 12, color: "#CFC9EA" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  kpiCard: {
    width: "47%", flexGrow: 1,
    backgroundColor: colors.surfaceSecondary, borderRadius: 18,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: 6,
  },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  kpiValue: { fontFamily: fonts.display, fontSize: 22, fontWeight: "800", color: colors.onSurface },
  kpiLabel: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  sectionTitle: { fontFamily: fonts.display, fontSize: 14, fontWeight: "700", color: colors.onSurface, marginBottom: 4 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: 10,
  },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: spacing.md },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  catLabel: { flexDirection: "row", alignItems: "center", gap: 6, width: 90 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 13, color: colors.onSurface, fontWeight: "700", flexShrink: 1 },
  catBarWrap: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  catCount: { fontSize: 13, color: colors.muted, fontWeight: "800", width: 30, textAlign: "right" },
  topRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  rank: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rankText: { fontFamily: fonts.display, fontSize: 13, fontWeight: "800", color: colors.accentText },
  topTitle: { fontSize: 14, color: colors.onSurface, fontWeight: "800" },
  topSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  topRevenue: { fontSize: 15, color: colors.onSurface, fontWeight: "800" },
});
