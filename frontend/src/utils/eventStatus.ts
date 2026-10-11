/**
 * Shared style + label mapping for the event verification workflow.
 * Kept in one place so the organizer's event card, the Edit Event
 * banner, and any future admin UI stay visually consistent.
 * Colours are tuned for the Neon Night (dark) theme; `fg` is always a
 * 6-digit hex because callers append alpha (e.g. `meta.fg + "22"`).
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
      return { label: "Active", bg: "#C6FF3D24", fg: "#C6FF3D", icon: "checkmark-circle" };
    case "REJECTED":
      return { label: "Rejected", bg: "#FF6B6B29", fg: "#FF8A8A", icon: "close-circle" };
    case "ON_HOLD":
      return { label: "On Hold", bg: "#FFB54729", fg: "#FFC46B", icon: "pause-circle" };
    case "IN_REVIEW":
    default:
      return { label: "In Review", bg: "#7C5CFF33", fg: "#C9B8FF", icon: "hourglass-outline" };
  }
}
