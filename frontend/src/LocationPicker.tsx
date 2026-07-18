import React, { useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Platform, TextInput,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, shadows } from "@/src/theme";

type Props = {
  visible: boolean;
  initialLat: number;
  initialLng: number;
  initialLabel?: string;
  onCancel: () => void;
  onSelect: (loc: { latitude: number; longitude: number; label: string }) => void;
};

type Pin = { lat: number; lng: number; label: string };

function buildHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
  body { background: #F3F4F6; }
  .leaflet-container { background: #F3F4F6; }
  .pin-wrap { filter: drop-shadow(0 4px 6px rgba(0,0,0,0.25)); }
  .pin {
    width: 32px; height: 32px; border-radius: 50%;
    background: #059669; border: 4px solid #FFFFFF;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 16px; font-weight: 700;
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function post(msg) {
    var payload = JSON.stringify(msg);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(payload);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
  }
  var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([${lat}, ${lng}], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  var icon = L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin">📍</div>',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });
  var marker = L.marker([${lat}, ${lng}], { icon: icon, draggable: true }).addTo(map);

  function announce(latlng) {
    post({ type: 'pin', lat: latlng.lat, lng: latlng.lng });
  }

  map.on('click', function (e) {
    marker.setLatLng(e.latlng);
    announce(e.latlng);
  });
  marker.on('dragend', function () {
    announce(marker.getLatLng());
  });

  // Listen for center commands from RN
  window.addEventListener('message', function (event) {
    try {
      var data = JSON.parse(event.data);
      if (data && data.type === 'center' && typeof data.lat === 'number') {
        map.setView([data.lat, data.lng], 15);
        marker.setLatLng([data.lat, data.lng]);
      }
    } catch (e) {}
  });
  document.addEventListener('message', function (event) {
    try {
      var data = JSON.parse(event.data);
      if (data && data.type === 'center' && typeof data.lat === 'number') {
        map.setView([data.lat, data.lng], 15);
        marker.setLatLng([data.lat, data.lng]);
      }
    } catch (e) {}
  });

  post({ type: 'ready' });
</script>
</body>
</html>`;
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const a = data.address || {};
    const name = data.name
      || a.attraction
      || a.building
      || a.amenity
      || a.tourism
      || a.leisure
      || a.shop
      || a.road
      || null;
    const city = a.city || a.town || a.village || a.suburb || a.county || null;
    if (name && city) return `${name}, ${city}`;
    if (name) return name;
    return data.display_name || null;
  } catch {
    return null;
  }
}

async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const hit = data[0];
    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      label: hit.display_name || query,
    };
  } catch {
    return null;
  }
}

export default function LocationPicker({
  visible, initialLat, initialLng, initialLabel, onCancel, onSelect,
}: Props) {
  const html = useMemo(() => buildHtml(initialLat, initialLng), [initialLat, initialLng]);
  const [pin, setPin] = useState<Pin>({ lat: initialLat, lng: initialLng, label: initialLabel || "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [resolvingLabel, setResolvingLabel] = useState(false);
  const webviewRef = useRef<any>(null);
  const iframeRef = useRef<any>(null);

  const sendCenter = (lat: number, lng: number) => {
    const msg = JSON.stringify({ type: "center", lat, lng });
    if (Platform.OS === "web") {
      iframeRef.current?.contentWindow?.postMessage(msg, "*");
    } else {
      webviewRef.current?.injectJavaScript(
        `(function(){ try { window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(msg)} })); } catch(e) {} })(); true;`
      );
    }
  };

  const handleMessage = async (raw: string) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === "pin" && typeof data.lat === "number") {
        Haptics.selectionAsync();
        setPin((prev) => ({ lat: data.lat, lng: data.lng, label: prev.label }));
        setResolvingLabel(true);
        const label = await reverseGeocode(data.lat, data.lng);
        setResolvingLabel(false);
        if (label) setPin({ lat: data.lat, lng: data.lng, label });
      }
    } catch {}
  };

  // Web-only: listen for postMessage from iframe
  React.useEffect(() => {
    if (Platform.OS !== "web" || !visible) return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data === "string") handleMessage(event.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [visible]);

  const submitSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearching(true);
    const hit = await forwardGeocode(q);
    setSearching(false);
    if (!hit) return;
    setPin({ lat: hit.lat, lng: hit.lng, label: hit.label });
    sendCenter(hit.lat, hit.lng);
  };

  const confirmPin = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSelect({
      latitude: pin.lat,
      longitude: pin.lng,
      label: pin.label || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <SafeAreaView edges={["top"]} style={styles.topBar}>
          <Pressable onPress={onCancel} style={styles.iconBtn} testID="lp-cancel-btn">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Pick Location</Text>
          <View style={styles.iconBtn} />
        </SafeAreaView>

        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              testID="lp-search-input"
              style={styles.searchInput}
              placeholder="Search a place, address, or city"
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={submitSearch}
              returnKeyType="search"
            />
            {searching ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : searchQuery.length > 0 ? (
              <Pressable onPress={submitSearch} testID="lp-search-go">
                <Ionicons name="arrow-forward-circle" size={22} color={colors.brand} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.mapWrap}>
          {Platform.OS === "web" ? (
            // @ts-ignore iframe is web-only
            <iframe
              ref={iframeRef}
              srcDoc={html}
              style={{ width: "100%", height: "100%", border: "none" }}
              sandbox="allow-scripts allow-same-origin"
              title="Pick location map"
            />
          ) : (
            <WebView
              ref={webviewRef}
              originWhitelist={["*"]}
              source={{ html }}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="always"
              onMessage={(e: WebViewMessageEvent) => handleMessage(e.nativeEvent.data)}
              style={{ flex: 1, backgroundColor: colors.surfaceTertiary }}
            />
          )}
        </View>

        <View style={styles.footer}>
          <View style={styles.pinInfo}>
            <View style={styles.pinIcon}>
              <Ionicons name="location" size={18} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pinLabel} numberOfLines={2}>
                {resolvingLabel ? "Resolving address…" : pin.label || "Tap the map to drop a pin"}
              </Text>
              <Text style={styles.pinCoords}>
                {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </Text>
            </View>
          </View>
          <Pressable style={styles.confirmBtn} onPress={confirmPin} testID="lp-confirm-btn">
            <Text style={styles.confirmText}>Use this location</Text>
            <Ionicons name="checkmark-circle" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  searchWrap: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  mapWrap: { flex: 1, backgroundColor: colors.surfaceTertiary },
  footer: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg, paddingBottom: 28,
    borderTopColor: colors.border, borderTopWidth: 1,
    gap: spacing.md,
    ...shadows.floating,
  },
  pinInfo: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  pinIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  pinLabel: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  pinCoords: { fontSize: 12, color: colors.muted, marginTop: 2 },
  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  confirmText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },
});
