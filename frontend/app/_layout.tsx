import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/AuthContext";
import { ThemeProvider, useTheme } from "@/src/ThemeContext";
import { checkAndApplyUpdate } from "@/src/updates";
import "@/src/webAlert";

// Warnings show in development builds only (LogBox never shows in release).
LogBox.ignoreAllLogs(!__DEV__);

SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const { colors, mode } = useTheme();
  return (
    <>
      <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.surface} />
      {Platform.OS === "web" ? (
        // Web: the app keeps phone width, centred, on tablets and desktops.
        <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary }}>
          <View style={{ flex: 1, width: "100%", maxWidth: 480, overflow: "hidden", backgroundColor: colors.surface }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
          </View>
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
      )}
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Fire-and-forget OTA update check on cold start. If a newer JS bundle
  // is available, expo-updates downloads it and reloads the app silently.
  useEffect(() => {
    checkAndApplyUpdate();
  }, []);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedStack />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
