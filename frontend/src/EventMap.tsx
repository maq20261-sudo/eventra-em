import React, { useMemo } from "react";
import { View, StyleSheet, Pressable, Text, Platform, Linking } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/theme";

type Props = {
  latitude: number;
  longitude: number;
  label: string;
  height?: number;
};

function buildHtml(lat: number, lng: number, label: string): string {
  const safeLabel = label.replace(/</g, "&lt;").replace(/"/g, "&quot;");
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
  .pin-wrap {
    display: flex; flex-direction: column; align-items: center;
    filter: drop-shadow(0 4px 6px rgba(0,0,0,0.25));
  }
  .pin {
    width: 32px; height: 32px; border-radius: 50%;
    background: #059669; border: 4px solid #FFFFFF;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 16px; font-weight: 700;
    font-family: -apple-system, sans-serif;
  }
  .pin::after {
    content: ""; position: absolute; margin-top: 36px;
    width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent;
    border-top: 10px solid #FFFFFF;
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);
  var icon = L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin">📍</div>',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });
  L.marker([${lat}, ${lng}], { icon: icon })
    .addTo(map)
    .bindPopup(${JSON.stringify(safeLabel)});
  // Disable scroll wheel zoom for smoother touch interaction on mobile
  map.scrollWheelZoom.disable();
</script>
</body>
</html>`;
}

export default function EventMap({ latitude, longitude, label, height = 200 }: Props) {
  const html = useMemo(() => buildHtml(latitude, longitude, label), [latitude, longitude, label]);

  const openDirections = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const encodedLabel = encodeURIComponent(label);
    let url = "";
    if (Platform.OS === "ios") {
      url = `http://maps.apple.com/?q=${encodedLabel}&ll=${latitude},${longitude}`;
    } else if (Platform.OS === "android") {
      url = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedLabel})`;
    } else {
      url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    }
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
    });
  };

  return (
    <View style={styles.wrap} testID="event-map">
      <View style={[styles.mapBox, { height }]}>
        {Platform.OS === "web" ? (
          // On web, use a plain iframe with a data URL for maximum compatibility
          // @ts-ignore — iframe is web-only
          <iframe
            srcDoc={html}
            style={{ width: "100%", height: "100%", border: "none" }}
            sandbox="allow-scripts allow-same-origin"
            title="Event location map"
          />
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            scrollEnabled={false}
            style={styles.web}
          />
        )}
      </View>
      <Pressable style={styles.dirBtn} onPress={openDirections} testID="get-directions-btn">
        <Ionicons name="navigate" size={16} color={colors.brand} />
        <Text style={styles.dirText}>Get Directions</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  mapBox: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
  },
  web: { flex: 1, backgroundColor: colors.surfaceTertiary },
  dirBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brandTertiary,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, alignSelf: "flex-start",
  },
  dirText: { color: colors.onBrandTertiary, fontWeight: "600", fontSize: 13 },
});
