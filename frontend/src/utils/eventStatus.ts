/**
 * Shared style + label mapping for the event verification workflow.
 * Kept in one place so the organizer's event card, the Edit Event
 * banner, and any future admin UI stay visually consistent.
 */
export type EventStatus = "IN_REVIEW" | "ACTIVE" | "REJECTED" | "ON_HOLD" | string;

export type EventStatusMeta = {
  label: string;
  bg: string;
  fg: string;
  icon: string;
};

export function eventStatusMeta(status: EventStatus | undefined | null): EventStatusMeta {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", bg: "#D1FAE5", fg: "#065F46", icon: "checkmark-circle" };
    case "REJECTED":
      return { label: "Rejected", bg: "#FEE2E2", fg: "#991B1B", icon: "close-circle" };
    case "ON_HOLD":
      return { label: "On Hold", bg: "#FFEDD5", fg: "#9A3412", icon: "pause-circle" };
    case "IN_REVIEW":
    default:
      return { label: "In Review", bg: "#FEF3C7", fg: "#92400E", icon: "hourglass-outline" };
  }
}
