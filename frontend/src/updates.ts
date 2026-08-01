/**
 * OTA update helper — checks for a newer JS bundle on app launch and
 * hot-swaps it if one is available. Fails silently in dev / Expo Go /
 * web so it never breaks the preview loop.
 */
import * as Updates from "expo-updates";
import { Platform } from "react-native";

const NATIVE_OTA_SUPPORTED = Platform.OS !== "web" && Updates.isEnabled;

/** Called once on app boot. Reloads the app if a fresh JS bundle is
 *  downloaded successfully. Non-fatal on any failure. */
export async function checkAndApplyUpdate(): Promise<void> {
  if (!NATIVE_OTA_SUPPORTED) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) {
      // Small delay lets the boot UI finish drawing so the reload isn't jarring.
      setTimeout(() => {
        Updates.reloadAsync().catch(() => {});
      }, 800);
    }
  } catch {
    /* silent — bad network / no update channel configured yet */
  }
}
