// Reverse geocoding with a persistent on-device cache.
//
// Cost rules (the server lookup uses Google's paid Geocoding API):
//   1. Cache first — results are stored on the device per grid cell, so the
//      same area is never looked up twice (survives app restarts).
//   2. Then the phone's own geocoder (free).
//   3. Only if the phone can't answer, the server (/places/reverse, paid).
import { Platform } from "react-native";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

export const CURRENT_LOCATION_FALLBACK = "Near you";

const CACHE_KEY = "gs_geocode_cache_v1";
const MAX_ENTRIES = 60;

type Place = {
  area: string | null; // e.g. "Bandra West"
  city: string | null; // e.g. "Mumbai"
  name: string | null; // street / building, for the organizer's location field
  address: string | null; // full one-line address
  t: number; // cached-at, for pruning
};

let memCache: Record<string, Place> | null = null;

async function readCache(): Promise<Record<string, Place>> {
  if (memCache) return memCache;
  const raw = await storage.getItem<string>(CACHE_KEY, "");
  try {
    memCache = raw ? JSON.parse(raw) : {};
  } catch {
    memCache = {};
  }
  return memCache!;
}

async function writeCache(key: string, place: Place) {
  const cache = await readCache();
  cache[key] = place;
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].t - cache[b].t);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
  }
  await storage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/** Grid cell for caching: 2 decimals ≈ 1.1 km (area names), 3 ≈ 110 m (addresses). */
function cellKey(lat: number, lng: number, decimals: number) {
  return `${decimals}:${lat.toFixed(decimals)},${lng.toFixed(decimals)}`;
}

async function lookup(latitude: number, longitude: number): Promise<Place | null> {
  if (Platform.OS !== "web") {
    try {
      const [r] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (r && (r.district || r.city || r.subregion || r.street || r.name)) {
        return {
          area: r.district ?? null,
          city: r.city ?? r.subregion ?? null,
          name: r.name || r.street || r.district || r.city || null,
          address: [r.name, r.street, r.district, r.city, r.region, r.country].filter(Boolean).join(", ") || null,
          t: Date.now(),
        };
      }
    } catch {
      /* fall through to the server */
    }
  }
  try {
    const rg = await api.reverseGeocode({ latitude, longitude });
    if (rg && (rg.area || rg.city || rg.formatted_address)) {
      return {
        area: rg.area ?? null,
        city: rg.city ?? null,
        name: rg.name ?? null,
        address: rg.formatted_address ?? null,
        t: Date.now(),
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Cached reverse geocode. `decimals` controls cache granularity. */
export async function reverseGeocodeCached(latitude: number, longitude: number, decimals = 2): Promise<Place | null> {
  const key = cellKey(latitude, longitude, decimals);
  const cache = await readCache();
  if (cache[key]) return cache[key];
  const place = await lookup(latitude, longitude);
  if (place) await writeCache(key, place);
  return place;
}

function join(area?: string | null, city?: string | null): string | null {
  const a = area?.trim();
  const c = city?.trim();
  if (a && c && a !== c) return `${a}, ${c}`;
  return a || c || null;
}

/** Short label for the Discover header, e.g. "Bandra West, Mumbai". */
export async function areaNameFor(latitude: number, longitude: number): Promise<string> {
  const place = await reverseGeocodeCached(latitude, longitude, 2);
  return join(place?.area, place?.city) || CURRENT_LOCATION_FALLBACK;
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
