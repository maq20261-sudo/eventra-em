import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { api } from "@/src/api";
import EventMap from "@/src/EventMap";
import LocationPicker from "@/src/LocationPicker";
import { colors, spacing, radius, shadows } from "@/src/theme";

const CATEGORIES = ["Music", "Art", "Tech", "Food", "Sports", "Other"];
const BOOKING_TYPES = [
  { key: "seat_map", label: "Reserved Seating" },
  { key: "general", label: "General Admission" },
  { key: "time_slot", label: "Time Slots" },
];

const DEFAULT_IMAGES = [
  "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=940",
  "https://images.pexels.com/photos/15086258/pexels-photo-15086258.jpeg?auto=compress&cs=tinysrgb&w=940",
  "https://images.pexels.com/photos/29180747/pexels-photo-29180747.jpeg",
  "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=940",
];

type Props = { editId?: string };

export default function EventForm({ editId }: Props) {
  const router = useRouter();
  const isEdit = !!editId;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Music");
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGES[0]);
  const [dateStr, setDateStr] = useState(""); // YYYY-MM-DD
  const [timeStr, setTimeStr] = useState(""); // HH:MM
  const [locationName, setLocationName] = useState("");
  const [latitude, setLatitude] = useState("37.7749");
  const [longitude, setLongitude] = useState("-122.4194");
  const [price, setPrice] = useState("0");
  const [bookingType, setBookingType] = useState<"seat_map" | "general" | "time_slot">("general");
  const [seatRows, setSeatRows] = useState("6");
  const [seatCols, setSeatCols] = useState("8");
  const [totalSeats, setTotalSeats] = useState("100");
  const [timeSlots, setTimeSlots] = useState<string[]>([""]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const e = await api.getEvent(editId);
        setTitle(e.title);
        setDescription(e.description);
        setCategory(e.category);
        setImageUrl(e.image_url || DEFAULT_IMAGES[0]);
        const d = new Date(e.date);
        setDateStr(d.toISOString().slice(0, 10));
        setTimeStr(d.toISOString().slice(11, 16));
        setLocationName(e.location_name);
        setLatitude(String(e.latitude));
        setLongitude(String(e.longitude));
        setPrice(String(e.price));
        setBookingType(e.booking_type);
        if (e.seat_rows) setSeatRows(String(e.seat_rows));
        if (e.seat_cols) setSeatCols(String(e.seat_cols));
        if (e.total_seats) setTotalSeats(String(e.total_seats));
        if (e.time_slots) setTimeSlots(e.time_slots.length ? e.time_slots : [""]);
      } catch (err) {
        console.log("Fetch edit error", err);
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [editId]);

  const useMyGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      setLatitude(String(pos.coords.latitude));
      setLongitude(String(pos.coords.longitude));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) { console.log(e); }
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || !description.trim() || !dateStr || !timeStr || !locationName.trim()) {
      setError("Please fill title, description, date, time, and location.");
      return;
    }
    const iso = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    if (isNaN(new Date(iso).getTime())) {
      setError("Invalid date/time. Use YYYY-MM-DD and HH:MM.");
      return;
    }
    const body: any = {
      title, description, category, image_url: imageUrl,
      date: iso, location_name: locationName,
      latitude: parseFloat(latitude), longitude: parseFloat(longitude),
      price: parseFloat(price) || 0,
      booking_type: bookingType,
    };
    if (bookingType === "seat_map") {
      body.seat_rows = parseInt(seatRows) || 6;
      body.seat_cols = parseInt(seatCols) || 8;
    } else if (bookingType === "general") {
      body.total_seats = parseInt(totalSeats) || 100;
    } else if (bookingType === "time_slot") {
      body.time_slots = timeSlots.map((s) => s.trim()).filter(Boolean);
      if (body.time_slots.length === 0) {
        setError("Please add at least one time slot.");
        return;
      }
    }
    setLoading(true);
    try {
      if (isEdit && editId) {
        await api.updateEvent(editId, body);
      } else {
        await api.createEvent(body);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(organizer)/events" as any);
    } catch (e: any) {
      setError(e?.message || "Failed to save event");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const doDelete = async () => {
    if (!editId) return;
    Alert.alert("Delete event?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.deleteEvent(editId);
          router.replace("/(organizer)/events" as any);
        } catch (e: any) { setError(e?.message); }
      }},
    ]);
  };

  if (initialLoading) {
    return (
      <View style={[styles.safe, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          {isEdit && (
            <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="edit-back-btn">
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
          )}
          <Text style={styles.title}>{isEdit ? "Edit Event" : "Create Event"}</Text>
          {isEdit && (
            <Pressable onPress={doDelete} style={styles.deleteBtn} testID="delete-event-btn">
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          )}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }}
          keyboardShouldPersistTaps="handled"
        >
          <Label>Event Title</Label>
          <TextInput testID="title-input" style={styles.input} placeholder="Sunset Symphony" value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} />

          <Label>Description</Label>
          <TextInput
            testID="desc-input"
            style={[styles.input, { height: 100, textAlignVertical: "top" }]}
            placeholder="Tell attendees what to expect"
            value={description} onChangeText={setDescription} multiline
            placeholderTextColor={colors.muted}
          />

          <Label>Category</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c} testID={`cat-${c}`}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCategory(c); }}
                style={[styles.chip, category === c && styles.chipActive]}
              >
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Label>Cover Image</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {DEFAULT_IMAGES.map((u) => (
              <Pressable
                key={u}
                onPress={() => setImageUrl(u)}
                style={[styles.imgOption, imageUrl === u && styles.imgOptionActive]}
                testID={`img-${u.slice(-24)}`}
              >
                <Image source={u} style={{ width: 90, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary }} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>

          <Label>Date</Label>
          <TextInput testID="date-input" style={styles.input} placeholder="YYYY-MM-DD" value={dateStr} onChangeText={setDateStr} placeholderTextColor={colors.muted} autoCapitalize="none" />

          <Label>Time (24h)</Label>
          <TextInput testID="time-input" style={styles.input} placeholder="19:30" value={timeStr} onChangeText={setTimeStr} placeholderTextColor={colors.muted} autoCapitalize="none" />

          <Label>Location</Label>
          <Pressable
            style={styles.locPicker}
            onPress={() => setPickerOpen(true)}
            testID="open-location-picker"
          >
            <View style={styles.locIcon}>
              <Ionicons name="map" size={18} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locPickerTitle} numberOfLines={1}>
                {locationName || "Pick location on map"}
              </Text>
              <Text style={styles.locPickerSub}>
                {latitude && longitude
                  ? `${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)}`
                  : "Tap to search or drop a pin"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
          </Pressable>
          <Pressable onPress={useMyGPS} style={styles.gpsBtn} testID="use-my-gps-btn">
            <Ionicons name="navigate" size={16} color={colors.brand} />
            <Text style={styles.gpsText}>Or use my current location</Text>
          </Pressable>

          <TextInput
            testID="location-input"
            style={[styles.input, { marginTop: spacing.sm }]}
            placeholder="Location name (e.g. Golden Gate Park)"
            value={locationName}
            onChangeText={setLocationName}
            placeholderTextColor={colors.muted}
          />

          {!isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude)) && (
            <View style={{ marginTop: spacing.sm }}>
              <EventMap
                latitude={parseFloat(latitude)}
                longitude={parseFloat(longitude)}
                label={locationName || "Event location"}
                height={160}
              />
            </View>
          )}

          <Label>Ticket Price (USD)</Label>
          <TextInput testID="price-input" style={styles.input} placeholder="0" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />

          <Label>Booking Type</Label>
          <View style={styles.typeCol}>
            {BOOKING_TYPES.map((t) => (
              <Pressable
                key={t.key} testID={`type-${t.key}`}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBookingType(t.key as any); }}
                style={[styles.typeItem, bookingType === t.key && styles.typeItemActive]}
              >
                <View style={styles.radio}>
                  {bookingType === t.key && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.typeText}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {bookingType === "seat_map" && (
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Label>Rows</Label>
                <TextInput testID="rows-input" style={styles.input} value={seatRows} onChangeText={setSeatRows} keyboardType="number-pad" placeholderTextColor={colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Label>Columns</Label>
                <TextInput testID="cols-input" style={styles.input} value={seatCols} onChangeText={setSeatCols} keyboardType="number-pad" placeholderTextColor={colors.muted} />
              </View>
            </View>
          )}

          {bookingType === "general" && (
            <>
              <Label>Total Seats</Label>
              <TextInput testID="total-seats-input" style={styles.input} value={totalSeats} onChangeText={setTotalSeats} keyboardType="number-pad" placeholderTextColor={colors.muted} />
            </>
          )}

          {bookingType === "time_slot" && (
            <>
              <Label>Time Slots</Label>
              {timeSlots.map((s, i) => (
                <View key={i} style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
                  <TextInput
                    testID={`slot-input-${i}`}
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="e.g. 2:00 PM Session"
                    value={s}
                    onChangeText={(v) => {
                      const next = [...timeSlots]; next[i] = v; setTimeSlots(next);
                    }}
                    placeholderTextColor={colors.muted}
                  />
                  {timeSlots.length > 1 && (
                    <Pressable
                      style={styles.slotRemove}
                      onPress={() => setTimeSlots(timeSlots.filter((_, idx) => idx !== i))}
                    >
                      <Ionicons name="close" size={16} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable style={styles.addSlot} onPress={() => setTimeSlots([...timeSlots, ""])} testID="add-slot-btn">
                <Ionicons name="add" size={16} color={colors.brand} />
                <Text style={styles.addSlotText}>Add another slot</Text>
              </Pressable>
            </>
          )}

          {error && <Text style={styles.error} testID="form-error">{error}</Text>}
        </ScrollView>

        <View style={styles.stickyBar}>
          <Pressable
            style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
            testID="submit-event-btn"
          >
            {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Text style={styles.submitText}>{isEdit ? "Save Changes" : "Publish Event"}</Text>
                <Ionicons name="rocket" size={18} color={colors.onBrandPrimary} />
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <LocationPicker
        visible={pickerOpen}
        initialLat={parseFloat(latitude) || 37.7749}
        initialLng={parseFloat(longitude) || -122.4194}
        initialLabel={locationName}
        onCancel={() => setPickerOpen(false)}
        onSelect={(loc) => {
          setLatitude(String(loc.latitude));
          setLongitude(String(loc.longitude));
          // Only auto-fill location name if the field is empty — never clobber
          // a name the organizer typed themselves.
          if (!locationName || locationName.length === 0) {
            setLocationName(loc.label);
          }
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontSize: 22, fontWeight: "700", color: colors.onSurface },
  deleteBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#FEF2F2",
    alignItems: "center", justifyContent: "center",
  },
  label: {
    fontSize: 13, color: colors.onSurfaceTertiary, marginBottom: spacing.xs,
    marginTop: spacing.md, fontWeight: "500",
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14,
    fontSize: 15, color: colors.onSurface,
    borderColor: colors.border, borderWidth: 1,
    marginBottom: spacing.xs,
  },
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.lg, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  chipText: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: "500" },
  chipTextActive: { color: colors.surface, fontWeight: "600" },
  imgOption: { padding: 2, borderRadius: 8, borderWidth: 2, borderColor: "transparent" },
  imgOptionActive: { borderColor: colors.brand },
  row2: { flexDirection: "row", gap: spacing.md },
  gpsBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingVertical: 8, marginTop: 2,
  },
  gpsText: { color: colors.brand, fontSize: 13, fontWeight: "500" },
  locPicker: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderColor: colors.border, borderWidth: 1,
  },
  locIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  locPickerTitle: { fontSize: 15, color: colors.onSurface, fontWeight: "600" },
  locPickerSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  typeCol: { gap: spacing.sm },
  typeItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  typeItemActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  typeText: { fontSize: 15, color: colors.onSurface, fontWeight: "500" },
  addSlot: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    padding: 8,
  },
  addSlotText: { color: colors.brand, fontWeight: "500" },
  slotRemove: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  error: {
    color: colors.error, marginTop: spacing.md,
    backgroundColor: "#FEF2F2", padding: spacing.md, borderRadius: radius.md,
  },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopColor: colors.border, borderTopWidth: 1,
    padding: spacing.lg, paddingBottom: 24,
    ...shadows.floating,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingVertical: 16,
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 16 },
});
