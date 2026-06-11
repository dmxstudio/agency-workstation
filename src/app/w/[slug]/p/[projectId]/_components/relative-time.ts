/**
 * Relative timestamps in Spanish for the Cockpit feed and task list.
 * Rendered exclusively in Server Components, so the formatted string is
 * computed once per request (no SSR/client hydration mismatch).
 */

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const formatter = new Intl.RelativeTimeFormat("es", {
  numeric: "auto",
  style: "short",
});

/** "ahora", "hace 5 min", "hace 3 h", "hace 2 días", … */
export function formatRelativeTimeEs(date: Date, now: Date = new Date()): string {
  let duration = (date.getTime() - now.getTime()) / 1000;
  if (Math.abs(duration) < 45) return "ahora";
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), "year");
}
