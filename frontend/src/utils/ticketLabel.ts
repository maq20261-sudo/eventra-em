/** Shared helper: given a booking, decide which "ticket type" label to show.
 *
 * Priority is nuanced — a booking can carry BOTH `seats` and `time_slot`
 * (seat_map + slot events). In that case the primary label is "Seats" (the
 * time slot is surfaced separately via the slot-highlight banner). A pure
 * time_slot booking (no seats picked) shows "Time slot".
 * Kept in one place so ticket, bookings list, and scanner stay consistent.
 */

export type BookingLike = {
  time_slot?: string | null;
  num_seats?: number | null;
  seats?: string[] | null;
};

export function ticketTypeLabel(b: BookingLike | null | undefined): string {
  if (!b) return "Entry";
  if (b.seats && b.seats.length) return "Seats";
  if (b.time_slot) return "Time slot";
  if (b.num_seats) return "Tickets";
  return "Entry";
}

/** Human-readable value that pairs with `ticketTypeLabel`. */
export function ticketTypeValue(b: BookingLike | null | undefined): string {
  if (!b) return "";
  if (b.seats && b.seats.length) return b.seats.join(", ");
  if (b.time_slot) {
    const n = Number(b.num_seats || 0);
    return n > 1 ? `${b.time_slot} · ${n} seats` : b.time_slot;
  }
  if (b.num_seats) return `${b.num_seats} × ticket`;
  return "General";
}

/** Structured version for the organizer scanner that also picks an icon.
 * For seat_map+slot bookings shows BOTH seats and slot so the check-in
 * operator sees everything they need at a glance. */
export function ticketTypeLine(b: BookingLike | null | undefined): { label: string; icon: string } {
  if (!b) return { label: "-", icon: "ticket-outline" };
  if (b.seats && b.seats.length) {
    const seatStr = `Seats · ${b.seats.join(", ")}`;
    if (b.time_slot) return { label: `${seatStr}  ·  ${b.time_slot}`, icon: "grid-outline" };
    return { label: seatStr, icon: "grid-outline" };
  }
  if (b.time_slot) {
    const n = Number(b.num_seats || 0);
    const suffix = n > 1 ? `  ·  ${n} seats` : "";
    return { label: `Time slot · ${b.time_slot}${suffix}`, icon: "time-outline" };
  }
  if (b.num_seats) {
    return { label: `${b.num_seats} × General Admission`, icon: "people-outline" };
  }
  return { label: "General Admission", icon: "ticket-outline" };
}
