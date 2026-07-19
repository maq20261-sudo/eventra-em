import { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/src/api";
import EventMap from "@/src/EventMap";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function TicketScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.myBookings();
        const found = list.find((b: any) => b.id === String(id));
        setBooking(found);
      } catch (e) {
        console.log("ticket load err", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!booking || !booking.event) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ padding: spacing.xl }}>Ticket not found.</Text>
      </SafeAreaView>
    );
  }

  const e = booking.event;
  const qrPayload = JSON.stringify({ t: "gs-ticket", id: booking.id });
  const seatLine = booking.seats?.length ? booking.seats.join(", ") : booking.num_seats ? `${booking.num_seats} × ticket` : booking.time_slot;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()} testID="ticket-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My Ticket</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        <View style={styles.card}>
          <Image source={e.image_url} style={styles.hero} contentFit="cover" />
          <View style={styles.cardBody}>
            <View style={styles.catRow}>
              <View style={styles.catBadge}>
                <Text style={styles.catText}>{e.category}</Text>
              </View>
              {booking.checked_in && (
                <View style={styles.checkedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.checkedText}>Checked In</Text>
                </View>
              )}
              {booking.status === "cancelled" && (
                <View style={styles.cancelBadge}>
                  <Text style={styles.cancelText}>Cancelled</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>{e.title}</Text>

            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.muted} />
              <Text style={styles.metaText}>{fmtDate(e.date)} · {fmtTime(e.date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={14} color={colors.muted} />
              <Text style={styles.metaText}>{e.location_name}</Text>
            </View>

            <View style={styles.dashRow}>
              {Array.from({ length: 24 }).map((_, i) => <View key={i} style={styles.dash} />)}
            </View>

            <View style={styles.detailsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>
                  {booking.seats ? "Seats" : booking.num_seats ? "Tickets" : "Time slot"}
                </Text>
                <Text style={styles.smallValue}>{seatLine}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.smallLabel}>Total</Text>
                <Text style={styles.priceValue}>
                  {booking.total_price > 0 ? `₹${booking.total_price.toFixed(0)}` : "Free"}
                </Text>
              </View>
            </View>

            <View style={styles.qrWrap}>
              <View style={styles.qrBox}>
                <QRCode
                  value={qrPayload}
                  size={200}
                  color={colors.onSurface}
                  backgroundColor={colors.surfaceSecondary}
                />
              </View>
              <Text style={styles.qrHint}>Show this QR at the entrance</Text>
              <Text style={styles.bookingId} testID="ticket-id">ID · {booking.id.slice(0, 8).toUpperCase()}</Text>
            </View>

            {booking.total_price > 0 && !booking.checked_in && booking.status !== "cancelled" && booking.payment_status !== "paid" && (
              <View style={styles.notice}>
                <Ionicons name="wallet-outline" size={16} color={colors.warning} />
                <Text style={styles.noticeText}>
                  Pay ₹{booking.total_price.toFixed(0)} at the venue when scanned
                </Text>
              </View>
            )}
            {booking.payment_status === "paid" && (
              <View style={styles.paidNotice}>
                <Ionicons name="shield-checkmark" size={16} color={colors.brand} />
                <Text style={styles.paidNoticeText}>
                  Paid online · No payment needed at venue
                </Text>
              </View>
            )}

            <View style={styles.venueBlock}>
              <Text style={styles.venueTitle}>Venue</Text>
              <EventMap
                latitude={e.latitude}
                longitude={e.longitude}
                label={e.location_name}
                height={160}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface },

  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  hero: { width: "100%", height: 180, backgroundColor: colors.surfaceTertiary },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  catBadge: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  catText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: "600" },
  checkedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  checkedText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "600" },
  cancelBadge: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  cancelText: { fontSize: 11, color: colors.error, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, color: colors.muted },

  dashRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: spacing.md },
  dash: { width: 6, height: 1, backgroundColor: colors.borderStrong },

  detailsRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  smallLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  smallValue: { fontSize: 15, color: colors.onSurface, fontWeight: "500", marginTop: 2 },
  priceValue: { fontSize: 20, color: colors.brand, fontWeight: "700", marginTop: 2 },

  qrWrap: { alignItems: "center", marginTop: spacing.lg, gap: 6 },
  qrBox: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  qrHint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  bookingId: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: "600", letterSpacing: 1 },

  notice: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF3C7",
    padding: spacing.md, borderRadius: radius.md,
  },
  noticeText: { fontSize: 13, color: "#92400E", flex: 1, fontWeight: "500" },
  paidNotice: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: radius.md,
  },
  paidNoticeText: { fontSize: 13, color: colors.onBrandTertiary, flex: 1, fontWeight: "500" },
  venueBlock: { marginTop: spacing.lg, gap: spacing.sm },
  venueTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
});
