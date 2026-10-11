/**
 * Single source of truth for turning `event.booking_type` into a
 * user-facing label + icon. Kept alongside `ticketLabel.ts` so every
 * screen (Discover cards, Organizer list, Event detail, etc.) shows the
 * SAME string for a given event type — no more "Reserved Seating"
 * showing up as "General Admission" on one card and correct on another.
 */
export type EventBookingType = "seat_map" | "general" | "time_slot" | string | null | undefined;

export function eventTypeLabel(bookingType: EventBookingType): string {
  switch (bookingType) {
    case "seat_map":
      return "Reserved Seating";
    case "time_slot":
      return "Time Slots";
    case "general":
    default:
      // Default to General Admission — matches the create-form default
      // and covers legacy events that were saved without booking_type.
      return "General Admission";
  }
}

/** Shorter chip-friendly variant for event cards. */
export function eventTypeShortLabel(bookingType: EventBookingType): string {
  switch (bookingType) {
    case "seat_map":
      return "Reserved";
    case "time_slot":
      return "Time Slots";
    case "general":
    default:
      return "General";
  }
}

/** Icon (Ionicons name) to pair with the label. */
export function eventTypeIcon(bookingType: EventBookingType): string {
  switch (bookingType) {
    case "seat_map":
      return "grid-outline";
    case "time_slot":
      return "time-outline";
    case "general":
    default:
      return "ticket-outline";
  }
}
