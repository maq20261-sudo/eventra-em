/** Shared helper: given a booking, decide which "ticket type" label to show.
 *
 * Priority is IMPORTANT — a time_slot booking may also carry num_seats > 1
 * (group booking), so time_slot MUST be checked before num_seats. Kept in
 * one place so ticket screen, bookings list, and organizer scanner stay in
 * sync.
 */

export type BookingLike = {
  time_slot?: string | null;
  num_seats?: number | null;
  seats?: string[] | null;
};

export function ticketTypeLabel(b: BookingLike | null | undefined): string {
  if (!b) return "Entry";
  if (b.time_slot) return "Time slot";
  if (b.seats && b.seats.length) return "Seats";
  if (b.num_seats) return "Tickets";
  return "Entry";
}

/** Human-readable value that pairs with `ticketTypeLabel`. */
export function ticketTypeValue(b: BookingLike | null | undefined): string {
  if (!b) return "";
  if (b.time_slot) {
    const n = Number(b.num_seats || 0);
    return n > 1 ? `${b.time_slot} · ${n} seats` : b.time_slot;
  }
  if (b.seats && b.seats.length) return b.seats.join(", ");
  if (b.num_seats) return `${b.num_seats} × ticket`;
  return "General";
}

/** Structured version for the organizer scanner that also picks an icon. */
export function ticketTypeLine(b: BookingLike | null | undefined): { label: string; icon: string } {
  if (!b) return { label: "-", icon: "ticket-outline" };
  if (b.time_slot) {
    const n = Number(b.num_seats || 0);
    const suffix = n > 1 ? `  ·  ${n} seats` : "";
    return { label: `Time slot · ${b.time_slot}${suffix}`, icon: "time-outline" };
  }
  if (b.seats && b.seats.length) {
    return { label: `Seats · ${b.seats.join(", ")}`, icon: "grid-outline" };
  }
  if (b.num_seats) {
    return { label: `${b.num_seats} × General Admission`, icon: "people-outline" };
  }
  return { label: "General Admission", icon: "ticket-outline" };
}
