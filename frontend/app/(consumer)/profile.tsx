import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/src/AuthContext";
import { useTheme, type Colors } from "@/src/ThemeContext";
import { spacing, radius, shadows } from "@/src/theme";
import { storage } from "@/src/utils/storage";

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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons
              name={user?.role === "organizer" ? "star" : "ticket"}
              size={12}
              color={colors.onBrandTertiary}
            />
            <Text style={styles.roleText}>{user?.role === "organizer" ? "Organizer" : "Attendee"}</Text>
          </View>
        </View>

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
              thumbColor={mode === "dark" ? colors.brand : colors.borderStrong}
              trackColor={{ true: colors.brandTertiary, false: colors.surfaceTertiary }}
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
              <Text style={styles.hint}>Enable device permissions once the app is deployed to a build to start receiving alerts.</Text>
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
              <FAQ styles={styles} q="How do I pay for a ticket?" a="For this release, payment is collected at the venue. The organizer will scan your QR ticket and confirm payment on arrival." />
              <FAQ styles={styles} q="Can I cancel a booking?" a="Yes — open the ticket from My Tickets and use the cancel option. Cancelled tickets cannot be scanned." />
              <FAQ styles={styles} q="Why is my event not appearing on Discover?" a="Events only show within the attendee's chosen radius. Organizers can also boost an event to feature it at the top of results." />
              <FAQ styles={styles} q="Contact us" a="support@gatherspace.app · Mon–Fri, 9am–6pm PT" last />
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
              <View style={styles.aboutRow}><Text style={styles.aboutLabel}>Build</Text><Text style={styles.aboutValue}>Feb 2026</Text></View>
            </View>
          )}
        </View>

        <Pressable style={styles.signOut} onPress={doSignOut} testID="sign-out-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
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
        thumbColor={value ? colors.brand : colors.borderStrong}
        trackColor={{ true: colors.brandTertiary, false: colors.surfaceTertiary }}
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
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.xl, alignItems: "center", gap: 6, ...shadows.card,
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 30, fontWeight: "700", color: colors.onBrandTertiary },
  name: { fontSize: 20, fontWeight: "600", color: colors.onSurface },
  email: { fontSize: 14, color: colors.muted },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  roleText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: "600" },
  section: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, ...shadows.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: 14,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 15, color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  subSection: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: 4,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  subSectionLast: { borderBottomWidth: 0 },
  subRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
    gap: spacing.md,
  },
  subRowLabel: { fontSize: 14, color: colors.onSurface, fontWeight: "500" },
  subRowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  hint: { fontSize: 12, color: colors.muted, fontStyle: "italic", marginTop: 4 },
  bodyText: { fontSize: 14, color: colors.onSurfaceTertiary, lineHeight: 20 },
  faqItem: {
    paddingVertical: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
    gap: 4,
  },
  faqQ: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  faqA: { fontSize: 13, color: colors.onSurfaceTertiary, lineHeight: 18 },
  aboutTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  aboutRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8,
    borderTopColor: colors.divider, borderTopWidth: 1,
  },
  aboutLabel: { fontSize: 13, color: colors.muted },
  aboutValue: { fontSize: 13, color: colors.onSurface, fontWeight: "500" },
  signOut: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    padding: spacing.md, borderRadius: radius.md,
  },
  signOutText: { color: colors.error, fontWeight: "600", fontSize: 15 },
});
