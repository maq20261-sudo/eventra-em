import { useEffect, useState, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { useAuth } from "@/src/AuthContext";
import EventMap from "@/src/EventMap";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { eventDateRange } from "@/src/utils/eventDate";
import { eventTypeLabel } from "@/src/utils/eventTypeLabel";

export default function EventDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const e = await api.getEvent(String(id));
        setEvent(e);
      } catch (err) {
        console.log("Event detail error", err);
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

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ padding: spacing.xl }}>Event not found.</Text>
      </SafeAreaView>
    );
  }

  const startDate = new Date(event.start_date || event.date);
  const dateStr = startDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  // Full range e.g. "7:00 PM – 10:00 PM" (same day) or start–end date (multi-day)
  const rangeStr = eventDateRange(event);
  const endDate = event.end_date ? new Date(event.end_date) : null;
  const sameDay = endDate ? (
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate()
  ) : true;
  const timeStr = sameDay && endDate
    ? `${startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – ${endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const isOwner = user?.role === "organizer" && user?.id === event.organizer_id;

  const primary = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/book/${event.id}` as any);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image source={event.image_url} style={styles.hero} contentFit="cover" transition={200} />
          <LinearGradient
            colors={["rgba(31,41,55,0.4)", "transparent", "rgba(31,41,55,0.7)"]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["top"]} style={styles.heroTop}>
            <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="event-back-btn">
              <Ionicons name="chevron-back" size={22} color="#111827" />
            </Pressable>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryText}>{event.category}</Text>
            </View>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <Text style={styles.heroTitle}>{event.title}</Text>
            <View style={styles.heroMetaRow}>
              <Ionicons name="location-outline" size={14} color="#FFFFFF" />
              <Text style={styles.heroMeta}>{event.location_name}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.dateCard}>
            <View style={styles.dateIcon}>
              <Ionicons name="calendar" size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dateTitle}>{sameDay ? dateStr : rangeStr}</Text>
              <Text style={styles.dateSub}>{sameDay ? timeStr : `Ends ${endDate?.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</Text>
            </View>
          </View>

          <View style={styles.orgRow}>
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>{event.organizer_name?.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.orgLabel}>Hosted by</Text>
              <Text style={styles.orgName}>{event.organizer_name}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.description}>{event.description}</Text>

          <Text style={styles.sectionTitle}>Booking</Text>
          <View style={styles.bookingInfo}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Type</Text>
              <Text style={styles.infoValue}>
                {eventTypeLabel(event.booking_type)}
              </Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Price</Text>
              <Text style={styles.infoValue}>{event.price > 0 ? `₹${event.price.toFixed(0)}` : "Free"}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.locHeader}>
            <Ionicons name="location" size={16} color={colors.brand} />
            <Text style={styles.locName} numberOfLines={1}>{event.location_name}</Text>
          </View>
          <EventMap
            latitude={event.latitude}
            longitude={event.longitude}
            label={event.location_name}
            height={200}
          />
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.stickyBar}>
        <View style={styles.stickyInner}>
          <View>
            <Text style={styles.stickyPriceLabel}>Starting at</Text>
            <Text style={styles.stickyPrice}>
              {event.price > 0 ? `₹${event.price.toFixed(0)}` : "Free"}
            </Text>
          </View>
          {isOwner ? (
            <Pressable
              style={styles.cta}
              onPress={() => router.push(`/(organizer)/edit/${event.id}` as any)}
              testID="edit-event-btn"
            >
              <Text style={styles.ctaText}>Edit Event</Text>
              <Ionicons name="create-outline" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          ) : user?.role === "consumer" ? (
            <Pressable style={styles.cta} onPress={primary} testID="book-now-btn">
              <Text style={styles.ctaText}>
                {event.booking_type === "seat_map" ? "Select Seats" : event.booking_type === "time_slot" ? "Pick Slot" : "Book Now"}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          ) : (
            <Pressable style={[styles.cta, { opacity: 0.6 }]} disabled>
              <Text style={styles.ctaText}>View Only</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  heroWrap: { width: "100%", height: 340, backgroundColor: colors.surfaceTertiary },
  hero: { width: "100%", height: "100%" },
  heroTop: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center", justifyContent: "center",
    marginTop: spacing.sm,
  },
  categoryPill: {
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  categoryText: { fontSize: 11, fontWeight: "600", color: "#111827" },
  heroBottom: {
    position: "absolute", bottom: spacing.xl, left: spacing.lg, right: spacing.lg,
    gap: 6,
  },
  heroTitle: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", lineHeight: 34 },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroMeta: { fontSize: 14, color: "#FFFFFF", opacity: 0.9 },
  body: { padding: spacing.lg, gap: spacing.md },
  dateCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md,
    borderRadius: radius.md, ...shadows.card,
  },
  dateIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  dateTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  dateSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  orgRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, ...shadows.card,
  },
  orgAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.onSurface,
    alignItems: "center", justifyContent: "center",
  },
  orgAvatarText: { color: colors.surface, fontWeight: "700", fontSize: 16 },
  orgLabel: { fontSize: 12, color: colors.muted },
  orgName: { fontSize: 15, color: colors.onSurface, fontWeight: "600", marginTop: 2 },
  sectionTitle: {
    fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: spacing.lg,
  },
  description: { fontSize: 15, lineHeight: 22, color: colors.onSurfaceTertiary },
  bookingInfo: {
    flexDirection: "row", gap: spacing.md,
  },
  infoBlock: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    padding: spacing.md, ...shadows.card,
  },
  infoLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  infoValue: { fontSize: 15, fontWeight: "600", color: colors.onSurface, marginTop: 4 },
  mapCard: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.md, overflow: "hidden",
    height: 140,
  },
  mapPreview: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  mapText: { fontSize: 15, color: colors.onBrandTertiary, fontWeight: "600" },
  mapCoords: { fontSize: 12, color: colors.onBrandTertiary, opacity: 0.7 },
  locHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: -spacing.xs,
  },
  locName: { flex: 1, fontSize: 14, color: colors.onSurface, fontWeight: "500" },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopColor: colors.border, borderTopWidth: 1,
    ...shadows.floating,
  },
  stickyInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg, gap: spacing.md,
  },
  stickyPriceLabel: { fontSize: 12, color: colors.muted },
  stickyPrice: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: 2 },
  cta: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.xl, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 15 },
});
