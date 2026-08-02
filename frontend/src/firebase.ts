/**
 * Phone-OTP verification wrapper (native only).
 *
 * On web/Expo Go the native module isn't linked; we lazy-load and expose
 * `isPhoneAuthSupported()` so callers can degrade gracefully.
 */
import { Platform } from "react-native";

export type PhoneConfirmation = {
  __confirmation: any; // FirebaseAuthTypes.ConfirmationResult
  mobileMasked: string;
};

// Try to import the module once; keep the whole namespace so we can pull
// the modular functions (getAuth / signInWithPhoneNumber / getIdToken /
// signOut) at call-time.
let _fbAuth: any = null;
const RN_FIREBASE_AUTH_AVAILABLE = (() => {
  if (Platform.OS === "web") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _fbAuth = require("@react-native-firebase/auth");
    return !!_fbAuth;
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

/** Resolve the current auth instance using whichever API surface this
 *  version of RN Firebase exposes. v25+ uses the modular `getAuth()`,
 *  older versions used a callable default export `auth()`. Support both. */
function resolveAuth(): any {
  if (!_fbAuth) throw new Error("Verification service unavailable. Please try again.");
  if (typeof _fbAuth.getAuth === "function") return _fbAuth.getAuth();
  if (typeof _fbAuth.default === "function") return _fbAuth.default();
  throw new Error("Verification service unavailable. Please try again.");
}

/** Send OTP via phone auth. Pass `forceResend = true` from the OTP screen's
 *  "Resend" button so Firebase issues a brand-new SMS instead of coalescing
 *  it with the original request (which was silently dropping our resends). */
export async function sendOtp(mobile: string, forceResend: boolean = false): Promise<PhoneConfirmation> {
  if (!RN_FIREBASE_AUTH_AVAILABLE) {
    throw new Error(
      "Phone sign-in isn't available on this platform. Please open GatherSpace on your phone to continue."
    );
  }
  const e164 = toE164India(mobile);
  try {
    const authInstance = resolveAuth();
    let confirmation: any;
    // Prefer modular API (v25+); fall back to namespaced instance method.
    // Both support the `forceResend` third arg — pass it through so tapping
    // "Resend OTP" actually re-triggers SMS instead of being deduplicated.
    if (typeof _fbAuth.signInWithPhoneNumber === "function") {
      confirmation = await _fbAuth.signInWithPhoneNumber(authInstance, e164, forceResend);
    } else if (typeof authInstance.signInWithPhoneNumber === "function") {
      confirmation = await authInstance.signInWithPhoneNumber(e164, forceResend);
    } else {
      throw new Error("Verification service unavailable. Please try again.");
    }
    return { __confirmation: confirmation, mobileMasked: maskE164(e164) };
  } catch (e: any) {
    const code = e?.code || "";
    if (code.includes("invalid-phone-number"))
      throw new Error("Invalid phone number. Use a 10-digit Indian mobile (starts 6/7/8/9).");
    if (code.includes("too-many-requests"))
      throw new Error("Too many attempts. Please retry after sometime.");
    if (code.includes("quota-exceeded"))
      throw new Error("Daily limit reached for this number. Please try again tomorrow.");
    if (code.includes("missing-client-identifier") || code.includes("app-not-authorized"))
      throw new Error(
        "This device isn't yet authorised for verification. Please contact support."
      );
    if (code.includes("network"))
      throw new Error("Network error. Please check your connection and retry.");
    throw new Error(e?.message || "Couldn't send OTP. Please try again.");
  }
}

/** Verify the entered code with Firebase and return the ID token. */
export async function verifyOtp(conf: PhoneConfirmation, otp: string): Promise<string> {
  if (!RN_FIREBASE_AUTH_AVAILABLE || !conf?.__confirmation) {
    throw new Error("Verification session missing. Please request a new OTP.");
  }
  try {
    const credential = await conf.__confirmation.confirm(otp);
    const authInstance = resolveAuth();
    const currentUser = credential?.user || authInstance.currentUser;
    if (!currentUser) throw new Error("Verification session expired. Please try again.");
    // Modular getIdToken(user, forceRefresh) OR instance-method getIdToken(forceRefresh)
    let idToken: string | null = null;
    if (typeof _fbAuth.getIdToken === "function") {
      idToken = await _fbAuth.getIdToken(currentUser, true);
    } else if (typeof currentUser.getIdToken === "function") {
      idToken = await currentUser.getIdToken(true);
    }
    if (!idToken) throw new Error("Couldn't fetch verification token.");
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

/** Sign out from Firebase (clears currentUser on-device). */
export async function firebaseSignOut(): Promise<void> {
  if (!RN_FIREBASE_AUTH_AVAILABLE) return;
  try {
    const authInstance = resolveAuth();
    if (typeof _fbAuth.signOut === "function") {
      await _fbAuth.signOut(authInstance);
    } else if (typeof authInstance.signOut === "function") {
      await authInstance.signOut();
    }
  } catch {
    /* ignore */
  }
}
