// Floating pill tab bar used by both the attendee and organizer tab layouts.
import React from "react";
import { StyleSheet, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/src/ui/Text";
import { PressableScale } from "@/src/ui/PressableScale";
import { useTheme } from "@/src/ThemeContext";

export function NeonTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const visible = state.routes.filter((route) => {
    const options = descriptors[route.key].options as any;
    // expo-router turns `href: null` into a hidden item
    return options.href !== null && options.tabBarItemStyle?.display !== "none" && !route.name.includes("[");
  });

  return (
    <View style={[styles.outer, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.bar, { backgroundColor: colors.surfaceTertiary, borderColor: colors.border }]}>
        {visible.map((route) => {
          const { options } = descriptors[route.key];
          const focused = state.routes[state.index]?.key === route.key;
          const color = focused ? colors.brand : colors.muted;
          const label = typeof options.title === "string" ? options.title : route.name;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <PressableScale
              key={route.key}
              haptic
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
              onPress={onPress}
              style={styles.item}
              pressedScale={0.9}
            >
              {options.tabBarIcon?.({ focused, color, size: 22 })}
              <Text style={[styles.label, { color, fontWeight: focused ? "800" : "600" }]} numberOfLines={1}>
                {label}
              </Text>
              <View style={[styles.dot, { backgroundColor: focused ? colors.brand : "transparent" }]} />
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 14, paddingTop: 6 },
  bar: { flexDirection: "row", height: 66, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "space-around" },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56 },
  label: { fontSize: 11 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
