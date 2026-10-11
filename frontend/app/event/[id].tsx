import { useEffect, useState, useMemo } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Text } from "@/src/ui/Text";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/AuthContext";
import EventMap from "@/src/EventMap";
import { spacing, shadows, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { eventDateRange } from "@/src/utils/eventDate";
import { eventTypeLabel, eventTypeIcon } from "@/src/utils/eventTypeLabel";
import { urgencyOf, goingLabel, seatsLeft } from "@/src/utils/urgency";
import { PressableScale } from "@/src/ui/PressableScale";
import { Button } from "@/src/ui/Button";
import { Tag } from "@/src/ui/Tag";
import { Skeleton } from "@/src/ui/Skeleton";
import { EmptyState } from "@/src/ui/EmptyState";

export default function EventDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // CRITICAL: reset event state when id changes so we don't briefly
    // render the PREVIOUS event's data (which caused Reserved Seating
    // events to flash as "General Admission" when navigating between
    // events with different booking types).
    let cancelled = false;
    setEvent(null);
    setLoading(true);
    (async () => {
      try {
        const e = await api.getEvent(String(id));
        if (!cancelled) setEvent(e);
      } catch (err) {
        console.log("Event detail error", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Skeleton height={320} radius={0} />
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width="60%" height={22} />
          <Skeleton height={72} radius={18} />
          <Skeleton height={120} radius={18} />
        </View>
      </View>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="alert-circle-outline"
          title="Event not found."
          subtitle="It may have been removed or is no longer available."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
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
  const urg = urgencyOf(event);
  const going = goingLabel(event);
  const left = seatsLeft(event);
  const priceText = event.price > 0 ? `₹${event.price.toFixed(0)}` : "Free";

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image source={event.image_url} style={styles.hero} contentFit="cover" transition={250} />
          <LinearGradient
            colors={["rgba(13,11,26,0.55)", "rgba(13,11,26,0)", "rgba(13,11,26,0.92)"]}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["top"]} style={styles.heroTop}>
            <PressableScale onPress={() => router.back()} style={styles.iconBtn} testID="event-back-btn" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </PressableScale>
            {urg ? <Tag label={urg.label} tone={urg.tone} style={{ marginTop: spacing.sm }} /> : null}
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Tag label={String(event.category).toUpperCase()} tone="lime" />
              <Tag label={eventTypeLabel(event.booking_type)} tone="dark" icon={eventTypeIcon(event.booking_type) as any} />
              {going ? <Tag label={going} tone="dark" icon="people" /> : null}
            </View>
            <Text style={styles.heroTitle}>{event.title}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Animated.View entering={FadeInDown.duration(350)} style={styles.orgRow}>
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>{event.organizer_name?.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.orgLabel}>Hosted by</Text>
              <Text style={styles.orgName}>{event.organizer_name}</Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(60).duration(350)} style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="calendar" size={18} color={colors.accentText} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>{sameDay ? dateStr : rangeStr}</Text>
                <Text style={styles.infoSub}>{sameDay ? timeStr : `Ends ${endDate?.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="pricetag" size={18} color={colors.lime} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>{priceText}{event.price > 0 ? " per ticket" : ""}</Text>
                <Text style={styles.infoSub}>
                  {eventTypeLabel(event.booking_type)}
                  {left != null ? ` · ${left} ${left === 1 ? "spot" : "spots"} left` : ""}
                </Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(350)} style={{ gap: spacing.sm }}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{event.description}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(180).duration(350)} style={{ gap: spacing.sm }}>
            <Text style={styles.sectionTitle}>Location</Text>
            <View style={styles.locHeader}>
              <Ionicons name="location" size={16} color={colors.brand} />
              <Text style={styles.locName} numberOfLines={2}>{event.location_name}</Text>
            </View>
            <EventMap
              latitude={event.latitude}
              longitude={event.longitude}
              label={event.location_name}
              height={180}
            />
          </Animated.View>
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.stickyBar}>
        <View style={styles.stickyInner}>
          <View>
            <Text style={styles.stickyPriceLabel}>Starting at</Text>
            <Text style={styles.stickyPrice}>{priceText}</Text>
          </View>
          {isOwner ? (
            <Button
              title="Edit Event"
              icon="create-outline"
              onPress={() => router.push(`/(organizer)/edit/${event.id}` as any)}
              testID="edit-event-btn"
              style={{ flex: 1 }}
            />
          ) : user?.role === "consumer" ? (
            <Button
              title={event.booking_type === "seat_map" ? "Select Seats" : event.booking_type === "time_slot" ? "Pick Slot" : "Book Now"}
              icon="arrow-forward"
              onPress={() => router.push(`/book/${event.id}` as any)}
              testID="book-now-btn"
              style={{ flex: 1 }}
            />
          ) : (
            <Button title="View Only" variant="ghost" disabled style={{ flex: 1 }} />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  heroWrap: {
    width: "100%", height: 340, backgroundColor: colors.surfaceTertiary,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden",
  },
  hero: { width: "100%", height: "100%" },
  heroTop: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(13,11,26,0.6)",
    alignItems: "center", justifyContent: "center",
    marginTop: spacing.sm,
  },
  heroBottom: { position: "absolute", bottom: 20, left: 20, right: 20, gap: 10 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", color: "#FFFFFF", lineHeight: 32 },
  body: { padding: 20, gap: 18 },
  orgRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orgAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.violet,
    alignItems: "center", justifyContent: "center",
  },
  orgAvatarText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  orgLabel: { fontSize: 12, color: colors.muted },
  orgName: { fontSize: 15, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  infoCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, paddingVertical: 4,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 12 },
  infoIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  infoTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  infoSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 12 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  description: { fontSize: 14, lineHeight: 22, color: colors.soft },
  locHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  locName: { flex: 1, fontSize: 14, color: colors.onSurface, fontWeight: "700" },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopColor: colors.border, borderTopWidth: 1,
    ...shadows.floating,
  },
  stickyInner: { flexDirection: "row", alignItems: "center", padding: spacing.lg, gap: spacing.lg },
  stickyPriceLabel: { fontSize: 12, color: colors.muted },
  stickyPrice: { fontFamily: fonts.display, fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
});
