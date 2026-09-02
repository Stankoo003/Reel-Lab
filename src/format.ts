// Number and time formatting for display, in one place.
//
// Both of these were about to be written three times over — once in the profile header,
// once on each video tile, once in the comment list — and three copies of a rounding rule
// is three chances to round differently.

/**
 * A count as the design writes it: `17`, `1.6k`, `17.0k`, `2.4M`.
 *
 * Truncates rather than rounds, so a number never reads as larger than it is: 1999 is
 * `1.9k`, not `2.0k`. The one decimal is kept even when it is zero (`17.0k`) because the
 * design shows it that way — a column of counts stays the same width.
 */
export function compactCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.max(0, Math.trunc(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${Math.trunc(v / 100) / 10}k`;
  return `${Math.trunc(v / 100_000) / 10}M`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * How long ago, in the terse form a comment list uses: `now`, `4m`, `2h`, `3d`, `6w`, `2y`.
 *
 * Anything unparseable returns an em dash rather than "NaN" or the epoch — a comment with a
 * bad timestamp should still render its text.
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";

  // Clock skew between device and server can put a fresh comment slightly in the future.
  // That is "now", not a negative age.
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));

  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d`;
  if (seconds < YEAR) return `${Math.floor(seconds / WEEK)}w`;
  return `${Math.floor(seconds / YEAR)}y`;
}
