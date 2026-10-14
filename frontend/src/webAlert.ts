/**
 * react-native-web's Alert.alert does nothing, which would silently drop
 * confirmations (Cancel event, delete, "Password updated" …) in the web app.
 * Map it to the browser's alert / confirm. Every Alert in the app has at
 * most two buttons: confirm's OK runs the non-cancel button, Cancel the
 * cancel one. Imported once from the root layout; no-op on native.
 */
import { Alert, Platform, type AlertButton } from "react-native";

if (Platform.OS === "web" && typeof window !== "undefined") {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const list = buttons ?? [];
    if (list.length < 2) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find((b) => b.style === "cancel") ?? list[0];
    const action = [...list].reverse().find((b) => b !== cancel) ?? list[list.length - 1];
    if (window.confirm(text)) action.onPress?.();
    else cancel.onPress?.();
  };
}
