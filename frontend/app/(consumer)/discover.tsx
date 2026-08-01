import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Dimensions,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withRepeat,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { storage } from "@/src/utils/storage";

const CATEGORIES: { key: string; label: string; icon: any; color: string }[] = [
  { key: "All", label: "All", icon: "sparkles-outline", color: "#F84464" },
  { key: "Music", label: "Music", icon: "musical-notes-outline", color: "#8B5CF6" },
  { key: "Art", label: "Art", icon: "color-palette-outline", color: "#F97316" },
  { key: "Tech", label: "Tech", icon: "hardware-chip-outline", color: "#0EA5E9" },
  { key: "Food", label: "Food", icon: "restaurant-outline", color: "#EF4444" },
  { key: "Sports", label: "Sports", icon: "basketball-outline", color: "#14B8A6" },
  { key: "Other", label: "Other", icon: "grid-outline", color: "#64748B" },
];

const DEFAULT_LOC = { lat: 37.7749, lng: -122.4194, label: "San Francisco (default)" };

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CAROUSEL_WIDTH = Math.min(SCREEN_WIDTH - 48, 320);

type Event = {
  id: string;
  title: string;
  description: string;
  category: string;
  image_url?: string;
  date: string;
  location_name: string;
  latitude: number;
  longitude: number;
  price: number;
  booking_type: string;
  distance_km?: number | null;
  is_featured?: boolean;
  booked_count?: number;
  total_seats?: number | null;
  seat_rows?: number | null;
  seat_cols?: number | null;
  time_slots?: string[] | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

/**
 * Compute an optional "hot ribbon" for an event card.
 * Priority: LIVE (starts within 2h or already started but < 12h ago) > SELLING FAST (>75% booked).
 */
function computeRibbon(e: Event): { label: string; color: string } | null {
  try {
    const now = Date.now();
    const start = new Date(e.date).getTime();
    const diffH = (start - now) / (1000 * 60 * 60);
    if (diffH > -12 && diffH <= 2) {
      return { label: "LIVE", color: "#EF4444" };
    }
    // Capacity
    let capacity = 0;
    if (e.booking_type === "seat_map") capacity = (e.seat_rows || 0) * (e.seat_cols || 0);
    else if (e.booking_type === "general") capacity = e.total_seats || 0;
    else if (e.booking_type === "time_slot") capacity = (e.time_slots || []).length;
    if (capacity > 0) {
      const ratio = (e.booked_count || 0) / capacity;
      if (ratio >= 0.75) return { label: "SELLING FAST", color: "#F97316" };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Animated category chip in BookMyShow style — a clean icon-first tile.
 * Behaviour:
 *   - Idle → soft surface with subtle shadow.
 *   - Selected → scales up ~6%, gets a colored border + halo, icon flips to accent color.
 *   - On press → quick scale-down bounce for tactile feedback.
 *   - When newly selected → icon does a small rotation "wiggle".
 */
function CategoryChip({
  icon, label, accent, active, onPress, testID, styles, colors,
}: {
  icon: any;
  label: string;
  accent: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  styles: any;
  colors: Colors;
}) {
  const scale = useSharedValue(1);
  const highlight = useSharedValue(active ? 1 : 0);
  const wiggle = useSharedValue(0);

  useEffect(() => {
    highlight.value = withTiming(active ? 1 : 0, { duration: 220 });
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

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const bgStyle = useAnimatedStyle(() => {
    const bg = interpolate(highlight.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    return {
      backgroundColor: bg > 0.5 ? accent + "1A" /* ~10% tint */ : colors.surfaceSecondary,
      borderColor: bg > 0.5 ? accent : "transparent",
    };
  });

  const iconAnim = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${wiggle.value * 8}deg` },
      { scale: interpolate(highlight.value, [0, 1], [1, 1.1], Extrapolation.CLAMP) },
    ],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(0.92, { duration: 80 }),
      withSpring(active ? 1.06 : 1, { damping: 10, stiffness: 240 })
    );
    onPress();
  };

  const iconColor = active ? accent : colors.onSurface;

  return (
    <Animated.View
      style={[
        styles.chipShadow,
        containerStyle,
        active && {
          // Colored halo on the selected chip. Applied on the OUTER wrapper
          // only — putting shadow/elevation on the inner card too caused a
          // double-elevation artifact on some Android GPUs (a solid white
          // rectangle behind semi-transparent icon pixels).
          shadowColor: accent,
          shadowOpacity: 0.55,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 12,
        },
      ]}
    >
      <Pressable onPress={handlePress} testID={testID} style={styles.chipPress}>
        <Animated.View style={[styles.chipCard, bgStyle]}>
          <Animated.View style={[iconAnim, { backgroundColor: "transparent" }]}>
            <Ionicons name={icon} size={30} color={iconColor} />
          </Animated.View>
        </Animated.View>
        <Text
          style={[styles.chipLabel, active && { color: accent, fontWeight: "700" }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Tall movie-poster style card used in every horizontal shelf.
 * ~168×240px with a bottom gradient overlay carrying title + price + meta.
 */
function PosterCard({
  event, onPress, badge, badgeColor, styles, colors,
}: {
  event: Event;
  onPress: () => void;
  badge?: string;
  badgeColor?: string;
  styles: any;
  colors: Colors;
}) {
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPressIn = () => { scale.value = withSpring(0.96, { damping: 12 }); };
  const onPressOut = () => { scale.value = withSpring(1, { damping: 10 }); };

  const ribbon = computeRibbon(event);

  useEffect(() => {
    if (ribbon) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 700 }),
          withTiming(0, { duration: 700 })
        ),
        -1,
        false
      );
    } else {
      pulse.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ribbon]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.7, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.06], Extrapolation.CLAMP) }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [1, 0.4], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.35], Extrapolation.CLAMP) }],
  }));

  return (
    <Animated.View style={[styles.posterShadow, animStyle]}>
      <Pressable
        testID={`poster-${event.id}`}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.posterCard}
      >
        <Image
          source={event.image_url || undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={event.id}
        />
        <LinearGradient
          colors={["rgba(15,23,42,0.05)", "rgba(15,23,42,0.85)"]}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
        />
        {badge && (
          <View style={[styles.posterBadge, { backgroundColor: badgeColor || colors.brandPrimary }]}>
            <Text style={styles.posterBadgeText}>{badge}</Text>
          </View>
        )}
        {ribbon && (
          <Animated.View style={[styles.posterRibbon, { backgroundColor: ribbon.color }, pulseStyle]}>
            <Animated.View style={[styles.ribbonDot, dotStyle]} />
            <Text style={styles.ribbonText}>{ribbon.label}</Text>
          </Animated.View>
        )}
        <View style={styles.posterPricePill}>
          <Text style={styles.posterPriceText}>
            {event.price > 0 ? `₹${event.price.toFixed(0)}` : "FREE"}
          </Text>
        </View>
        <View style={styles.posterBottom}>
          <Text style={styles.posterCategory}>{event.category.toUpperCase()}</Text>
          <Text style={styles.posterTitle} numberOfLines={2}>{event.title}</Text>
          <View style={styles.posterMetaRow}>
            <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.85)" />
            <Text style={styles.posterMetaText} numberOfLines={1}>{formatDate(event.date)}</Text>
            {event.distance_km != null && (
              <>
                <View style={styles.posterMetaDot} />
                <Text style={styles.posterMetaText}>{event.distance_km.toFixed(1)}km</Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A labeled horizontal shelf that carries a title, small subtitle, and a
 * horizontally scrollable row of PosterCards.
 */
function Shelf({
  title, subtitle, icon, iconColor, items, onPress, styles, colors, badge, badgeColor,
}: {
  title: string;
  subtitle?: string;
  icon?: any;
  iconColor?: string;
  items: Event[];
  onPress: (e: Event) => void;
  styles: any;
  colors: Colors;
  badge?: string;
  badgeColor?: string;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.shelfWrap}>
      <View style={styles.shelfHeader}>
        <View style={styles.shelfTitleRow}>
          {icon && <Ionicons name={icon} size={16} color={iconColor || colors.brand} />}
          <Text style={styles.shelfTitle}>{title}</Text>
        </View>
        {subtitle && <Text style={styles.shelfSubtitle}>{subtitle}</Text>}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelfRow}
        decelerationRate="fast"
      >
        {items.map((e) => (
          <PosterCard
            key={e.id}
            event={e}
            onPress={() => onPress(e)}
            badge={badge}
            badgeColor={badgeColor}
            styles={styles}
            colors={colors}
          />
        ))}
      </ScrollView>
    </View>
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
            return;
          }
        } catch {}
      }

      // No saved location — try to auto-detect on first launch (silent)
      try {
        if (Platform.OS === "web") {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your current location" };
                setLocation(newLoc);
                storage.setItem("gs_location", JSON.stringify(newLoc));
              },
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
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your current location" };
        setLocation(newLoc);
        await storage.setItem("gs_location", JSON.stringify(newLoc));
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
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your current location" };
        setLocation(newLoc);
        await storage.setItem("gs_location", JSON.stringify(newLoc));
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
      const label = "Your current location";
      const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label };
      setLocation(newLoc);
      await storage.setItem("gs_location", JSON.stringify(newLoc));
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

  const { featuredEvents, tonightEvents, weekendEvents, freeEvents, otherEvents } = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // "This weekend" = upcoming Sat + Sun (relative to today)
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const daysToSat = (6 - day + 7) % 7;
    const satStart = new Date(now);
    satStart.setDate(now.getDate() + daysToSat);
    satStart.setHours(0, 0, 0, 0);
    const sunEnd = new Date(satStart);
    sunEnd.setDate(satStart.getDate() + 1);
    sunEnd.setHours(23, 59, 59, 999);

    const featured: Event[] = [];
    const tonight: Event[] = [];
    const weekend: Event[] = [];
    const free: Event[] = [];
    const other: Event[] = [];
    const seen = new Set<string>();

    // 1. Featured always goes to featured shelf.
    for (const e of events) {
      if (e.is_featured) {
        featured.push(e);
        seen.add(e.id);
      }
    }
    // 2. Tonight (starts today, in the future).
    for (const e of events) {
      if (seen.has(e.id)) continue;
      const d = new Date(e.date);
      if (d >= now && d <= todayEnd) {
        tonight.push(e);
        seen.add(e.id);
      }
    }
    // 3. This weekend.
    for (const e of events) {
      if (seen.has(e.id)) continue;
      const d = new Date(e.date);
      if (d >= satStart && d <= sunEnd) {
        weekend.push(e);
        seen.add(e.id);
      }
    }
    // 4. Free & popular (unclaimed).
    for (const e of events) {
      if (seen.has(e.id)) continue;
      if ((e.price || 0) === 0) {
        free.push(e);
        seen.add(e.id);
      }
    }
    // 5. Everything else.
    for (const e of events) {
      if (seen.has(e.id)) continue;
      other.push(e);
    }
    return {
      featuredEvents: featured,
      tonightEvents: tonight,
      weekendEvents: weekend,
      freeEvents: free,
      otherEvents: other,
    };
  }, [events]);

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.key === category) || CATEGORIES[0],
    [category]
  );

  // Header tint hex → rgba with alpha for the wash behind the header.
  const headerTint = useMemo(() => {
    const hex = activeCategory.color.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.22)`;
  }, [activeCategory]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Sticky header — background wash tinted by the selected category */}
      <View style={styles.header}>
        <LinearGradient
          colors={[headerTint, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          pointerEvents="none"
        />
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Discover</Text>
            <Pressable
              style={styles.locPill}
              onPress={() => setLocModalOpen(true)}
              testID="location-pill"
            >
              <Ionicons name="location" size={14} color={colors.brand} />
              <Text style={styles.locText} numberOfLines={1}>
                {location.label} · {radiusKm}km
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.muted} />
            </Pressable>
          </View>
        </View>

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
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
        >
          {CATEGORIES.map((c) => (
            <CategoryChip
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
              styles={styles}
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={64} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No events in your area</Text>
          <Text style={styles.emptySub}>Try expanding your radius or changing category.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => setLocModalOpen(true)} testID="expand-radius-btn">
            <Text style={styles.emptyBtnText}>Adjust radius</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          showsVerticalScrollIndicator={false}
        >
          <Shelf
            title="Featured"
            subtitle={featuredEvents.length > 0 ? `${featuredEvents.length} boosted` : undefined}
            icon="flame"
            iconColor="#F59E0B"
            items={featuredEvents}
            onPress={(e) => router.push(`/event/${e.id}` as any)}
            styles={styles}
            colors={colors}
            badge="FEATURED"
            badgeColor="#F59E0B"
          />

          <Shelf
            title="Happening tonight"
            subtitle={tonightEvents.length > 0 ? `${tonightEvents.length} tonight` : undefined}
            icon="moon"
            iconColor="#8B5CF6"
            items={tonightEvents}
            onPress={(e) => router.push(`/event/${e.id}` as any)}
            styles={styles}
            colors={colors}
            badge="TONIGHT"
            badgeColor="#8B5CF6"
          />

          <Shelf
            title="This weekend"
            subtitle={weekendEvents.length > 0 ? `${weekendEvents.length} events` : undefined}
            icon="sunny"
            iconColor="#F97316"
            items={weekendEvents}
            onPress={(e) => router.push(`/event/${e.id}` as any)}
            styles={styles}
            colors={colors}
          />

          <Shelf
            title="Free & popular"
            subtitle={freeEvents.length > 0 ? "No ticket, just come" : undefined}
            icon="pricetag"
            iconColor="#10B981"
            items={freeEvents}
            onPress={(e) => router.push(`/event/${e.id}` as any)}
            styles={styles}
            colors={colors}
          />

          <Shelf
            title="More near you"
            subtitle={otherEvents.length > 0 ? `${otherEvents.length} events` : undefined}
            icon="location"
            iconColor={colors.brand}
            items={otherEvents}
            onPress={(e) => router.push(`/event/${e.id}` as any)}
            styles={styles}
            colors={colors}
          />

          <View style={{ height: spacing["2xl"] }} />
        </ScrollView>
      )}

      {/* Location & radius modal */}
      <Modal visible={locModalOpen} animationType="slide" transparent onRequestClose={() => setLocModalOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setLocModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Location & Radius</Text>

            <View style={styles.locInfoRow}>
              <View style={styles.locInfoIcon}>
                <Ionicons name="location" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locInfoLabel}>Current location</Text>
                <Text style={styles.locInfoValue} numberOfLines={1}>{location.label}</Text>
              </View>
              <Pressable onPress={requestGPS} testID="refresh-gps-btn" disabled={gpsLoading} style={styles.locRefreshBtn} hitSlop={8}>
                {gpsLoading ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Ionicons name="refresh" size={18} color={colors.brand} />
                )}
              </Pressable>
            </View>

            <Text style={styles.radiusLabel}>Search radius</Text>
            <View style={styles.radiusRow}>
              {[5, 10, 25, 50, 100].map((r) => (
                <Pressable
                  key={r}
                  testID={`radius-${r}`}
                  style={[styles.radiusChip, radiusKm === r && styles.radiusChipActive]}
                  onPress={() => saveRadius(r)}
                >
                  <Text style={[styles.radiusChipText, radiusKm === r && styles.radiusChipTextActive]}>
                    {r} km
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={styles.doneBtn} onPress={() => setLocModalOpen(false)} testID="loc-done-btn">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  headerRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  greeting: { fontSize: 32, fontWeight: "800", color: colors.onSurface, marginBottom: 4, letterSpacing: -0.6 },
  locPill: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
  },
  locText: { fontSize: 13, color: colors.onSurfaceTertiary, maxWidth: 260 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
    marginTop: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  catRow: { gap: spacing.md, paddingVertical: spacing.md, paddingRight: spacing.lg, alignItems: "flex-start" },
  chipShadow: {
    // Outer wrapper carries the shadow only (Android RN #30039 workaround).
    alignItems: "center",
    width: 76,
  },
  chipPress: {
    alignItems: "center",
  },
  chipCard: {
    width: 64, height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    backgroundColor: colors.surfaceSecondary,
    ...shadows.card,
  },
  chipLabel: {
    marginTop: 8,
    fontSize: 12,
    color: colors.onSurface,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: 76,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: "center" },
  emptyBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.pill,
  },
  emptyBtnText: { color: colors.onBrandPrimary, fontWeight: "600" },
  list: { padding: spacing.lg, gap: spacing.lg },

  // --- Netflix-style shelves ---
  shelfWrap: { marginBottom: spacing.md },
  shelfHeader: {
    marginBottom: spacing.md,
    paddingHorizontal: 2,
  },
  shelfTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  shelfTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.3 },
  shelfSubtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  shelfRow: { gap: spacing.md, paddingRight: spacing.lg },
  posterShadow: {
    borderRadius: radius.lg,
    ...shadows.card,
  },
  posterCard: {
    width: 168, height: 240,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
  },
  posterBadge: {
    position: "absolute", top: 10, left: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  posterBadgeText: {
    color: "#FFFFFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.5,
  },
  posterRibbon: {
    position: "absolute", bottom: 96, left: 10,
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  ribbonDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  ribbonText: {
    color: "#FFFFFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.6,
  },
  posterPricePill: {
    position: "absolute", top: 10, right: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  posterPriceText: {
    color: "#FFFFFF", fontSize: 11, fontWeight: "700",
  },
  posterBottom: {
    position: "absolute", left: 12, right: 12, bottom: 12, gap: 3,
  },
  posterCategory: {
    color: "rgba(255,255,255,0.75)", fontSize: 9, fontWeight: "700",
    letterSpacing: 0.6,
  },
  posterTitle: {
    color: "#FFFFFF", fontSize: 15, fontWeight: "700", lineHeight: 18,
  },
  posterMetaRow: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4,
  },
  posterMetaText: {
    color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "500",
  },
  posterMetaDot: {
    width: 2, height: 2, borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.6)", marginHorizontal: 3,
  },

  modalBg: {
    flex: 1, backgroundColor: "rgba(17,24,39,0.5)", justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: 48,
    gap: spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong,
    alignSelf: "center",
  },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  gpsBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    padding: spacing.md, borderRadius: radius.md,
  },
  gpsText: { color: colors.onBrandTertiary, fontWeight: "600" },
  currentLoc: { fontSize: 14, color: colors.muted },
  locInfoRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    padding: spacing.md, borderRadius: radius.md,
  },
  locInfoIcon: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  locInfoLabel: { fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  locInfoValue: { fontSize: 14, color: colors.onSurface, fontWeight: "600", marginTop: 2 },
  locRefreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  radiusLabel: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: "500", marginTop: spacing.sm },
  radiusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  radiusChip: {
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radiusChipActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  radiusChipText: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: "500" },
  radiusChipTextActive: { color: colors.surface, fontWeight: "600" },
  doneBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill, paddingVertical: 14, alignItems: "center",
  },
  doneText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },
});
