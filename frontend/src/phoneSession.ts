/**
 * In-memory session store for the currently-active Firebase Phone Auth
 * confirmation. The confirmation object is not serialisable via router
 * params, so we stash it here and read it on the OTP screen.
 */
import type { PhoneConfirmation } from "./firebase";

type PhoneSession = {
  confirmation: PhoneConfirmation;
  kind: "login" | "register" | "reset";
  role?: "consumer" | "organizer";
  name?: string;
  email?: string;
  password?: string;
  mobile: string; // E.164 or raw digits — used only for display
};

let current: PhoneSession | null = null;

export function setPhoneSession(s: PhoneSession) {
  current = s;
}

export function getPhoneSession(): PhoneSession | null {
  return current;
}

export function clearPhoneSession() {
  current = null;
}
