import { View, StyleSheet, Pressable, ScrollView, Switch } from "react-native";
import { Text } from "@/src/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/src/AuthContext";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { spacing, fonts } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import Animated, { FadeInDown } from "react-native-reanimated";
import { GlowBackground } from "@/src/ui/GlowBackground";
import { Button } from "@/src/ui/Button";
import { Tag } from "@/src/ui/Tag";

export default function Profile() {
  const { user, signOut } = useAuth();
  const { colors, mode, toggleMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [notifEvents, setNotifEvents] = useState(true);
  const [notifReminders, setNotifReminders] = useState(true);
  const [notifPromos, setNotifPromos] = useState(false);

  useEffect(() => {
    (async () => {
      const e = await storage.getItem<boolean>("gs_notif_events", true);
      const r = await storage.getItem<boolean>("gs_notif_reminders", true);
      const p = await storage.getItem<boolean>("gs_notif_promos", false);
      if (e !== null) setNotifEvents(e);
      if (r !== null) setNotifReminders(r);
      if (p !== null) setNotifPromos(p);
    })();
  }, []);

  const persist = async (key: string, value: boolean) => {
    await storage.setItem(key, value);
    Haptics.selectionAsync();
  };

  const doSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace("/(auth)/welcome");
  };

  const toggle = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenSection(openSection === id ? null : id);
  };

  const initial = user?.name?.charAt(0).toUpperCase() || "U";
  const isOrganizer = user?.role === "organizer";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <GlowBackground />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <Animated.View entering={FadeInDown.duration(350)} style={styles.card}>
          <GlowBackground variant={isOrganizer ? "violet" : "default"} />
          <View style={[styles.avatar, { backgroundColor: isOrganizer ? colors.violet : colors.brand }]}>
            <Text style={[styles.avatarText, { color: isOrganizer ? "#FFFFFF" : colors.onBrandPrimary }]}>{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
            <Tag
              label={isOrganizer ? "Organizer" : "Attendee"}
              tone={isOrganizer ? "lime" : "violet"}
              icon={isOrganizer ? "star" : "ticket"}
              style={{ marginTop: 4 }}
            />
          </View>
        </Animated.View>

        <View style={styles.section}>
          {/* Appearance */}
          <View style={styles.row} testID="row-appearance">
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}>
                <Ionicons name={mode === "dark" ? "moon" : "sunny-outline"} size={18} color={colors.onSurfaceTertiary} />
              </View>
              <View>
                <Text style={styles.rowLabel}>Dark theme</Text>
                <Text style={styles.rowSub}>{mode === "dark" ? "On" : "Off"}</Text>
              </View>
            </View>
            <Switch
              testID="theme-toggle"
              value={mode === "dark"}
              onValueChange={() => { Haptics.selectionAsync(); toggleMode(); }}
              thumbColor="#FFFFFF"
              trackColor={{ true: colors.brand, false: colors.borderStrong }}
            />
          </View>

          {/* Notifications */}
          <Pressable style={styles.row} onPress={() => toggle("notif")} testID="row-notifications">
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}><Ionicons name="notifications-outline" size={18} color={colors.onSurfaceTertiary} /></View>
              <Text style={styles.rowLabel}>Notifications</Text>
            </View>
            <Ionicons name={openSection === "notif" ? "chevron-up" : "chevron-forward"} size={18} color={colors.borderStrong} />
          </Pressable>
          {openSection === "notif" && (
            <View style={styles.subSection}>
              <SubRow
                styles={styles}
                label="New events near you"
                sub="Get notified when organizers post nearby"
                value={notifEvents}
                onChange={(v) => { setNotifEvents(v); persist("gs_notif_events", v); }}
              />
              <SubRow
                styles={styles}
                label="Booking reminders"
                sub="Reminder 24h before your event"
                value={notifReminders}
                onChange={(v) => { setNotifReminders(v); persist("gs_notif_reminders", v); }}
              />
              <SubRow
                styles={styles}
                label="Promotions & offers"
                sub="Deals from featured events"
                value={notifPromos}
                onChange={(v) => { setNotifPromos(v); persist("gs_notif_promos", v); }}
                last
              />
            </View>
          )}

          {/* Privacy */}
          <Pressable style={styles.row} onPress={() => toggle("privacy")} testID="row-privacy">
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}><Ionicons name="lock-closed-outline" size={18} color={colors.onSurfaceTertiary} /></View>
              <Text style={styles.rowLabel}>Privacy</Text>
            </View>
            <Ionicons name={openSection === "privacy" ? "chevron-up" : "chevron-forward"} size={18} color={colors.borderStrong} />
          </Pressable>
          {openSection === "privacy" && (
            <View style={styles.subSection}>
              <Text style={styles.bodyText}>
                We only store your name, email, and bookings. Location is used solely to filter events near you and is never shared with third parties.
              </Text>
              <Text style={styles.bodyText}>
                Passwords are hashed with bcrypt and never stored in plain text. You can request account deletion by contacting support.
              </Text>
            </View>
          )}

          {/* Help */}
          <Pressable style={styles.row} onPress={() => toggle("help")} testID="row-help">
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}><Ionicons name="help-circle-outline" size={18} color={colors.onSurfaceTertiary} /></View>
              <Text style={styles.rowLabel}>Help & Support</Text>
            </View>
            <Ionicons name={openSection === "help" ? "chevron-up" : "chevron-forward"} size={18} color={colors.borderStrong} />
          </Pressable>
          {openSection === "help" && (
            <View style={styles.subSection}>
              <FAQ styles={styles} q="How do I pay for a ticket?" a="Paid events accept online payments via Razorpay (UPI, cards, netbanking, wallets). Free events don't require any payment." />
              <FAQ styles={styles} q="Can I cancel a booking?" a="Yes — open the ticket from My Tickets and tap Cancel. Cancellations are allowed up to 2 hours before event start. Paid tickets get a full refund to the original payment method within 5-7 business days." />
              <FAQ styles={styles} q="Why is my event not appearing on Discover?" a="Events only show within the attendee's chosen radius. Organizers can also boost an event to feature it at the top of results." />
              <FAQ styles={styles} q="Contact us" a="support@gatherspace.in · Mon–Fri, 10am–7pm IST" last />
            </View>
          )}

          {/* About */}
          <Pressable style={[styles.row, styles.rowLast]} onPress={() => toggle("about")} testID="row-about">
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}><Ionicons name="information-circle-outline" size={18} color={colors.onSurfaceTertiary} /></View>
              <Text style={styles.rowLabel}>About</Text>
            </View>
            <Ionicons name={openSection === "about" ? "chevron-up" : "chevron-forward"} size={18} color={colors.borderStrong} />
          </Pressable>
          {openSection === "about" && (
            <View style={[styles.subSection, styles.subSectionLast]}>
              <Text style={styles.aboutTitle}>GatherSpace</Text>
              <Text style={styles.bodyText}>
                A modern event booking platform for concerts, art shows, tech meetups, and more — with real-time seat selection, time-slot booking, and QR check-in.
              </Text>
              <View style={styles.aboutRow}><Text style={styles.aboutLabel}>Version</Text><Text style={styles.aboutValue}>1.0.0</Text></View>
              <View style={styles.aboutRow}><Text style={styles.aboutLabel}>Build</Text><Text style={styles.aboutValue}>Aug 2026</Text></View>
            </View>
          )}
        </View>

        <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={doSignOut} testID="sign-out-btn" />
      </ScrollView>
    </SafeAreaView>
  );
}

