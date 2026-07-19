import { useEffect, useMemo } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/AuthContext";

import { useTheme, type Colors } from "@/src/ThemeContext";

export default function Index() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/(auth)/welcome");
    } else if (user.role === "organizer") {
      router.replace("/(organizer)/events");
    } else {
      router.replace("/(consumer)/discover");
    }
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="app-index">
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
