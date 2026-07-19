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
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { spacing, radius, shadows } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { storage } from "@/src/utils/storage";

const CATEGORIES: { key: string; label: string; image: string }[] = [
  { key: "All", label: "All", image: "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Music", label: "Music", image: "https://images.pexels.com/photos/210922/pexels-photo-210922.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Art", label: "Art", image: "https://images.pexels.com/photos/1839919/pexels-photo-1839919.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Tech", label: "Tech", image: "https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Food", label: "Food", image: "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Sports", label: "Sports", image: "https://images.pexels.com/photos/2444852/pexels-photo-2444852.jpeg?auto=compress&cs=tinysrgb&w=400" },
  { key: "Other", label: "Other", image: "https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=400" },
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
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Sticky header */}
      <View style={styles.header}>
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
          {CATEGORIES.map((c) => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`chip-${c.key}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategory(c.key);
                }}
                style={[styles.catCard, active && styles.catCardActive]}
              >
                <Image
                  source={c.image}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                  recyclingKey={c.key}
                />
                <LinearGradient
                  colors={active
                    ? ["rgba(5,150,105,0.35)", "rgba(5,150,105,0.85)"]
                    : ["rgba(17,24,39,0.25)", "rgba(17,24,39,0.75)"]}
                  style={StyleSheet.absoluteFill}
                />
                {active && (
                  <View style={styles.catCheck}>
                    <Ionicons name="checkmark" size={12} color={colors.onBrandPrimary} />
                  </View>
                )}
                <Text style={styles.catCardLabel} numberOfLines={1}>{c.label}</Text>
              </Pressable>
            );
          })}
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
          {featuredEvents.length > 0 && (
            <View style={styles.featuredSection}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="flame" size={16} color="#F59E0B" />
                  <Text style={styles.sectionTitle}>Featured</Text>
                </View>
                <Text style={styles.sectionCount}>{featuredEvents.length} boosted</Text>
              </View>
              <ScrollView
                ref={carouselRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={CAROUSEL_WIDTH + spacing.md}
                decelerationRate="fast"
                contentContainerStyle={styles.carousel}
                onScroll={onCarouselScroll}
                scrollEventThrottle={32}
                onScrollBeginDrag={() => { userInteractingRef.current = true; }}
                onScrollEndDrag={() => {
                  // Resume auto-scroll after 5s of inactivity
                  setTimeout(() => { userInteractingRef.current = false; }, 5000);
                }}
              >
                {featuredEvents.map((e) => (
                  <Pressable
                    key={e.id}
                    testID={`featured-card-${e.id}`}
                    style={styles.featuredCard}
                    onPress={() => router.push(`/event/${e.id}` as any)}
                  >
                    <Image source={e.image_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
                    <LinearGradient
                      colors={["rgba(31,41,55,0.15)", "rgba(31,41,55,0.85)"]}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.featuredTop}>
                      <View style={styles.featuredBadgeBig}>
                        <Ionicons name="flame" size={12} color={colors.onBrandPrimary} />
                        <Text style={styles.featuredBadgeText}>Featured</Text>
                      </View>
                      <View style={styles.featuredPricePill}>
                        <Text style={styles.featuredPriceText}>
                          {e.price > 0 ? `$${e.price.toFixed(0)}` : "Free"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.featuredBottom}>
                      <Text style={styles.featuredCategoryText}>{e.category}</Text>
                      <Text style={styles.featuredTitle} numberOfLines={2}>{e.title}</Text>
                      <View style={styles.featuredMetaRow}>
                        <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.85)" />
                        <Text style={styles.featuredMetaText}>{formatDate(e.date)}</Text>
                        <View style={styles.featuredMetaDot} />
                        <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.85)" />
                        <Text style={styles.featuredMetaText} numberOfLines={1}>
                          {e.distance_km != null ? `${e.distance_km.toFixed(1)}km` : e.location_name}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              {featuredEvents.length > 1 && (
                <View style={styles.dotsRow} testID="carousel-dots">
                  {featuredEvents.map((_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i === carouselIndex && styles.dotActive]}
                    />
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

          {regularEvents.map((e) => (
            <Pressable
              key={e.id}
              testID={`event-card-${e.id}`}
              style={styles.card}
              onPress={() => router.push(`/event/${e.id}` as any)}
            >
              <View style={styles.imgWrap}>
                <Image source={e.image_url} style={styles.img} contentFit="cover" transition={200} />
                <LinearGradient
                  colors={["transparent", "rgba(31,41,55,0.75)"]}
                  style={styles.imgOverlay}
                />
                <View style={styles.catBadge}>
                  <Text style={styles.catBadgeText}>{e.category}</Text>
                </View>
                <View style={styles.priceBadge}>
                  <Text style={styles.priceBadgeText}>
                    {e.price > 0 ? `$${e.price.toFixed(0)}` : "Free"}
                  </Text>
                </View>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>{e.title}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                  <Text style={styles.metaText}>{formatDate(e.date)} · {formatTime(e.date)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="location-outline" size={14} color={colors.muted} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {e.location_name}
                    {e.distance_km != null ? ` · ${e.distance_km.toFixed(1)}km` : ""}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
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
    borderBottomWidth: 1,
  },
  headerRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  greeting: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 4 },
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
  catRow: { gap: spacing.md, paddingVertical: spacing.md, paddingRight: spacing.lg },
  catCard: {
    width: 96, height: 76,
    borderRadius: radius.md,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: spacing.sm,
    flexShrink: 0,
    backgroundColor: "#1F2937",
    ...shadows.card,
  },
  catCardActive: {
    borderWidth: 2, borderColor: colors.brand,
  },
  catCardLabel: {
    color: "#FFFFFF", fontSize: 13, fontWeight: "700",
  },
  catCheck: {
    position: "absolute", top: 6, right: 6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
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
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
    ...shadows.card,
  },
  imgWrap: { height: 200, position: "relative" },
  img: { width: "100%", height: "100%", backgroundColor: colors.surfaceTertiary },
  imgOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, height: 80 },
  catBadge: {
    position: "absolute", top: 12, left: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  catBadgeText: { fontSize: 11, color: "#111827", fontWeight: "600" },
  priceBadge: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  priceBadgeText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "700" },

  // Section headings
  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: spacing.md, marginTop: spacing.sm,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  sectionCount: { fontSize: 12, color: colors.muted, fontWeight: "500" },

  // Featured carousel
  featuredSection: { marginBottom: spacing.lg },
  carousel: { gap: spacing.md, paddingRight: spacing.lg },
  featuredCard: {
    width: CAROUSEL_WIDTH, height: 220,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.floating,
    flexShrink: 0,
    justifyContent: "space-between",
  },
  featuredTop: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    padding: spacing.md,
  },
  featuredBadgeBig: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
  },
  featuredBadgeText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "700" },
  featuredPricePill: {
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
  },
  featuredPriceText: { fontSize: 11, color: "#111827", fontWeight: "700" },
  featuredBottom: { padding: spacing.md, gap: 4 },
  featuredCategoryText: {
    color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  featuredTitle: {
    color: "#FFFFFF", fontSize: 20, fontWeight: "700", lineHeight: 24,
  },
  featuredMetaRow: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4,
  },
  featuredMetaText: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "500" },
  featuredMetaDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.6)", marginHorizontal: 4,
  },
  dotsRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 6, marginTop: spacing.md,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  dotActive: {
    width: 20, backgroundColor: colors.brand,
  },
  cardBody: { padding: spacing.lg, gap: 6 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: colors.onSurface, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, color: colors.muted, flex: 1 },

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
