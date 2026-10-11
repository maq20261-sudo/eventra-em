import { useState } from "react";
import { View, StyleSheet, Pressable, Platform, Modal } from "react-native";
import { Text, TextInput } from "@/src/ui/Text";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { spacing, radius } from "@/src/theme";
import { useTheme, type Colors } from "@/src/ThemeContext";

type Props = {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
  minDate?: Date | null;
  testID?: string;
  /** Show only date portion (default: date + time). */
  mode?: "datetime" | "date" | "time";
};

/** A cross-platform tappable date/time input row that opens the native
 * DateTimePicker. On iOS the picker is presented in a bottom-sheet modal so
 * the "spinner"/"compact" behaves like a proper form field. On Android the
 * native dialog is used directly. */
export default function DateTimeField({ label, value, onChange, minDate, testID, mode = "datetime" }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [visible, setVisible] = useState(false);
  const [androidStage, setAndroidStage] = useState<"date" | "time" | null>(null);
  const [tmp, setTmp] = useState<Date | null>(null);

  const open = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const initial = value || new Date();
    if (Platform.OS === "android") {
      setTmp(initial);
      // On Android we chain: date picker → time picker. For mode=date/time only, jump to that step.
      setAndroidStage(mode === "time" ? "time" : "date");
    } else {
      setTmp(initial);
      setVisible(true);
    }
  };

  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === "dismissed") {
      setAndroidStage(null);
      return;
    }
    const d = selected || tmp || new Date();
    if (androidStage === "date" && mode === "datetime") {
      // Keep the previously set time when only date changed.
      const prev = tmp || new Date();
      const merged = new Date(d);
      merged.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      setTmp(merged);
      setAndroidStage("time");
    } else {
      // Final step (either date-only mode, time-only mode, or the time step).
      const finalDate = new Date(d);
      if (androidStage === "time" && tmp && mode === "datetime") {
        finalDate.setFullYear(tmp.getFullYear(), tmp.getMonth(), tmp.getDate());
      }
      onChange(finalDate);
      setAndroidStage(null);
    }
  };

  const confirmIos = () => {
    if (tmp) onChange(tmp);
    setVisible(false);
  };

  const displayValue = () => {
    if (!value) return "Tap to pick";
    if (mode === "date") {
      return value.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
    if (mode === "time") {
      return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return `${value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · ${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <View>
      {Platform.OS === "web" ? (
        <WebField label={label} value={value} onChange={onChange} minDate={minDate} testID={testID} mode={mode} styles={styles} colors={colors} />
      ) : (
        <Pressable style={styles.field} onPress={open} testID={testID}>
          <View style={styles.iconWrap}>
            <Ionicons name={mode === "time" ? "time" : "calendar"} size={18} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.value, !value && styles.placeholder]}>{displayValue()}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
        </Pressable>
      )}

      {/* Android native pickers */}
      {Platform.OS === "android" && androidStage && (
        <DateTimePicker
          value={tmp || new Date()}
          mode={androidStage}
          is24Hour={false}
          minimumDate={minDate || undefined}
          onChange={onAndroidChange}
        />
      )}

      {/* iOS spinner in a bottom-sheet modal */}
      {Platform.OS === "ios" && (
        <Modal transparent visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
          <Pressable style={styles.backdrop} onPress={() => setVisible(false)} />
          <View style={styles.iosSheet}>
            <View style={styles.iosSheetHeader}>
              <Pressable onPress={() => setVisible(false)} testID={testID ? `${testID}-cancel` : undefined}>
                <Text style={styles.iosCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.iosTitle}>{label}</Text>
              <Pressable onPress={confirmIos} testID={testID ? `${testID}-confirm` : undefined}>
                <Text style={styles.iosDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={tmp || new Date()}
              mode={mode as any}
              display="spinner"
              minimumDate={minDate || undefined}
              onChange={(_, d) => d && setTmp(d)}
              themeVariant="light"
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  label: {
    fontSize: 11, color: colors.muted, fontWeight: "500",
    letterSpacing: 0.5, textTransform: "uppercase",
  },
  value: { fontSize: 15, color: colors.onSurface, fontWeight: "500", marginTop: 2 },
  placeholder: { color: colors.muted, fontStyle: "italic" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  iosSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingBottom: 30,
  },
  iosSheetHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  iosTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  iosCancel: { color: colors.muted, fontSize: 15 },
  iosDone: { color: colors.brand, fontWeight: "700", fontSize: 15 },
});

/** Web fallback: uses a plain TextInput with placeholder hints. On web
 * `react-native-web` maps TextInput to `<input>`, so we use the input
 * `type` attribute via `keyboardType` and let the browser render its native
 * datetime picker. */
function WebField({ label, value, onChange, minDate, testID, mode, styles, colors }: {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
  minDate?: Date | null;
  testID?: string;
  mode: "datetime" | "date" | "time";
  styles: any;
  colors: Colors;
}) {
  // Formatted value for the browser-native input.
  const toLocal = (d: Date | null): string => {
    if (!d) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    if (mode === "date") return `${yyyy}-${mm}-${dd}`;
    if (mode === "time") return `${hh}:${mi}`;
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };
  const inputType = mode === "date" ? "date" : mode === "time" ? "time" : "datetime-local";
  return (
    <View style={styles.field}>
      <View style={styles.iconWrap}>
        <Ionicons name={mode === "time" ? "time" : "calendar"} size={18} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          testID={testID}
          value={toLocal(value)}
          onChangeText={(v) => {
            if (!v) return;
            const parsed = new Date(mode === "time" ? `1970-01-01T${v}` : v);
            if (!isNaN(parsed.getTime())) onChange(parsed);
          }}
          // @ts-expect-error react-native-web accepts DOM attrs
          type={inputType}
          min={minDate ? toLocal(minDate) : undefined}
          style={{
            fontSize: 15, color: colors.onSurface, fontWeight: "500",
            marginTop: 2, borderWidth: 0, padding: 0, backgroundColor: "transparent",
            outline: "none" as any,
          }}
          placeholder="Tap to pick"
        />
      </View>
    </View>
  );
}
