// Friendly "time until" label for upcoming tickets: "Starts in 45 min",
// "Starts in 3 h", "Tomorrow", "In 5 days". Returns null for past events.
export function startsInLabel(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `Starts in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Starts in ${h} h`;
  const start = new Date(iso);
  const today = new Date(now);
  const dayDiff = Math.round(
    (Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000,
  );
  if (dayDiff <= 1) return "Tomorrow";
  return `In ${dayDiff} days`;
}
