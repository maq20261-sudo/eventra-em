import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Pressable, Modal, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/src/theme";

export type RzpOrder = {
  intent_id: string;
  razorpay_order_id: string;
  razorpay_key_id: string;
  amount_paise: number;
  amount_inr: number;
  amount_usd: number;
  currency: string;
  description: string;
  prefill: { name: string; email: string };
};

export type RzpSuccess = {
  intent_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type Props = {
  visible: boolean;
  order: RzpOrder | null;
  onSuccess: (payload: RzpSuccess) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

function buildHtml(order: RzpOrder): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pay</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    body { margin: 0; padding: 0; background: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .wrap { padding: 24px; text-align: center; }
    .btn { display: inline-block; margin-top: 16px; padding: 14px 24px; background: #059669; color: white; border-radius: 999px; border: 0; font-size: 15px; font-weight: 600; }
    p { color: #6B7280; }
  </style>
</head>
<body>
  <div class="wrap">
    <p>Opening Razorpay Checkout…</p>
    <button class="btn" onclick="startPayment()">Open payment</button>
  </div>
  <script>
    function post(payload) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }
    function startPayment() {
      var options = {
        key: ${JSON.stringify(order.razorpay_key_id)},
        amount: ${order.amount_paise},
        currency: ${JSON.stringify(order.currency)},
        order_id: ${JSON.stringify(order.razorpay_order_id)},
        name: "GatherSpace",
        description: ${JSON.stringify(order.description)},
        prefill: {
          name: ${JSON.stringify(order.prefill.name)},
          email: ${JSON.stringify(order.prefill.email)}
        },
        theme: { color: "#059669" },
        modal: {
          ondismiss: function () {
            post({ type: "cancel" });
          }
        },
        handler: function (response) {
          post({
            type: "success",
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          });
        }
      };
      try {
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (resp) {
          post({ type: "error", message: (resp && resp.error && resp.error.description) || "Payment failed" });
        });
        rzp.open();
      } catch (e) {
        post({ type: "error", message: (e && e.message) || "Failed to open checkout" });
      }
    }
    setTimeout(startPayment, 350);
  </script>
</body>
</html>`;
}

export default function RazorpayCheckout({ visible, order, onSuccess, onCancel, onError }: Props) {
  const html = useMemo(() => (order ? buildHtml(order) : ""), [order]);

  // On web, open Razorpay checkout via the Razorpay Web SDK directly (no WebView).
  useEffect(() => {
    if (!visible || !order || Platform.OS !== "web") return;

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      const RazorpayCtor = (globalThis as any).Razorpay;
      if (!RazorpayCtor) {
        onError("Failed to load Razorpay checkout");
        return;
      }
      const rzp = new RazorpayCtor({
        key: order.razorpay_key_id,
        amount: order.amount_paise,
        currency: order.currency,
        order_id: order.razorpay_order_id,
        name: "GatherSpace",
        description: order.description,
        prefill: order.prefill,
        theme: { color: "#059669" },
        modal: {
          ondismiss: () => onCancel(),
        },
        handler: (response: any) => {
          onSuccess({
            intent_id: order.intent_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
        },
      });
      rzp.on("payment.failed", (resp: any) => {
        onError(resp?.error?.description || "Payment failed");
      });
      rzp.open();
    };
    script.onerror = () => onError("Failed to load Razorpay checkout");
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order?.razorpay_order_id]);

  if (Platform.OS === "web") {
    // On web, no header — the Razorpay modal handles its own UI. Show a
    // dismissible loading state while script loads / user interacts.
    if (!visible) return null;
    return (
      <View style={styles.webLoader} pointerEvents="box-none">
        <View style={styles.webLoaderCard}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.webLoaderText}>Opening Razorpay…</Text>
          <Pressable style={styles.webCancel} onPress={onCancel} testID="rzp-web-cancel">
            <Text style={styles.webCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} style={styles.close} testID="rzp-close-btn">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.title}>Secure Checkout</Text>
            {order && (
              <Text style={styles.subtitle}>
                ₹{order.amount_inr} · Razorpay
              </Text>
            )}
          </View>
          <View style={styles.close} />
        </View>
        {order ? (
          <WebView
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://checkout.razorpay.com/" }}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (data.type === "success") {
                  onSuccess({
                    intent_id: order.intent_id,
                    razorpay_order_id: data.razorpay_order_id,
                    razorpay_payment_id: data.razorpay_payment_id,
                    razorpay_signature: data.razorpay_signature,
                  });
                } else if (data.type === "cancel") {
                  onCancel();
                } else if (data.type === "error") {
                  onError(data.message || "Payment failed");
                }
              } catch {}
            }}
            style={styles.web}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.brand} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.md, paddingTop: 44, paddingBottom: spacing.md,
    borderBottomColor: colors.divider, borderBottomWidth: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  close: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  web: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  webLoader: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(17,24,39,0.35)",
  },
  webLoaderCard: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xl,
    borderRadius: 12, alignItems: "center", gap: spacing.md, minWidth: 240,
  },
  webLoaderText: { color: colors.onSurfaceTertiary, fontWeight: "500" },
  webCancel: {
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: 999, backgroundColor: colors.surfaceTertiary,
    marginTop: spacing.sm,
  },
  webCancelText: { color: colors.onSurface, fontWeight: "600" },
});

export const _testHelpers = { buildHtml };
export const dynamicBuildHtml = buildHtml;
