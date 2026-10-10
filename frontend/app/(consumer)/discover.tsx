import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, Dimensions, Alert, Linking, Platform, AppState } from "react-native";
import { Text, TextInput } from "@/src/ui/Text";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { storage } from "@/src/utils/storage";
import { useQuota } from "@/src/hooks/usePricing";
import { useAuth } from "@/src/AuthContext";
import { eventTypeShortLabel, eventTypeIcon } from "@/src/utils/eventTypeLabel";
import { urgencyOf, goingLabel, type CapacityFields } from "@/src/utils/urgency";
import { areaNameFor, distanceKm } from "@/src/utils/areaName";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { PressableScale } from "@/src/ui/PressableScale";
import { Skeleton, SkeletonCard, SkeletonRow } from "@/src/ui/Skeleton";
import { EmptyState } from "@/src/ui/EmptyState";
import { Tag } from "@/src/ui/Tag";
import { Button } from "@/src/ui/Button";

const CATEGORIES: { key: string; label: string; icon: any; color: string }[] = [
  { key: "All", label: "All", icon: "sparkles-outline", color: "#FF6FA8" },
  { key: "Music", label: "Music", icon: "musical-notes-outline", color: "#B9A2FF" },
  { key: "Art", label: "Art", icon: "color-palette-outline", color: "#FDAA6B" },
  { key: "Tech", label: "Tech", icon: "hardware-chip-outline", color: "#7DD3FC" },
  { key: "Food", label: "Food", icon: "restaurant-outline", color: "#FF8A8A" },
  { key: "Sports", label: "Sports", icon: "basketball-outline", color: "#5EEAD4" },
  { key: "Other", label: "Other", icon: "grid-outline", color: "#CBD5E1" },
];

const DEFAULT_LOC = { lat: 19.076, lng: 72.8777, label: "Mumbai" };
// Re-label the location automatically once the phone is this far away.
const LOCATION_REFRESH_KM = 5;
const MOVE_CHECK_INTERVAL_MS = 10 * 60_000;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CAROUSEL_WIDTH = Math.min(SCREEN_WIDTH - 40, 340);

