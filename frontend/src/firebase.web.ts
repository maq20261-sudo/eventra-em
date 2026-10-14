/**
 * Phone-OTP verification for the web app (app.gatherspace.in).
 *
 * Same API as `firebase.ts` (native, @react-native-firebase), built on the
 * Firebase JS SDK with an invisible reCAPTCHA. Metro picks this file for web
 * builds automatically. Config comes from EXPO_PUBLIC_FIREBASE_WEB_* (public
 * values; the API key must stay restricted to our web domains in Google
 * Cloud Console).
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
} from "firebase/auth";

export type PhoneConfirmation = {
  __confirmation: any; // firebase/auth ConfirmationResult
  mobileMasked: string;
  e164: string; // the number this OTP was sent to
};

const CONFIG = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_WEB_API_KEY,
  appId: process.env.EXPO_PUBLIC_FIREBASE_WEB_APP_ID,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "gatherspace-541ac",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "gatherspace-541ac.firebaseapp.com",
};

const CONFIGURED = typeof window !== "undefined" && !!CONFIG.apiKey && !!CONFIG.appId;

export function isPhoneAuthSupported(): boolean {
  return CONFIGURED;
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

let _auth: Auth | null = null;
function auth(): Auth {
  if (!CONFIGURED) throw new Error("Verification service unavailable. Please try again.");
  if (!_auth) {
    const app = getApps().length ? getApp() : initializeApp(CONFIG);
    _auth = getAuth(app);
    _auth.languageCode = "en";
  }
  return _auth;
}

// One invisible reCAPTCHA per page, attached to a hidden container.
const RECAPTCHA_ID = "gs-recaptcha";
let _verifier: RecaptchaVerifier | null = null;
function verifier(a: Auth): RecaptchaVerifier {
  if (_verifier) return _verifier;
  if (!document.getElementById(RECAPTCHA_ID)) {
    const el = document.createElement("div");
    el.id = RECAPTCHA_ID;
    document.body.appendChild(el);
  }
  _verifier = new RecaptchaVerifier(a, RECAPTCHA_ID, { size: "invisible" });
  return _verifier;
}
function resetVerifier() {
  try { _verifier?.clear(); } catch { /* ignore */ }
  _verifier = null;
  document.getElementById(RECAPTCHA_ID)?.remove();
}

/** Send OTP via phone auth. `forceResend` is accepted for parity with the
 *  native module; on web every call sends a fresh SMS. */
export async function sendOtp(mobile: string, _forceResend: boolean = false): Promise<PhoneConfirmation> {
  if (!CONFIGURED) {
    throw new Error("Phone sign-in isn't available right now. Please try again later.");
  }
  const e164 = toE164India(mobile);
  const a = auth();
  // A leftover verification for another number must never stand in for this OTP.
  if (a.currentUser && a.currentUser.phoneNumber !== e164) await firebaseSignOut();
  try {
    const confirmation: ConfirmationResult = await signInWithPhoneNumber(a, e164, verifier(a));
    return { __confirmation: confirmation, mobileMasked: maskE164(e164), e164 };
  } catch (e: any) {
    // A used / expired reCAPTCHA can't be reused — start fresh next time.
    resetVerifier();
    const code = e?.code || "";
    if (code.includes("invalid-phone-number"))
      throw new Error("Invalid phone number. Use a 10-digit Indian mobile (starts 6/7/8/9).");
    if (code.includes("too-many-requests"))
      throw new Error("Too many attempts. Please retry after sometime.");
    if (code.includes("quota-exceeded"))
      throw new Error("Daily limit reached for this number. Please try again tomorrow.");
    if (code.includes("captcha") || code.includes("unauthorized-domain") || code.includes("app-not-authorized"))
      throw new Error("Couldn't verify this browser. Please refresh the page and try again.");
    if (code.includes("network"))
      throw new Error("Network error. Please check your connection and retry.");
    throw new Error(e?.message || "Couldn't send OTP. Please try again.");
  }
}

/** Verify the entered code with Firebase and return the ID token. */
export async function verifyOtp(conf: PhoneConfirmation, otp: string): Promise<string> {
  if (!CONFIGURED || !conf?.__confirmation) {
    throw new Error("Verification session missing. Please request a new OTP.");
  }
  try {
    const credential = await (conf.__confirmation as ConfirmationResult).confirm(otp);
    if (credential.user.phoneNumber !== conf.e164) {
      throw new Error("Verification doesn't match this mobile number. Please request a new OTP.");
    }
    return await credential.user.getIdToken(true);
  } catch (e: any) {
    const code = e?.code || "";
    if (code.includes("invalid-verification-code"))
      throw new Error("Incorrect OTP. Please check the code and try again.");
    if (code.includes("code-expired") || code.includes("session-expired"))
      throw new Error("OTP expired. Please tap Resend to get a new code.");
    if (code.includes("missing-verification-code") || code.includes("missing-verification-id"))
      throw new Error("Verification session missing. Please tap Resend and try again.");
    throw new Error(e?.message || "Verification failed");
  }
}

/** Sign out from Firebase (clears the verified phone session in this browser). */
export async function firebaseSignOut(): Promise<void> {
  if (!CONFIGURED) return;
  try {
    await signOut(auth());
  } catch {
    /* ignore */
  }
}
