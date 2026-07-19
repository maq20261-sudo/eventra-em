import { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

type AnalyticsData = {
  total_revenue: number;
  total_tickets: number;
  checked_in_tickets?: number;
  total_events: number;
  unique_attendees: number;
  per_event: { event_id: string; title: string; revenue: number; tickets: number; date: string }[];
  category_breakdown: Record<string, number>;
};

const CAT_COLORS = ["#059669", "#10B981", "#065F46", "#34D399", "#6EE7B7", "#A7F3D0"];

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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      </SafeAreaView>
    );
  }

  const catEntries = data ? Object.entries(data.category_breakdown) : [];
  const catTotal = catEntries.reduce((a, [, v]) => a + v, 0);
  const topEvents = data ? [...data.per_event].sort((a, b) => b.revenue - a.revenue).slice(0, 5) : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Overview of your events</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* KPI cards */}
        <View style={styles.grid}>
          <KPICard
            icon="cash-outline"
            label="Revenue"
            value={`$${(data?.total_revenue || 0).toFixed(0)}`}
            testID="kpi-revenue"
            styles={styles}
            colors={colors}
          />
          <KPICard
            icon="ticket-outline"
            label="Tickets Sold"
            value={String(data?.total_tickets || 0)}
            testID="kpi-tickets"
            styles={styles}
            colors={colors}
          />
          <KPICard
            icon="checkmark-done-outline"
            label="Checked In"
            value={String(data?.checked_in_tickets || 0)}
            testID="kpi-checkedin"
            styles={styles}
            colors={colors}
          />
          <KPICard
            icon="calendar-outline"
            label="Events"
            value={String(data?.total_events || 0)}
            testID="kpi-events"
            styles={styles}
            colors={colors}
          />
          <KPICard
            icon="people-outline"
            label="Attendees"
            value={String(data?.unique_attendees || 0)}
            testID="kpi-attendees"
            styles={styles}
            colors={colors}
          />
        </View>

        {/* Category breakdown */}
        <Text style={styles.sectionTitle}>Event Categories</Text>
        <View style={styles.card}>
          {catEntries.length === 0 ? (
            <Text style={styles.emptyText}>No events yet.</Text>
          ) : catEntries.map(([cat, count], idx) => {
            const pct = catTotal ? Math.round((count / catTotal) * 100) : 0;
            const c = CAT_COLORS[idx % CAT_COLORS.length];
            return (
              <View key={cat} style={styles.catRow}>
                <View style={styles.catLabel}>
                  <View style={[styles.catDot, { backgroundColor: c }]} />
                  <Text style={styles.catName}>{cat}</Text>
                </View>
                <View style={styles.catBarWrap}>
                  <View style={[styles.catBar, { width: `${pct}%`, backgroundColor: c }]} />
                </View>
                <Text style={styles.catCount}>{count}</Text>
              </View>
            );
          })}
        </View>

        {/* Top events */}
        <Text style={styles.sectionTitle}>Top Events by Revenue</Text>
        <View style={styles.card}>
          {topEvents.length === 0 ? (
            <Text style={styles.emptyText}>Create and sell tickets to see rankings here.</Text>
          ) : topEvents.map((e, i) => (
            <View key={e.event_id} style={styles.topRow}>
              <View style={styles.rank}><Text style={styles.rankText}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.topTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={styles.topSub}>{e.tickets} ticket{e.tickets === 1 ? "" : "s"} sold</Text>
              </View>
              <Text style={styles.topRevenue}>${e.revenue.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function KPICard({ icon, label, value, testID, styles, colors }: { icon: any; label: string; value: string; testID: string; styles: any; colors: Colors }) {
  return (
    <View style={styles.kpiCard} testID={testID}>
      <View style={styles.kpiIcon}>
        <Ionicons name={icon} size={18} color={colors.brand} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: spacing.md,
    marginBottom: spacing.lg,
  },
  kpiCard: {
    width: "47%", flexGrow: 1,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, ...shadows.card, gap: 4,
  },
  kpiIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  kpiValue: { fontSize: 24, fontWeight: "700", color: colors.onSurface },
  kpiLabel: { fontSize: 12, color: colors.muted },
  sectionTitle: {
    fontSize: 18, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, ...shadows.card, marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: spacing.md },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  catLabel: { flexDirection: "row", alignItems: "center", gap: 6, width: 90 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 13, color: colors.onSurface, fontWeight: "500" },
  catBarWrap: {
    flex: 1, height: 8, borderRadius: 4,
    backgroundColor: colors.surfaceTertiary, overflow: "hidden",
  },
  catBar: { height: "100%", borderRadius: 4 },
  catCount: { fontSize: 13, color: colors.muted, fontWeight: "600", width: 30, textAlign: "right" },
  topRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 8, borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  rank: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rankText: { fontSize: 13, fontWeight: "700", color: colors.onBrandTertiary },
  topTitle: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  topSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  topRevenue: { fontSize: 15, color: colors.brand, fontWeight: "700" },
});
