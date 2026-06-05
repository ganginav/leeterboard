/**
 * leetcode.ts — the client-side metric-derivation layer for Leeterboard.
 *
 * The browser never fetches LeetCode directly; the server (api/_lib/leetcode.ts)
 * fetches + normalizes upstream payloads and hands the client a ready calendar
 * via /api/leaderboard. This module owns the typed shapes and the derivations
 * (today / week / streak / last7) computed from that normalized calendar.
 *
 * Two LeetCode quirks survive into the derivations and are commented inline:
 *   1. UTC day bucketing   (LeetCode's calendar buckets by UTC midnight)
 *   2. The "don't lose your streak mid-day" rule
 */

// ───────────────────────────── Types ─────────────────────────────

/** Map of UTC day key ("YYYY-MM-DD") -> submission count that day. */
export type Calendar = Record<string, number>;

export type FetchStatus = "ok" | "not_found" | "unreachable";

/** Normalized per-user data the metrics are derived from. */
export interface FetchResult {
  status: FetchStatus;
  calendar: Calendar;
  /** Cumulative solved problems (0 if unavailable). */
  total: number;
}

/** One day's bar in the 7-day sparkline. */
export interface DayBar {
  day: string; // YYYY-MM-DD (UTC)
  count: number;
}

/** Derived, display-ready metrics for a user. */
export interface UserMetrics {
  today: number;
  week: number;
  total: number;
  streak: number;
  last7: DayBar[];
}

// ──────────────────────── UTC date helpers ───────────────────────
//
// QUIRK #1: LeetCode's submission calendar buckets each submission by UTC
// midnight. If we bucketed by the viewer's local timezone the "today" count
// would drift by a day for anyone west/east of UTC. So EVERY day key in this
// app is derived from getUTC* — never the local getters.

/** Format a Date as its UTC "YYYY-MM-DD" key. */
export function utcKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's UTC day key. */
export function todayKey(): string {
  return utcKey(new Date());
}

/** The UTC day key `n` days before today (n=0 is today). */
export function agoKey(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcKey(d);
}

/** The last 7 UTC day keys, oldest -> newest (index 6 is today). */
export function last7(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(agoKey(i));
  return days;
}

/** Single-letter weekday label for a "YYYY-MM-DD" UTC key (S M T W T F S). */
export function weekdayInitial(dayKey: string): string {
  // Parse explicitly as UTC midnight so the weekday matches the bucket.
  const d = new Date(`${dayKey}T00:00:00Z`);
  return ["S", "M", "T", "W", "T", "F", "S"][d.getUTCDay()];
}

// ──────────────────────────── Streak ─────────────────────────────
//
// QUIRK #2: a streak is the number of consecutive UTC days (ending now) with at
// least one submission. The subtlety: early in the UTC day you may have 0
// submissions *so far* — we don't want that to read as "streak broken". So if
// today's count is 0 we measure the run ending YESTERDAY; if today already has
// submissions we include today.

export function computeStreak(calendar: Calendar): number {
  const startOffset = (calendar[todayKey()] ?? 0) > 0 ? 0 : 1;
  let streak = 0;
  for (let i = startOffset; ; i++) {
    if ((calendar[agoKey(i)] ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

// ─────────────────────── Derived metrics ─────────────────────────

export function deriveMetrics(result: FetchResult): UserMetrics {
  const last7Bars: DayBar[] = last7().map((day) => ({
    day,
    count: result.calendar[day] ?? 0,
  }));
  return {
    today: result.calendar[todayKey()] ?? 0,
    week: last7Bars.reduce((sum, b) => sum + b.count, 0),
    total: result.total,
    streak: computeStreak(result.calendar),
    last7: last7Bars,
  };
}
