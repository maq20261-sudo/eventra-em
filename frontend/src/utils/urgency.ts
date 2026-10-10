// Urgency and social-proof labels derived from data the API already returns
// (booked_count + capacity fields on EventOut). No backend changes needed.

export type CapacityFields = {
  booking_type?: string;
  total_seats?: number | null;
  seat_rows?: number | null;
  seat_cols?: number | null;
  booked_count?: number | null;
  time_slots?: string[] | null;
  slot_capacity?: number | null;
  slot_capacities?: Record<string, number> | null;
};

/** Total sellable units for an event, or 0 when unknown. Same rules as the
 *  organizer My Events progress bar. */
export function capacityOf(e: CapacityFields): number {
  if (e.booking_type === "seat_map") {
    // Seat maps with several showings sell the same grid once per showing.
    const showings = Math.max(1, (e.time_slots || []).length);
    return (e.seat_rows || 0) * (e.seat_cols || 0) * showings;
  }
  if (e.booking_type === "general") return e.total_seats || 0;
  if (e.booking_type === "time_slot") {
    const labels = e.time_slots || [];
    const caps = e.slot_capacities || {};
    const fallback = e.slot_capacity || 1;
    return labels.reduce((sum, t) => sum + (caps[t] ?? fallback), 0);
  }
  return 0;
}

export function seatsLeft(e: CapacityFields): number | null {
  const cap = capacityOf(e);
  if (!cap) return null;
  return Math.max(0, cap - (e.booked_count || 0));
}

export type Urgency = { label: string; tone: "pink" | "warn" | "bad" | "ok" } | null;

/**
 * The single most useful nudge for an event card:
 *  - Sold out
 *  - "Only N left" when ≤ 20 or ≤ 15% remain
 *  - "Selling fast" when ≥ 60% is booked
 */
export function urgencyOf(e: CapacityFields): Urgency {
  const cap = capacityOf(e);
  const left = seatsLeft(e);
  if (!cap || left === null) return null;
  if (left === 0) return { label: "Sold out", tone: "bad" };
  if (left <= 20 || left / cap <= 0.15) return { label: `Only ${left} left`, tone: "pink" };
  if ((e.booked_count || 0) / cap >= 0.6) return { label: "Selling fast", tone: "warn" };
  return null;
}

/** Social proof, e.g. "120+ going". Hidden for small numbers. */
export function goingLabel(e: CapacityFields): string | null {
  const n = e.booked_count || 0;
  if (n < 10) return null;
  if (n >= 100) return `${Math.floor(n / 50) * 50}+ going`;
  return `${n} going`;
}
