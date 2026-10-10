// Shared entrance animations. Kept deliberately subtle: a short fade with a
// small scale-up (no springy overshoot), so dialogs and icons appear gently.
import { Easing, withDelay, withTiming } from "react-native-reanimated";

/** Fade in while scaling from 96% to 100%. Use as `entering={softPop()}`. */
export function softPop(delay = 0, from = 0.96) {
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: from }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) })),
        transform: [{ scale: withDelay(delay, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })) }],
      },
    };
  };
}
