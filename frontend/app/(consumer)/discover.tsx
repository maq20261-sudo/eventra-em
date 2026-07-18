import { useEffect, useState, useCallback } from "react";
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
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { colors, spacing, radius, shadows } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const CATEGORIES = ["All", "Music", "Art", "Tech", "Food", "Sports", "Other"];
const DEFAULT_LOC = { lat: 37.7749, lng: -122.4194, label: "San Francisco (default)" };

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
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [location, setLocation] = useState<{ lat: number; lng: number; label: string }>(DEFAULT_LOC);
  const [locModalOpen, setLocModalOpen] = useState(false);
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
    // Load saved location
    (async () => {
      const savedStr = await storage.getItem<string>("gs_location", "");
      const savedRadius = await storage.getItem<number>("gs_radius", 10);
      if (savedStr) {
        try {
          const parsed = JSON.parse(savedStr);
          if (parsed && parsed.lat && parsed.lng) setLocation(parsed);
        } catch {}
      }
      if (savedRadius) setRadiusKm(savedRadius);
    })();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requestGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      const label = "Your current location";
      const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label };
      setLocation(newLoc);
      await storage.setItem("gs_location", JSON.stringify(newLoc));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.log("GPS error", e);
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
          contentContainerStyle={styles.chipsRow}
        >
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              testID={`chip-${c}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCategory(c);
              }}
              style={[styles.chip, category === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
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
          {events.map((e) => (
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
                {e.is_featured && (
                  <View style={styles.featuredBadge}>
                    <Ionicons name="flame" size={11} color={colors.onBrandPrimary} />
                    <Text style={styles.featuredText}>Featured</Text>
                  </View>
                )}
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

            <Pressable style={styles.gpsBtn} onPress={requestGPS} testID="use-gps-btn">
              <Ionicons name="navigate" size={18} color={colors.brand} />
              <Text style={styles.gpsText}>Use my current location</Text>
            </Pressable>

            <Text style={styles.currentLoc}>{location.label}</Text>

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

const styles = StyleSheet.create({
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
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.lg },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  chipText: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: "500" },
  chipTextActive: { color: colors.surface, fontWeight: "600" },
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
  catBadgeText: { fontSize: 11, color: colors.onSurface, fontWeight: "600" },
  priceBadge: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  priceBadgeText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "700" },
  featuredBadge: {
    position: "absolute", top: 12, left: 90,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  featuredText: { fontSize: 11, color: colors.onBrandPrimary, fontWeight: "700" },
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
