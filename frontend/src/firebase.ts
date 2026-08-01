/**
 * Firebase Phone Auth wrapper.
 *
 * `@react-native-firebase/auth` is a native module — it only works after a
 * dev-client/production build. In Expo Go / web previews the native code
 * doesn't exist, so we lazy-load it and expose a clear `isSupported` flag
 * to callers.
 */
import { Platform } from "react-native";

// A confirmation object returned by Firebase after signInWithPhoneNumber.
// Kept opaque from callers — they treat it as a token they must pass back
// to `verifyOtp` unchanged.
export type PhoneConfirmation = {
  __confirmation: any; // FirebaseAuthTypes.ConfirmationResult
  mobileMasked: string;
};

const RN_FIREBASE_AUTH_AVAILABLE = (() => {
  if (Platform.OS === "web") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@react-native-firebase/auth");
    return true;
  } catch {
    return false;
  }
})();

export function isPhoneAuthSupported(): boolean {
  return RN_FIREBASE_AUTH_AVAILABLE;
}

export function toE164India(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  if (digits.length === 10) return "+91" + digits;
  if (raw.startsWith("+")) return "+" + digits;
  return "+91" + digits;
}

export function maskE164(e164: string): string {
  if (!e164 || e164.length < 6) return e164;
  const tail = e164.slice(-4);
  return `${e164.slice(0, 3)} ${e164.slice(3, 5)}XX XX${tail}`;
}

/** Send OTP via Firebase Phone Auth. Throws with a clear message on native
 *  when Play Integrity / config isn't set up correctly. */
export async function sendOtp(mobile: string): Promise<PhoneConfirmation> {
  if (!RN_FIREBASE_AUTH_AVAILABLE) {
    throw new Error(
      "Phone sign-in isn't available on this platform. Please open GatherSpace on your phone to continue."
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const authModule = require("@react-native-firebase/auth").default;
  const e164 = toE164India(mobile);
  try {
    const confirmation = await authModule().signInWithPhoneNumber(e164);
    return { __confirmation: confirmation, mobileMasked: maskE164(e164) };
  } catch (e: any) {
    const code = e?.code || "";
    if (code.includes("invalid-phone-number"))
      throw new Error("Invalid phone number. Use a 10-digit Indian mobile (starts 6/7/8/9).");
    if (code.includes("too-many-requests"))
      throw new Error("Too many attempts. Please wait a while before trying again.");
    if (code.includes("missing-client-identifier") || code.includes("app-not-authorized"))
      throw new Error(
        "This app isn't yet authorised for Firebase Phone Auth. Add the build's SHA-1 fingerprint in Firebase Console → your Android app → Add fingerprint."
      );
    throw new Error(e?.message || "Couldn't send OTP");
  }
}

/** Verify the entered code with Firebase and return the ID token. */
export async function verifyOtp(conf: PhoneConfirmation, otp: string): Promise<string> {
  if (!RN_FIREBASE_AUTH_AVAILABLE || !conf?.__confirmation) {
    throw new Error("Verification session missing. Please request a new OTP.");
  }
  try {
    const credential = await conf.__confirmation.confirm(otp);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authModule = require("@react-native-firebase/auth").default;
    const currentUser = credential?.user || authModule().currentUser;
    if (!currentUser) throw new Error("No signed-in Firebase user after verify");
    const idToken = await currentUser.getIdToken(true);
    return idToken;
  } catch (e: any) {
    const code = e?.code || "";
    if (code.includes("invalid-verification-code"))
      throw new Error("Incorrect OTP. Please check the code and try again.");
    if (code.includes("code-expired"))
      throw new Error("OTP expired. Please tap Resend and try again.");
    throw new Error(e?.message || "Verification failed");
  }
}

/** Sign out from Firebase (clears the currentUser on-device). */
export async function firebaseSignOut(): Promise<void> {
  if (!RN_FIREBASE_AUTH_AVAILABLE) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authModule = require("@react-native-firebase/auth").default;
    await authModule().signOut();
  } catch {
    /* ignore */
  }
}
