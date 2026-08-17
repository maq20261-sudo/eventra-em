/** Shared helpers to format an event's start_date / end_date pair for
 * display across the app. Falls back to the legacy `date` field when the
 * new fields aren't populated.
 */

export type EventLike = {
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function _startEnd(e: EventLike): { start: Date | null; end: Date | null } {
  const s = e.start_date || e.date || null;
  const en = e.end_date || null;
  return {
    start: s ? new Date(s) : null,
    end: en ? new Date(en) : null,
  };
}

const _sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const _fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const _fmtDateLong = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const _fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Short one-liner suitable for card meta rows (e.g. "Jun 20 · 7:00 PM"). */
export function eventCardDate(e: EventLike): string {
  const { start } = _startEnd(e);
  if (!start) return "";
  return `${_fmtDate(start)} · ${_fmtTime(start)}`;
}

/** Full range used on detail / ticket screens.
 *   Same day → "Jun 20 · 7:00 PM – 10:00 PM"
 *   Diff day → "Jun 20, 7:00 PM – Jun 21, 2:00 AM"
 *   No end   → "Jun 20 · 7:00 PM" */
export function eventDateRange(e: EventLike): string {
  const { start, end } = _startEnd(e);
  if (!start) return "";
  if (!end) return `${_fmtDate(start)} · ${_fmtTime(start)}`;
  if (_sameDay(start, end)) {
    return `${_fmtDateLong(start)} · ${_fmtTime(start)} – ${_fmtTime(end)}`;
  }
  return `${_fmtDate(start)}, ${_fmtTime(start)} – ${_fmtDate(end)}, ${_fmtTime(end)}`;
}

/** Just the start date+time as a compact date for lists (e.g. bookings list). */
export function eventListDate(e: EventLike): string {
  const { start } = _startEnd(e);
  if (!start) return "";
  return _fmtDateLong(start);
}