type Event = CapacityFields & {
  id: string;
  title: string;
  description: string;
  category: string;
  image_url?: string;
  date: string;
  start_date?: string;
  end_date?: string;
  location_name: string;
  latitude: number;
  longitude: number;
  price: number;
  booking_type: string;
  distance_km?: number | null;
  is_featured?: boolean;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function priceLabel(p: number) {
  return p > 0 ? `₹${p.toFixed(0)}` : "Free";
}

/**
 * Round category bubble. Selected → tinted ring, springs up ~6% and the icon
 * does a small wiggle; press → quick squash.
 */
function CategoryBubble({
  icon, label, accent, active, onPress, testID, colors,
}: {
  icon: any;
  label: string;
  accent: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  colors: Colors;
}) {
  const scale = useSharedValue(1);
  const wiggle = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(active ? 1.06 : 1, { damping: 12, stiffness: 220 });
    if (active) {
      wiggle.value = withSequence(
        withTiming(-1, { duration: 90 }),
        withTiming(1, { duration: 120 }),
        withSpring(0, { damping: 10 })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const container = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const iconAnim = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.value * 10}deg` }] }));

  return (
    <Animated.View style={container}>
      <Pressable
        testID={testID}
        onPress={() => {
          scale.value = withSequence(withTiming(0.9, { duration: 80 }), withSpring(active ? 1.06 : 1, { damping: 10, stiffness: 240 }));
          onPress();
        }}
        style={{ alignItems: "center", width: 64 }}
      >
        <View
          style={{
            width: 56, height: 56, borderRadius: 28,
            alignItems: "center", justifyContent: "center",
            backgroundColor: accent + (active ? "33" : "26"),
            borderWidth: active ? 2 : 0,
            borderColor: accent,
          }}
        >
          <Animated.View style={iconAnim}>
            <Ionicons name={icon} size={24} color={accent} />
          </Animated.View>
        </View>
        <Text
          numberOfLines={1}
          style={{ marginTop: 6, fontSize: 12, color: active ? accent : colors.onSurface, fontWeight: active ? "800" : "600" }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function Discover() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [location, setLocation] = useState<{ lat: number; lng: number; label: string }>(DEFAULT_LOC);
  const [locModalOpen, setLocModalOpen] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const { quota } = useQuota(!!user);

  const load = useCallback(async () => {
    try {
      const list = await api.listEvents({
        lat: location.lat,
        lng: location.lng,
        radius_km: radiusKm,
        category,
        search,
      });
      setEvents(list);
    } catch (e) {
      console.log("Discover load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [location, radiusKm, category, search]);

  // Resolve GPS coordinates to the real area name ("Bandra West, Mumbai")
  // and remember it. Falls back to "Near you" if no geocoder answers.
  const applyGpsLocation = useCallback(async (lat: number, lng: number) => {
    const label = await areaNameFor(lat, lng);
    const loc = { lat, lng, label };
    setLocation(loc);
    await storage.setItem("gs_location", JSON.stringify(loc));
  }, []);

  // Auto-refresh when the phone has moved far from the saved location
  // (e.g. the user travelled to another city). Uses the phone's last known
  // position (no new GPS fix, no network) and checks at most every 10 min,
  // on screen focus and when the app returns to the foreground. The area
  // name is only looked up again after a real move — and even then the
  // geocode cache usually answers.
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  const lastMoveCheck = useRef(0);
  const checkMoved = useCallback(async () => {
    if (Platform.OS === "web") return;
    const now = Date.now();
    if (now - lastMoveCheck.current < MOVE_CHECK_INTERVAL_MS) return;
    lastMoveCheck.current = now;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") return; // never prompt from a background check
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      if (!pos) return;
      const cur = locationRef.current;
      const moved = distanceKm(cur.lat, cur.lng, pos.coords.latitude, pos.coords.longitude);
      if (moved >= LOCATION_REFRESH_KM) {
        await applyGpsLocation(pos.coords.latitude, pos.coords.longitude);
      }
    } catch (e) {
      console.log("Location move check failed", e);
    }
  }, [applyGpsLocation]);

  useFocusEffect(useCallback(() => { checkMoved(); }, [checkMoved]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") checkMoved(); });
    return () => sub.remove();
  }, [checkMoved]);

  useEffect(() => {
    // Load saved location; if none saved, silently request current location.
    (async () => {
      const savedStr = await storage.getItem<string>("gs_location", "");
      const savedRadius = await storage.getItem<number>("gs_radius", 10);
      if (savedRadius) setRadiusKm(savedRadius);

      if (savedStr) {
        try {
          const parsed = JSON.parse(savedStr);
          if (parsed && parsed.lat && parsed.lng) {
            setLocation(parsed);
            // Older saves stored a generic label — upgrade it to the real area name.
            if (!parsed.label || parsed.label === "Your current location") {
              applyGpsLocation(parsed.lat, parsed.lng);
            }
            return;
          }
        } catch {}
      }

      // No saved location — try to auto-detect on first launch (silent)
      try {
        if (Platform.OS === "web") {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => { applyGpsLocation(pos.coords.latitude, pos.coords.longitude); },
              () => { /* silent fallback to DEFAULT_LOC */ },
              { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
            );
          }
          return;
        }

        const perm = await Location.getForegroundPermissionsAsync();
        let status = perm.status;
        if (status !== "granted" && perm.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          status = req.status;
        }
        if (status !== "granted") return; // silent fallback to DEFAULT_LOC
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await applyGpsLocation(pos.coords.latitude, pos.coords.longitude);
      } catch (e) {
        console.log("Auto-locate failed", e);
      }
    })();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requestGPS = async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    try {
      // Web fallback — expo-location has limited support on web
      if (Platform.OS === "web") {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          Alert.alert("Not supported", "Location is not available in this environment. Please use the Expo Go app or a device build to use your current location.");
          return;
        }
        const pos: GeolocationPosition = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        });
        await applyGpsLocation(pos.coords.latitude, pos.coords.longitude);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }

      const perm = await Location.getForegroundPermissionsAsync();
      let status = perm.status;
      let canAskAgain = perm.canAskAgain;

      if (status !== "granted") {
        if (canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          status = req.status;
          canAskAgain = req.canAskAgain;
        }
      }

      if (status !== "granted") {
        Alert.alert(
          "Location permission needed",
          "We need your location to show events nearby. Enable location access from settings.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await applyGpsLocation(pos.coords.latitude, pos.coords.longitude);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.log("GPS error", e);
      Alert.alert("Couldn't get location", "Please check that location services are enabled on your device and try again.");
    } finally {
      setGpsLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const saveRadius = async (r: number) => {
    setRadiusKm(r);
    await storage.setItem("gs_radius", r);
    Haptics.selectionAsync();
  };

  const { featuredEvents, regularEvents } = useMemo(() => {
    const featured = events.filter((e) => e.is_featured);
    const regular = events.filter((e) => !e.is_featured);
    return { featuredEvents: featured, regularEvents: regular };
  }, [events]);

  // Featured carousel auto-scroll state
  const carouselRef = useRef<ScrollView>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const userInteractingRef = useRef(false);
  const CAROUSEL_ITEM_STEP = CAROUSEL_WIDTH + spacing.md;

  useEffect(() => {
    if (featuredEvents.length <= 1) return;
    const timer = setInterval(() => {
      if (userInteractingRef.current) return;
      setCarouselIndex((prev) => {
        const next = (prev + 1) % featuredEvents.length;
        carouselRef.current?.scrollTo({ x: next * CAROUSEL_ITEM_STEP, animated: true });
        return next;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [featuredEvents.length, CAROUSEL_ITEM_STEP]);

  const onCarouselScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / CAROUSEL_ITEM_STEP);
    if (idx !== carouselIndex && idx >= 0 && idx < featuredEvents.length) {
      setCarouselIndex(idx);
    }
  };

  const initial = (user?.name || "?").trim().charAt(0).toUpperCase();
  const att = quota?.attendee;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <GlowBackground />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        {/* Header: location + radius, avatar */}
        <View style={styles.headerRow}>
          <PressableScale style={styles.locBtn} onPress={() => setLocModalOpen(true)} testID="location-pill">
            <View style={styles.locIcon}>
              <Ionicons name="location" size={16} color={colors.brand} />
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.locEyebrow}>Events near</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={styles.locText} numberOfLines={1}>
                  {location.label} · {radiusKm} km
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.muted} />
              </View>
            </View>
          </PressableScale>
          <PressableScale style={styles.avatar} onPress={() => router.push("/(consumer)/profile" as any)} accessibilityLabel="Profile">
            <Text style={styles.avatarText}>{initial}</Text>
          </PressableScale>
        </View>

        <Text style={styles.h1}>
          Where's the <Text style={{ color: colors.brand, fontFamily: fonts.display, fontWeight: "800" }}>vibe</Text>{"\n"}tonight?
        </Text>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            testID="search-input"
            style={styles.searchInput}
            placeholder="Search events"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={load}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow} style={styles.catScroll}>
          {CATEGORIES.map((c) => (
            <CategoryBubble
              key={c.key}
              testID={`chip-${c.key}`}
              icon={c.icon}
              label={c.label}
              accent={c.color}
              active={category === c.key}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCategory(c.key);
              }}
              colors={colors}
            />
          ))}
        </ScrollView>

        {/* Free-tier offer banner — shown above the feed so it's visible even
            when the feed is empty (fresh users need to see the perk first). */}
        {att && att.free_bookings_remaining > 0 && !loading && (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.offerBanner} testID="offer-banner">
            <View style={styles.offerIcon}>
              <Ionicons name="gift" size={20} color={colors.onLime} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.offerTitle}>Your first {att.free_booking_limit} bookings are FREE</Text>
              <Text style={styles.offerSub}>
                {att.free_bookings_remaining} of {att.free_booking_limit} free booking{att.free_bookings_remaining === 1 ? "" : "s"} left · no platform fee
              </Text>
            </View>
          </Animated.View>
        )}

        {loading ? (
          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            <Skeleton width={120} height={18} />
            <SkeletonCard height={210} />
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : events.length === 0 ? (
          <EmptyState
            icon="map-outline"
            title="No events in your area"
            subtitle="Try expanding your radius or changing category."
            actionLabel="Adjust radius"
            onAction={() => setLocModalOpen(true)}
            actionTestID="expand-radius-btn"
          />
        ) : (
          <>
            {featuredEvents.length > 0 && (
              <View>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="flame" size={16} color={colors.warning} />
                    <Text style={styles.sectionTitle}>Featured</Text>
                  </View>
                  <Text style={styles.sectionCount}>{featuredEvents.length} boosted</Text>
                </View>
                <ScrollView
                  ref={carouselRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={CAROUSEL_ITEM_STEP}
                  decelerationRate="fast"
                  contentContainerStyle={styles.carousel}
                  style={styles.carouselScroll}
                  onScroll={onCarouselScroll}
                  scrollEventThrottle={32}
                  onScrollBeginDrag={() => { userInteractingRef.current = true; }}
                  onScrollEndDrag={() => {
                    // Resume auto-scroll after 5s of inactivity
                    setTimeout(() => { userInteractingRef.current = false; }, 5000);
                  }}
                >
                  {featuredEvents.map((e) => {
                    const urg = urgencyOf(e);
                    const going = goingLabel(e);
                    return (
                      <PressableScale
                        key={e.id}
                        testID={`featured-card-${e.id}`}
                        style={styles.featuredCard}
                        onPress={() => router.push(`/event/${e.id}` as any)}
                      >
                        <Image source={e.image_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
                        <LinearGradient
                          colors={["rgba(13,11,26,0.15)", "rgba(13,11,26,0)", "rgba(13,11,26,0.92)"]}
                          locations={[0, 0.35, 1]}
                          style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.featuredTop}>
                          <Tag label="FEATURED" tone="lime" icon="flame" />
                          <Tag label={priceLabel(e.price)} tone="dark" />
                        </View>
                        <View style={styles.featuredBottom}>
                          <View style={{ flexDirection: "row", gap: 6, marginBottom: 2 }}>
                            {urg ? <Tag label={urg.label} tone={urg.tone} /> : null}
                            {going ? <Tag label={going} tone="dark" icon="people" /> : null}
                          </View>
                          <Text style={styles.featuredCategory}>{e.category}</Text>
                          <Text style={styles.featuredTitle} numberOfLines={2}>{e.title}</Text>
                          <Text style={styles.featuredMeta} numberOfLines={1}>
                            {formatDate(e.start_date || e.date)} · {e.distance_km != null ? `${e.distance_km.toFixed(1)} km` : e.location_name}
                          </Text>
                        </View>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
                {featuredEvents.length > 1 && (
                  <View style={styles.dotsRow} testID="carousel-dots">
                    {featuredEvents.map((_, i) => (
                      <View key={i} style={[styles.dot, i === carouselIndex && styles.dotActive]} />
                    ))}
                  </View>
                )}
              </View>
            )}

            {regularEvents.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>All events</Text>
                <Text style={styles.sectionCount}>{regularEvents.length} near you</Text>
              </View>
            )}

            {regularEvents.map((e, i) => {
              const urg = urgencyOf(e);
              const going = goingLabel(e);
              const when = e.start_date || e.date;
              return (
                <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 8) * 50).duration(380)}>
                  <PressableScale
                    testID={`event-card-${e.id}`}
                    style={styles.card}
                    onPress={() => router.push(`/event/${e.id}` as any)}
                  >
                    <View style={styles.thumbWrap}>
                      <Image source={e.image_url} style={styles.thumb} contentFit="cover" transition={200} />
                      <View style={styles.thumbDate}>
                        <Text style={styles.thumbDateText}>
                          {new Date(when).toLocaleDateString("en-US", { day: "numeric", month: "short" }).toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardCategory}>{e.category}</Text>
                      <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {formatDate(when)} · {formatTime(when)}
                      </Text>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {e.location_name}
                        {e.distance_km != null ? ` · ${e.distance_km.toFixed(1)} km` : ""}
                      </Text>
                      <View style={styles.cardFooter}>
                        <Text style={styles.price}>{priceLabel(e.price)}</Text>
                        <View style={styles.typeChip} testID={`event-type-chip-${e.id}`}>
                          <Ionicons name={eventTypeIcon(e.booking_type) as any} size={11} color={colors.violetText} />
                          <Text style={styles.typeChipText}>{eventTypeShortLabel(e.booking_type)}</Text>
                        </View>
                        {urg ? (
                          <Tag label={urg.label} tone={urg.tone} />
                        ) : going ? (
                          <Text style={styles.going}>{going}</Text>
                        ) : null}
                      </View>
                    </View>
                  </PressableScale>
                </Animated.View>
              );
            })}
          </>
        )}
        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* Location & radius sheet */}
      <Modal visible={locModalOpen} animationType="slide" transparent onRequestClose={() => setLocModalOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setLocModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.sheetTitle}>Location & Radius</Text>
              <Pressable onPress={() => setLocModalOpen(false)} style={styles.iconBtn} accessibilityLabel="Close" hitSlop={6}>
                <Ionicons name="close" size={18} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.locInfoRow}>
              <View style={styles.locInfoIcon}>
                <Ionicons name="location" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locInfoLabel}>Current location</Text>
                <Text style={styles.locInfoValue} numberOfLines={1}>{location.label}</Text>
              </View>
              <Pressable onPress={requestGPS} testID="refresh-gps-btn" disabled={gpsLoading} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Use my current location">
                {gpsLoading ? (
                  <ActivityIndicator size="small" color={colors.lime} />
                ) : (
                  <Ionicons name="locate" size={18} color={colors.lime} />
                )}
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.sm }}>
              <Text style={styles.radiusLabel}>Search radius</Text>
              <Text style={styles.radiusValue}>{radiusKm} km</Text>
            </View>
            <View style={styles.radiusRow}>
              {[5, 10, 25, 50, 100].map((r) => (
                <PressableScale
                  key={r}
                  testID={`radius-${r}`}
                  style={[styles.radiusChip, radiusKm === r && styles.radiusChipActive]}
                  onPress={() => saveRadius(r)}
                >
                  <Text style={[styles.radiusChipText, radiusKm === r && styles.radiusChipTextActive]}>
                    {r} km
                  </Text>
                </PressableScale>
              ))}
            </View>

            <Button title="Done" onPress={() => setLocModalOpen(false)} testID="loc-done-btn" style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  page: { paddingHorizontal: 20, paddingTop: spacing.md, gap: 14 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  locBtn: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, minHeight: 44 },
  locIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  locEyebrow: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },
  locText: { fontSize: 16, color: colors.onSurface, fontWeight: "800", maxWidth: 230 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },

  h1: { fontFamily: fonts.display, fontWeight: "800", fontSize: 26, lineHeight: 32, color: colors.onSurface, letterSpacing: -0.3 },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface, fontWeight: "500" },

  catScroll: { marginHorizontal: -20 },
  catRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },

  offerBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.lime + "1F",
    borderWidth: 1, borderColor: colors.lime + "59",
    borderRadius: 18, padding: spacing.md,
  },
  offerIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.lime,
  },
  offerTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  offerSub: { color: colors.soft, fontSize: 12, marginTop: 2 },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  sectionCount: { fontSize: 13, color: colors.muted, fontWeight: "700" },

  carouselScroll: { marginHorizontal: -20, marginTop: spacing.md },
  carousel: { gap: spacing.md, paddingHorizontal: 20, paddingBottom: 18 },
  featuredCard: {
    width: CAROUSEL_WIDTH, height: 220,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
    justifyContent: "space-between",
    ...shadows.glow,
  },
  featuredTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 12 },
  featuredBottom: { padding: 14, gap: 3 },
  featuredCategory: { color: colors.accentText, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  featuredTitle: { fontFamily: fonts.display, color: "#FFFFFF", fontSize: 18, fontWeight: "700", lineHeight: 23 },
  featuredMeta: { color: "#CFC9EA", fontSize: 12, fontWeight: "600" },
  dotsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotActive: { width: 18, backgroundColor: colors.brand },

  card: {
    flexDirection: "row", gap: 12, alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 20, padding: 10,
  },
  thumbWrap: { width: 88, height: 104, borderRadius: 14, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  thumb: { width: "100%", height: "100%" },
  thumbDate: {
    position: "absolute", left: 5, bottom: 5,
    backgroundColor: colors.lime, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  thumbDateText: { color: colors.onLime, fontSize: 10, fontWeight: "800" },
  cardBody: { flex: 1, gap: 3 },
  cardCategory: { fontSize: 10, color: colors.accentText, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  metaText: { fontSize: 12, color: colors.muted },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  price: { fontSize: 14, fontWeight: "800", color: colors.lime },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  typeChipText: { fontSize: 11, color: colors.violetText, fontWeight: "700" },
  going: { fontSize: 11, color: colors.soft, fontWeight: "700" },

  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1, borderColor: colors.border,
    padding: spacing.xl,
    paddingTop: 12,
    paddingBottom: 40,
    gap: spacing.md,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "700", color: colors.onSurface },
  iconBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  locInfoRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, borderRadius: 18,
  },
  locInfoIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.brand + "29",
    alignItems: "center", justifyContent: "center",
  },
  locInfoLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "700" },
  locInfoValue: { fontSize: 15, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  radiusLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  radiusValue: { fontFamily: fonts.display, fontSize: 20, fontWeight: "800", color: colors.brand },
  radiusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  radiusChip: {
    paddingHorizontal: spacing.lg, height: 40, justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  radiusChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  radiusChipText: { fontSize: 13, color: colors.onSurface, fontWeight: "700" },
  radiusChipTextActive: { color: colors.onBrandPrimary, fontWeight: "800" },
});
