import { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { spacing, radius } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

// Session token — one per search session per Google Places billing rules.
// Reset after each successful selection so the next search starts a new
// session. See:
// https://developers.google.com/maps/documentation/places/web-service/using-session-tokens
const newSessionToken = () =>
  `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type PickedLocation = {
  name: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  place_id?: string;
};

type Props = {
  value: {
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  onChange: (picked: PickedLocation) => void;
  /** Whether to automatically ask for location permission on mount and
   *  set the picker default to the user's current location. */
  autoUseCurrent?: boolean;
  testID?: string;
};

/** Search-first location picker. Types to search Google Places → picks
 * a suggestion → fills lat/lng + human-readable name. Also shows a
 * "Use my current location" shortcut and (when `autoUseCurrent`) will
 * attempt to auto-fill using the device GPS on first mount. */
export default function LocationSearchField({ value, onChange, autoUseCurrent = true, testID }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [query, setQuery] = useState(value.name || "");
  const [suggestions, setSuggestions] = useState<{ place_id: string; description: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [permBlocked, setPermBlocked] = useState(false);
  const [focused, setFocused] = useState(false);
  const sessionToken = useRef(newSessionToken());
  const requestId = useRef(0);
  const debounceTimer = useRef<any>(null);
  const autoTried = useRef(false);

  // Keep the visible text in sync when the parent hydrates (edit-mode).
  useEffect(() => { if (value.name && !focused) setQuery(value.name); }, [value.name, focused]);

  const fetchCurrentLocation = useCallback(async (silent = false) => {
    setGpsLoading(true);
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      let status = perm.status;
      let canAsk = perm.canAskAgain;
      if (status !== "granted") {
        if (!canAsk) { setPermBlocked(true); setGpsLoading(false); return; }
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status; canAsk = req.canAskAgain;
        if (status !== "granted") {
          if (!canAsk) setPermBlocked(true);
          setGpsLoading(false);
          return;
        }
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      // Try device-side reverse geocode first (free, no API call).
      let name = "";
      let address = "";
      try {
        const results = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (results && results[0]) {
          const r = results[0];
          name = r.name || r.street || r.district || r.city || "My location";
          address = [r.name, r.street, r.district, r.city, r.region, r.country]
            .filter(Boolean).join(", ");
        }
      } catch { /* fallback below */ }
      if (!address) {
        // Server-side reverse geocode via Google as a fallback.
        try {
          const rg = await api.reverseGeocode({ latitude, longitude });
          address = rg?.formatted_address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          name = rg?.name || name || "My location";
        } catch {
          address = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          name = name || "My location";
        }
      }
      const picked: PickedLocation = {
        name,
        formatted_address: address,
        latitude, longitude,
      };
      onChange(picked);
      setQuery(name);
      if (!silent) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // silent; user can search manually.
    } finally {
      setGpsLoading(false);
    }
  }, [onChange]);

  // Auto-use current location on first mount (create-mode only).
  useEffect(() => {
    if (!autoUseCurrent || autoTried.current || value.name) return;
    autoTried.current = true;
    (async () => {
      try {
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur.status === "granted") {
          await fetchCurrentLocation(true);
          return;
        }
        if (cur.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status === "granted") await fetchCurrentLocation(true);
        }
      } catch { /* silent — user can still search manually */ }
    })();
    // fetchCurrentLocation is stable via useCallback; run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autocomplete search.
  const runSearch = useCallback((text: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.trim().length < 2) { setSuggestions([]); setLoading(false); return; }
    const rid = ++requestId.current;
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await api.placesAutocomplete({
          input: text.trim(),
          session_token: sessionToken.current,
          latitude: value.latitude || undefined,
          longitude: value.longitude || undefined,
        });
        if (rid === requestId.current) setSuggestions(res?.suggestions || []);
      } catch {
        if (rid === requestId.current) setSuggestions([]);
      } finally {
        if (rid === requestId.current) setLoading(false);
      }
    }, 300);
  }, [value.latitude, value.longitude]);

  useEffect(() => {
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, []);

  const onQueryChange = (t: string) => {
    setQuery(t);
    runSearch(t);
  };

  const choose = async (item: { place_id: string; description: string }) => {
    Haptics.selectionAsync();
    setQuery(item.description);
    setSuggestions([]);
    setLoading(true);
    try {
      const d = await api.placeDetails({
        place_id: item.place_id,
        session_token: sessionToken.current,
      });
      if (d?.latitude != null && d?.longitude != null) {
        onChange({
          name: d.name || item.description.split(",")[0].trim(),
          formatted_address: d.formatted_address || item.description,
          latitude: d.latitude,
          longitude: d.longitude,
          place_id: d.place_id,
        });
        setQuery(d.name || item.description.split(",")[0].trim());
      }
    } catch { /* keep query text */ } finally {
      setLoading(false);
      // Start a fresh session for the next search — required for billing.
      sessionToken.current = newSessionToken();
    }
  };

  const showList = focused && (suggestions.length > 0 || loading);

  return (
    <View style={{ position: "relative", zIndex: 20 }}>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          testID={testID}
          style={styles.input}
          placeholder="Search for a place, area, or address…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={onQueryChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading ? <ActivityIndicator size="small" color={colors.brand} /> : query ? (
          <Pressable
            testID="loc-clear-btn"
            onPress={() => { setQuery(""); setSuggestions([]); sessionToken.current = newSessionToken(); }}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={colors.borderStrong} />
          </Pressable>
        ) : null}
      </View>

      {showList && (
        <View style={styles.dropdown}>
          {loading && suggestions.length === 0 ? (
            <View style={styles.dropdownEmpty}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.dropdownEmptyText}>Searching…</Text>
            </View>
          ) : suggestions.length === 0 ? (
            <View style={styles.dropdownEmpty}>
              <Text style={styles.dropdownEmptyText}>No results</Text>
            </View>
          ) : (
            suggestions.map((s) => (
              <Pressable
                key={s.place_id}
                testID={`loc-suggestion-${s.place_id}`}
                style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.surfaceSecondary }]}
                onPress={() => choose(s)}
              >
                <Ionicons name="location-outline" size={16} color={colors.brand} />
                <Text style={styles.suggestionText} numberOfLines={2}>{s.description}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      <Pressable style={styles.gpsBtn} onPress={() => fetchCurrentLocation(false)} testID="loc-use-current">
        {gpsLoading ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <Ionicons name="navigate" size={16} color={colors.brand} />
        )}
        <Text style={styles.gpsText}>
          {gpsLoading ? "Getting location…" : "Use my current location"}
        </Text>
      </Pressable>

      {permBlocked && (
        <Text style={styles.permHint}>
          Location permission is blocked. Enable it in Settings to auto-fill your location.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: Platform.OS === "ios" ? 12 : 6,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1, fontSize: 15, color: colors.onSurface,
    padding: 0, minHeight: 40,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
  },
  dropdown: {
    position: "absolute",
    top: 56, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    zIndex: 30, overflow: "hidden",
    maxHeight: 320,
  },
  suggestion: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  suggestionText: { flex: 1, fontSize: 14, color: colors.onSurface },
  dropdownEmpty: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: spacing.md,
  },
  dropdownEmptyText: { color: colors.muted, fontSize: 14 },
  gpsBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", padding: 8,
  },
  gpsText: { color: colors.brand, fontWeight: "600", fontSize: 13 },
  permHint: { fontSize: 12, color: colors.muted, marginTop: 4, paddingHorizontal: 8 },
});