function SubRow({ styles, label, sub, value, onChange, last }: { styles: any; label: string; sub: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.subRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.subRowLabel}>{label}</Text>
        <Text style={styles.subRowSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        thumbColor="#FFFFFF"
        trackColor={{ true: colors.brand, false: colors.borderStrong }}
      />
    </View>
  );
}

function FAQ({ styles, q, a, last }: { styles: any; q: string; a: string; last?: boolean }) {
  return (
    <View style={[styles.faqItem, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.faqQ}>{q}</Text>
      <Text style={styles.faqA}>{a}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, gap: spacing.lg, paddingBottom: 32 },
  title: { fontFamily: fonts.display, fontSize: 26, fontWeight: "800", color: colors.onSurface },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: 22,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, overflow: "hidden",
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.display, fontSize: 22, fontWeight: "800" },
  name: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: colors.onSurface },
  email: { fontSize: 13, color: colors.muted },
  section: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, minHeight: 60,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 15, color: colors.onSurface, fontWeight: "700" },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  subSection: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: 4,
    borderBottomColor: colors.border, borderBottomWidth: 1,
    gap: spacing.sm,
    backgroundColor: colors.sheet,
  },
  subSectionLast: { borderBottomWidth: 0 },
  subRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomColor: colors.border, borderBottomWidth: 1,
    gap: spacing.md,
  },
  subRowLabel: { fontSize: 14, color: colors.onSurface, fontWeight: "700" },
  subRowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  hint: { fontSize: 12, color: colors.muted, fontStyle: "italic", marginTop: 4 },
  bodyText: { fontSize: 14, color: colors.soft, lineHeight: 20 },
  faqItem: {
    paddingVertical: spacing.md,
    borderBottomColor: colors.border, borderBottomWidth: 1,
    gap: 4,
  },
  faqQ: { fontSize: 14, color: colors.onSurface, fontWeight: "700" },
  faqA: { fontSize: 13, color: colors.soft, lineHeight: 19 },
  aboutTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  aboutRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8,
    borderTopColor: colors.border, borderTopWidth: 1,
  },
  aboutLabel: { fontSize: 13, color: colors.muted },
  aboutValue: { fontSize: 13, color: colors.onSurface, fontWeight: "700" },
});