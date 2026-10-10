import { useState, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Text, TextInput } from "@/src/ui/Text";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import EventMap from "@/src/EventMap";
import LocationPicker from "@/src/LocationPicker";
import RazorpayCheckout from "@/src/RazorpayCheckout";
import { useQuota } from "@/src/hooks/usePricing";
import * as ImagePicker from "expo-image-picker";
import { spacing, radius, shadows, fonts } from "@/src/theme";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { useTheme, type Colors } from "@/src/ThemeContext";
import DateTimeField from "@/src/DateTimeField";
import LocationSearchField from "@/src/LocationSearchField";
import { eventStatusMeta } from "@/src/utils/eventStatus";

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const isEdit = !!editId;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Music");
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGES[0]);
  // Start & End datetime — replaces the old single "date + time" text fields.
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [locationName, setLocationName] = useState("");
  const [latitude, setLatitude] = useState("37.7749");
  const [longitude, setLongitude] = useState("-122.4194");
  const [price, setPrice] = useState("0");
  const [bookingType, setBookingType] = useState<"seat_map" | "general" | "time_slot">("general");
  const [seatRows, setSeatRows] = useState("6");
  const [seatCols, setSeatCols] = useState("8");
  const [totalSeats, setTotalSeats] = useState("100");
  // Per-slot capacity: each slot is { time: label, capacity: number }.
  // Default 50 seats per slot per product requirement.
  const [timeSlots, setTimeSlots] = useState<{ time: string; capacity: number }[]>([
    { time: "", capacity: 50 },
  ]);
  // Verification workflow status — read-only in the form (admin flips it
  // in the DB). We surface it as a banner so organizers know when their
  // event is IN_REVIEW / ON_HOLD / REJECTED and see any hold reasons.
  const [status, setStatus] = useState<string | null>(null);
  const [holdReasons, setHoldReasons] = useState<string[]>([]);
  // Modal state for the "drop-a-pin on map" picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Platform-fee flow: for event #6+ the organizer must pay ₹19 first.
  const { quota, refresh: refreshQuota } = useQuota(true);
  const [rzpOrder, setRzpOrder] = useState<any | null>(null);
  const [rzpVisible, setRzpVisible] = useState(false);
  const pendingBodyRef = useRef<any | null>(null);


  useEffect(() => {
    if (!editId) return;
    // CRITICAL: reset ALL fields BEFORE fetching so state from a
    // previously-open event doesn't bleed into this one. Otherwise
    // navigating Reserved → General → back to Reserved could leave the
    // form showing "General Admission" (previous editId's state) until
    // the async fetch completed. Also handles cases where the new event
    // is missing fields (e.g., seat_rows) that the old event had.
    let cancelled = false;
    setInitialLoading(true);
    setTitle("");
    setDescription("");
    setCategory("Music");
    setImageUrl(DEFAULT_IMAGES[0]);
    setStartAt(null);
    setEndAt(null);
    setLocationName("");
    setLatitude("37.7749");
    setLongitude("-122.4194");
    setPrice("0");
    setBookingType("general");
    setSeatRows("6");
    setSeatCols("8");
    setTotalSeats("100");
    setTimeSlots([{ time: "", capacity: 50 }]);
    setStatus(null);
    setHoldReasons([]);
    (async () => {
      try {
        const e = await api.getEvent(editId);
        if (cancelled) return;
        setTitle(e.title);
        setDescription(e.description);
        setCategory(e.category);
        setImageUrl(e.image_url || DEFAULT_IMAGES[0]);
        // Prefer new start_date/end_date, fall back to legacy `date`.
        const startISO = e.start_date || e.date;
        const endISO = e.end_date || null;
        if (startISO) setStartAt(new Date(startISO));
        if (endISO) setEndAt(new Date(endISO));
        setLocationName(e.location_name);
        setLatitude(String(e.latitude));
        setLongitude(String(e.longitude));
        setPrice(String(e.price));
        setBookingType(e.booking_type);
        setStatus(e.status || null);
        setHoldReasons(Array.isArray(e.hold_reasons) ? e.hold_reasons : []);
        if (e.seat_rows) setSeatRows(String(e.seat_rows));
        if (e.seat_cols) setSeatCols(String(e.seat_cols));
        if (e.total_seats) setTotalSeats(String(e.total_seats));
        if (e.time_slots) {
          // Backend returns time_slots as list of labels + slot_capacities map.
          const labels: string[] = e.time_slots.length ? e.time_slots : [""];
          const caps = e.slot_capacities || {};
          const fallbackCap = e.slot_capacity && e.slot_capacity > 1 ? e.slot_capacity : 50;
          setTimeSlots(
            labels.map((label: string) => ({
              time: label,
              capacity: caps[label] ?? fallbackCap,
            })),
          );
        }
      } catch (err) {
        console.log("Fetch edit error", err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  const pickBanner = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo library permission is required to upload a banner.");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        aspect: [16, 9],
        allowsEditing: true,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        setError("Could not read image data.");
        return;
      }
      const mime = asset.mimeType || "image/jpeg";
      const dataUri = `data:${mime};base64,${asset.base64}`;
      setImageUrl(dataUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.message || "Failed to pick image");
    }
  };

  const isCustomBanner = imageUrl.startsWith("data:") || !DEFAULT_IMAGES.includes(imageUrl);

  const submit = async () => {
    setError(null);
    if (!title.trim() || !description.trim() || !startAt || !endAt || !locationName.trim()) {
      setError("Please fill title, description, start, end, and location.");
      return;
    }
    if (endAt.getTime() <= startAt.getTime()) {
      setError("End date/time must be after the start.");
      return;
    }
    const body: any = {
      title, description, category, image_url: imageUrl,
      start_date: startAt.toISOString(),
      end_date: endAt.toISOString(),
      location_name: locationName,
      latitude: parseFloat(latitude), longitude: parseFloat(longitude),
      price: parseFloat(price) || 0,
      booking_type: bookingType,
    };
    if (bookingType === "seat_map") {
      body.seat_rows = parseInt(seatRows) || 6;
      body.seat_cols = parseInt(seatCols) || 8;
      // Optional: allow time slots on seat_map events too.
      const cleaned = timeSlots
        .map((s) => ({ time: s.time.trim(), capacity: 0 }))
        .filter((s) => s.time.length > 0);
      if (cleaned.length > 0) body.time_slots = cleaned.map((s) => s.time);
    } else if (bookingType === "general") {
      body.total_seats = parseInt(totalSeats) || 100;
    } else if (bookingType === "time_slot") {
      const cleaned = timeSlots
        .map((s) => ({ time: s.time.trim(), capacity: Math.max(1, Math.floor(s.capacity || 0)) }))
        .filter((s) => s.time.length > 0);
      if (cleaned.length === 0) {
        setError("Please add at least one time slot.");
        return;
      }
      if (cleaned.some((s) => !s.capacity || s.capacity < 1)) {
        setError("Each time slot needs at least 1 seat.");
        return;
      }
      body.time_slots = cleaned;
    }
    setLoading(true);
    try {
      if (isEdit && editId) {
        await api.updateEvent(editId, body);
      } else {
        try {
          await api.createEvent(body);
        } catch (err: any) {
          // 402 → quota exhausted; kick off the platform-fee Razorpay flow.
          const detail = err?.detail ?? err?.data?.detail;
          if (detail?.requires_platform_fee) {
            const order = await api.createPaymentOrder({ kind: "platform_fee" });
            pendingBodyRef.current = body;
            setRzpOrder(order);
            setRzpVisible(true);
            setLoading(false);
            return;
          }
          throw err;
        }
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

  // Called after Razorpay checkout succeeds for the ₹19 platform fee.
  const onPlatformFeeVerified = async (verifyPayload: any) => {
    setRzpVisible(false);
    setLoading(true);
    try {
      const res = await api.verifyPayment(verifyPayload);
      const intentId = res?.result?.platform_intent_id;
      if (!intentId) throw new Error("Platform fee verification failed");
      const bodyWithFee = { ...(pendingBodyRef.current || {}), platform_intent_id: intentId };
      await api.createEvent(bodyWithFee);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshQuota();
      router.replace("/(organizer)/events" as any);
    } catch (e: any) {
      setError(e?.message || "Payment succeeded but event creation failed. Please try again.");
    } finally {
      setLoading(false);
      setRzpOrder(null);
      pendingBodyRef.current = null;
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
      <GlowBackground />
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
          {/* Verification-workflow banner — only shown in edit mode when
              the backend surfaces a status. Non-ACTIVE events (IN_REVIEW,
              ON_HOLD, REJECTED) explain why the event isn't live yet and
              list any admin-provided hold reasons. */}
          {isEdit && status && (() => {
            const meta = eventStatusMeta(status);
            return (
              <View
                style={[styles.statusBanner, { backgroundColor: meta.bg }]}
                testID="event-status-banner"
              >
                <View style={[styles.statusBannerIcon, { backgroundColor: meta.fg + "22" }]}>
                  <Ionicons name={meta.icon as any} size={18} color={meta.fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statusBannerTitle, { color: meta.fg }]}>
                    Status · {meta.label}
                  </Text>
                  <Text style={[styles.statusBannerSub, { color: meta.fg }]}>
                    {status === "ACTIVE"
                      ? "This event is live and visible to attendees."
                      : status === "IN_REVIEW"
                      ? "Waiting for admin review — attendees can't see it yet."
                      : status === "ON_HOLD"
                      ? "Temporarily paused by admin. See reasons below."
                      : "Rejected by admin. See reasons below."}
                  </Text>
                  {holdReasons.length > 0 && (
                    <View style={styles.holdReasonsList}>
                      {holdReasons.map((r, i) => (
                        <View key={i} style={styles.holdReasonItem}>
                          <Ionicons name="ellipse" size={5} color={meta.fg} style={{ marginTop: 6 }} />
                          <Text style={[styles.holdReasonItemText, { color: meta.fg }]}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Free-tier / platform-fee banner for organizers. */}
          {!isEdit && quota?.organizer && (
            quota.organizer.free_events_remaining > 0 ? (
              <View style={[styles.quotaBanner, styles.quotaFree]} testID="quota-banner-free">
                <View style={styles.quotaIcon}><Ionicons name="gift" size={18} color={colors.onLime} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quotaTitleFree}>Your first {quota.organizer.free_event_limit} events are FREE</Text>
                  <Text style={styles.quotaSubFree}>
                    {quota.organizer.free_events_remaining} of {quota.organizer.free_event_limit} free
                    event{quota.organizer.free_events_remaining === 1 ? "" : "s"} left
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.quotaBanner, styles.quotaPaid]} testID="quota-banner-paid">
                <View style={[styles.quotaIcon, { backgroundColor: colors.brand }]}><Ionicons name="card" size={18} color={colors.onBrandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quotaTitlePaid}>
                    Publish fee: ₹{quota.organizer.platform_fee_inr}
                  </Text>
                  <Text style={styles.quotaSubPaid}>
                    You&apos;ve used all {quota.organizer.free_event_limit} free events.
                    You&apos;ll be prompted to pay before publishing.
                  </Text>
                </View>
              </View>
            )
          )}

          <Label styles={styles}>Event Title</Label>
          <TextInput testID="title-input" style={styles.input} placeholder="Sunset Symphony" value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} />

          <Label styles={styles}>Description</Label>
          <TextInput
            testID="desc-input"
            style={[styles.input, { height: 100, textAlignVertical: "top" }]}
            placeholder="Tell attendees what to expect"
            value={description} onChangeText={setDescription} multiline
            placeholderTextColor={colors.muted}
          />

          <Label styles={styles}>Category</Label>
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

          <Label styles={styles}>Cover Image</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
            <Pressable
              onPress={pickBanner}
              style={[styles.uploadCard, isCustomBanner && styles.imgOptionActive]}
              testID="upload-banner-btn"
            >
              <Ionicons name="cloud-upload-outline" size={20} color={colors.accentText} />
              <Text style={styles.uploadText}>Upload</Text>
            </Pressable>
            {isCustomBanner && (
              <Pressable
                onPress={() => {}}
                style={[styles.imgOption, styles.imgOptionActive]}
                testID="custom-banner-thumb"
              >
                <Image
                  source={imageUrl}
                  style={{ width: 90, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary }}
                  contentFit="cover"
                />
              </Pressable>
            )}
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

          <Label styles={styles}>Starts</Label>
          <DateTimeField
            label="Start date & time"
            value={startAt}
            onChange={(d) => {
              setStartAt(d);
              // Auto-bump end if user picks a start that's after current end.
              if (!endAt || endAt.getTime() <= d.getTime()) {
                const nextEnd = new Date(d);
                nextEnd.setDate(nextEnd.getDate() + 1);
                setEndAt(nextEnd);
              }
            }}
            testID="start-date-field"
          />

          <Label styles={styles}>Ends</Label>
          <DateTimeField
            label="End date & time"
            value={endAt}
            onChange={setEndAt}
            minDate={startAt || undefined}
            testID="end-date-field"
          />

          <Label styles={styles}>Location</Label>
          <LocationSearchField
            testID="location-search"
            value={{
              name: locationName,
              latitude: parseFloat(latitude) || null,
              longitude: parseFloat(longitude) || null,
            }}
            onChange={(picked) => {
              setLocationName(picked.name);
              setLatitude(String(picked.latitude));
              setLongitude(String(picked.longitude));
            }}
            autoUseCurrent={!editId}
          />

          {!isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude)) && (
            <View style={{ marginTop: spacing.sm }}>
              <EventMap
                latitude={parseFloat(latitude)}
                longitude={parseFloat(longitude)}
                label={locationName || "Event location"}
                height={160}
              />
              {/* "Adjust pin on map" — opens a full interactive map so the
                  organizer can fine-tune the exact position after picking
                  a place from search. */}
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={styles.pinAdjustBtn}
                testID="adjust-pin-btn"
              >
                <Ionicons name="pin" size={16} color={colors.accentText} />
                <Text style={styles.pinAdjustText}>Adjust pin on map</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.borderStrong} />
              </Pressable>
            </View>
          )}

          <Label styles={styles}>Ticket Price (INR)</Label>
          <TextInput testID="price-input" style={styles.input} placeholder="0" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />

          <Label styles={styles}>Booking Type</Label>
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
            <>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Label styles={styles}>Rows</Label>
                  <TextInput testID="rows-input" style={styles.input} value={seatRows} onChangeText={setSeatRows} keyboardType="number-pad" placeholderTextColor={colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Label styles={styles}>Columns</Label>
                  <TextInput testID="cols-input" style={styles.input} value={seatCols} onChangeText={setSeatCols} keyboardType="number-pad" placeholderTextColor={colors.muted} />
                </View>
              </View>

              <Label styles={styles}>Time Slots (optional)</Label>
              <Text style={styles.slotHelper}>
                Leave empty for a single-show event, or add multiple showings.
                Each showing uses the same seat map above.
              </Text>
              {timeSlots.map((s, i) => (
                <View key={i} style={styles.slotRow}>
                  <TextInput
                    testID={`seatmap-slot-input-${i}`}
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="e.g. Matinee · 2:00 PM"
                    value={s.time}
                    onChangeText={(v) => {
                      const next = [...timeSlots]; next[i] = { ...next[i], time: v }; setTimeSlots(next);
                    }}
                    placeholderTextColor={colors.muted}
                  />
                  {timeSlots.length > 1 && (
                    <Pressable
                      testID={`seatmap-slot-remove-${i}`}
                      style={styles.slotRemove}
                      onPress={() => setTimeSlots(timeSlots.filter((_, idx) => idx !== i))}
                    >
                      <Ionicons name="close" size={16} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable
                style={styles.addSlot}
                onPress={() => setTimeSlots([...timeSlots, { time: "", capacity: 50 }])}
                testID="seatmap-add-slot-btn"
              >
                <Ionicons name="add" size={16} color={colors.accentText} />
                <Text style={styles.addSlotText}>Add another showing</Text>
              </Pressable>
            </>
          )}

          {bookingType === "general" && (
            <>
              <Label styles={styles}>Total Seats</Label>
              <TextInput testID="total-seats-input" style={styles.input} value={totalSeats} onChangeText={setTotalSeats} keyboardType="number-pad" placeholderTextColor={colors.muted} />
            </>
          )}

          {bookingType === "time_slot" && (
            <>
              <Label styles={styles}>Time Slots</Label>
              <Text style={styles.slotHelper}>
                Add each slot and how many seats it can hold.
              </Text>
              {timeSlots.map((s, i) => (
                <View key={i} style={styles.slotRow}>
                  <TextInput
                    testID={`slot-input-${i}`}
                    style={[styles.input, styles.slotTimeInput]}
                    placeholder="e.g. 2:00 PM Session"
                    value={s.time}
                    onChangeText={(v) => {
                      const next = [...timeSlots]; next[i] = { ...next[i], time: v }; setTimeSlots(next);
                    }}
                    placeholderTextColor={colors.muted}
                  />
                  <View style={styles.slotCapWrap}>
                    <TextInput
                      testID={`slot-capacity-${i}`}
                      style={[styles.input, styles.slotCapInput]}
                      placeholder="Seats"
                      keyboardType="number-pad"
                      value={String(s.capacity)}
                      onChangeText={(v) => {
                        const n = parseInt(v.replace(/[^0-9]/g, "")) || 0;
                        const next = [...timeSlots]; next[i] = { ...next[i], capacity: n }; setTimeSlots(next);
                      }}
                      placeholderTextColor={colors.muted}
                    />
                    <Text style={styles.slotCapUnit}>seats</Text>
                  </View>
                  {timeSlots.length > 1 && (
                    <Pressable
                      testID={`slot-remove-${i}`}
                      style={styles.slotRemove}
                      onPress={() => setTimeSlots(timeSlots.filter((_, idx) => idx !== i))}
                    >
                      <Ionicons name="close" size={16} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable
                style={styles.addSlot}
                onPress={() => setTimeSlots([...timeSlots, { time: "", capacity: 50 }])}
                testID="add-slot-btn"
              >
                <Ionicons name="add" size={16} color={colors.accentText} />
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
                <Text style={styles.submitText}>
                  {isEdit
                    ? "Save Changes"
                    : quota?.organizer && quota.organizer.free_events_remaining <= 0
                    ? `Publish for ₹${quota.organizer.platform_fee_inr}`
                    : "Publish Event"}
                </Text>
                <Ionicons name="rocket" size={18} color={colors.onBrandPrimary} />
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <LocationPicker
        visible={pickerOpen}
        initialLat={parseFloat(latitude) || 19.076}
        initialLng={parseFloat(longitude) || 72.877}
        initialLabel={locationName}
        onCancel={() => setPickerOpen(false)}
        onSelect={(loc) => {
          setLatitude(String(loc.latitude));
          setLongitude(String(loc.longitude));
          if (!locationName || locationName.length === 0) {
            setLocationName(loc.label);
          }
          setPickerOpen(false);
        }}
      />

      <RazorpayCheckout
        visible={rzpVisible}
        order={rzpOrder}
        onSuccess={onPlatformFeeVerified}
        onCancel={() => {
          setRzpVisible(false);
          setRzpOrder(null);
          pendingBodyRef.current = null;
          setError("Publish payment cancelled. Try again when you're ready.");
        }}
        onError={(msg) => {
          setRzpVisible(false);
          setRzpOrder(null);
          setError(msg || "Payment failed");
        }}
      />
    </SafeAreaView>
  );
}

function Label({ styles, children }: { styles: any; children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: 20, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 22, fontWeight: "800", color: colors.onSurface },
  deleteBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.error + "1F",
    borderWidth: 1, borderColor: colors.error + "55",
    alignItems: "center", justifyContent: "center",
  },
  label: {
    fontSize: 12, color: colors.muted, marginBottom: 6,
    marginTop: spacing.lg, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16, paddingHorizontal: spacing.lg, minHeight: 52, paddingVertical: 14,
    fontSize: 15, color: colors.onSurface, fontWeight: "600",
    borderColor: colors.border, borderWidth: 1,
    marginBottom: spacing.xs,
  },
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.lg, height: 38, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, color: colors.onSurface, fontWeight: "700" },
  chipTextActive: { color: colors.onBrandPrimary, fontWeight: "800" },
  imgOption: { padding: 2, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  imgOptionActive: { borderColor: colors.brand },
  uploadCard: {
    width: 94, height: 64, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.brand,
    borderStyle: "dashed",
    backgroundColor: colors.brand + "14",
    alignItems: "center", justifyContent: "center",
    gap: 2, marginTop: 2,
  },
  uploadText: { fontSize: 11, color: colors.accentText, fontWeight: "800" },
  row2: { flexDirection: "row", gap: spacing.md },
  gpsBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingVertical: 8, marginTop: 2,
  },
  gpsText: { color: colors.accentText, fontSize: 13, fontWeight: "700" },
  pinAdjustBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.md, minHeight: 48,
    marginTop: spacing.sm,
  },
  pinAdjustText: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  quotaBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderRadius: 18, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1,
  },
  quotaIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.lime,
    alignItems: "center", justifyContent: "center",
  },
  quotaFree: { backgroundColor: colors.lime + "1A", borderColor: colors.lime + "59" },
  quotaPaid: { backgroundColor: colors.brand + "1A", borderColor: colors.brand + "66" },
  quotaTitleFree: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  quotaSubFree: { color: colors.soft, fontSize: 12, marginTop: 2 },
  quotaTitlePaid: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  quotaSubPaid: { color: colors.soft, fontSize: 12, marginTop: 2 },
  statusBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    borderRadius: 18, padding: spacing.md,
    marginBottom: spacing.sm,
  },
  statusBannerIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  statusBannerTitle: { fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },
  statusBannerSub: { fontSize: 12, marginTop: 2, opacity: 0.9 },
  holdReasonsList: { marginTop: 8, gap: 4 },
  holdReasonItem: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  holdReasonItemText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  locPicker: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: spacing.md,
    borderColor: colors.border, borderWidth: 1,
  },
  locIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.brand + "29",
    alignItems: "center", justifyContent: "center",
  },
  locPickerTitle: { fontSize: 15, color: colors.onSurface, fontWeight: "700" },
  locPickerSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  typeCol: { gap: spacing.sm },
  typeItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, minHeight: 54, borderRadius: 16,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  typeItemActive: { borderColor: colors.brand, borderWidth: 1.5, backgroundColor: colors.brand + "1A" },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  typeText: { fontSize: 15, color: colors.onSurface, fontWeight: "700" },
  addSlot: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    paddingVertical: 10, paddingHorizontal: 4,
  },
  addSlotText: { color: colors.accentText, fontWeight: "800" },
  slotHelper: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm, marginTop: -2 },
  slotRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  slotTimeInput: { flex: 1.4, marginBottom: 0 },
  slotCapWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  slotCapInput: { flex: 1, marginBottom: 0, textAlign: "center", paddingHorizontal: 8 },
  slotCapUnit: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  slotRemove: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.error + "1F",
  },
  error: {
    color: colors.error, marginTop: spacing.md, fontWeight: "700",
    backgroundColor: colors.error + "1A", padding: spacing.md, borderRadius: 14,
    borderWidth: 1, borderColor: colors.error + "55",
  },
  stickyBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopColor: colors.border, borderTopWidth: 1,
    padding: spacing.lg, paddingBottom: 20,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandPrimary, borderRadius: 16,
    height: 54,
    ...shadows.glow,
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});