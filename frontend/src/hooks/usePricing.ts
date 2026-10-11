import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";

export type PricingConfig = {
  attendee_platform_fee_inr: number;
  organizer_platform_fee_inr: number;
  attendee_free_booking_limit: number;
  organizer_free_event_limit: number;
  boost_tiers?: BoostTier[];
};

export type BoostTier = { key: "24h" | "7d" | "30d"; price_inr: number; hours: number; label: string };

export type Quota = {
  attendee?: {
    paid_bookings_used: number;
    free_bookings_remaining: number;
    free_booking_limit: number;
    platform_fee_inr: number;
  };
  organizer?: {
    events_used: number;
    free_events_remaining: number;
    free_event_limit: number;
    platform_fee_inr: number;
  };
};

/** Fetches the public pricing config once per app session. Cheap enough
 * to re-fetch on screens that display fees. */
export function usePricingConfig() {
  const [config, setConfig] = useState<PricingConfig | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const c = await api.pricingConfig();
        setConfig(c);
      } catch { /* silent — UI falls back to hardcoded ₹9/₹19 defaults */ }
    })();
  }, []);
  return config;
}

/** Fetches the current authed user's remaining free-tier quota. Returns
 * a `refresh` callback so screens can re-fetch after a booking / event
 * creation succeeds. */
export function useQuota(authed: boolean) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const refresh = useCallback(async () => {
    if (!authed) return;
    try {
      const q = await api.myQuota();
      setQuota(q);
    } catch { /* silent */ }
  }, [authed]);
  useEffect(() => { refresh(); }, [refresh]);
  // Auto-refresh on screen focus so quota updates after publishing / booking.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return { quota, refresh };
}
