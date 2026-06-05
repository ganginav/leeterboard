/**
 * leetcode.ts — the entire data layer for Leeterboard.
 *
 * This is intentionally the ONE place that knows how to talk to the data
 * source. The rest of the app only consumes `fetchUser()` + `deriveMetrics()`
 * and the typed shapes below. To later swap the public alfa-leetcode-api for a
 * caching serverless proxy (see README "Future / scaling"), you only change
 * `fetchUser` here — nothing in the components needs to move.
 *
 * Data source: alfa-leetcode-api (https://github.com/alfaarghya/alfa-leetcode-api),
 * a REST wrapper over LeetCode's GraphQL. Two endpoints per user:
 *   GET {base}/{username}/calendar  -> submission calendar (per-day counts)
 *   GET {base}/{username}/solved    -> cumulative solved totals
 *
 * Three LeetCode quirks are handled carefully and commented inline:
 *   1. UTC day bucketing   (LeetCode's calendar buckets by UTC midnight)
 *   2. Calendar string parsing (value may be an object OR a JSON string)
 *   3. The "don't lose your streak mid-day" rule
 */

import { REQUEST_TIMEOUT_MS } from "../config";

// ───────────────────────────── Types ─────────────────────────────

/** Map of UTC day key ("YYYY-MM-DD") -> submission count that day. */
export type Calendar = Record<string, number>;

export type FetchStatus = "ok" | "not_found" | "unreachable";

/** Raw-ish result of a fetch, before metrics are derived. */
export interface FetchResult {
  status: FetchStatus;
  calendar: Calendar;
  /** Cumulative solved problems from /solved (0 if best-effort fetch failed). */
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

// ───────────────────── Calendar normalization ────────────────────
//
// QUIRK #2: the calendar payload's value is sometimes a real object and
// sometimes a JSON-stringified object, keyed by unixTimestampSeconds. We accept
// either, coerce keys/values to numbers, drop anything non-numeric, convert the
// timestamp (seconds) to a UTC day key, and sum counts that land on the same day.

export function normalizeCalendar(raw: unknown): Calendar {
  let source: Record<string, unknown>;

  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else if (raw && typeof raw === "object") {
    source = raw as Record<string, unknown>;
  } else {
    return {};
  }

  const out: Calendar = {};
  for (const [ts, count] of Object.entries(source)) {
    const tsNum = Number(ts);
    const c = Number(count);
    if (!Number.isFinite(tsNum) || !Number.isFinite(c)) continue; // ignore non-numeric keys/values
    const day = utcKey(new Date(tsNum * 1000)); // ts is in SECONDS
    out[day] = (out[day] ?? 0) + c;
  }
  return out;
}

// ──────────────────────────── Streak ─────────────────────────────
//
// QUIRK #3: a streak is the number of consecutive UTC days (ending now) with at
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

// ───────────────────── Payload extraction ────────────────────────

/** Pull the raw calendar value out of whatever shape /calendar returns. */
function extractCalendar(payload: unknown): unknown {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if ("submissionCalendar" in p) return p.submissionCalendar;
  }
  return payload;
}

/**
 * Read cumulative solved count from /solved, trying the documented fields in
 * order: solvedProblem -> totalSolved -> the "All" entry of acSubmissionNum[].
 */
function extractSolved(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as Record<string, unknown>;

  if (typeof p.solvedProblem === "number") return p.solvedProblem;
  if (typeof p.totalSolved === "number") return p.totalSolved;

  if (Array.isArray(p.acSubmissionNum)) {
    const all = p.acSubmissionNum.find(
      (e): e is { difficulty: string; count: number } =>
        !!e &&
        typeof e === "object" &&
        (e as Record<string, unknown>).difficulty === "All" &&
        typeof (e as Record<string, unknown>).count === "number",
    );
    if (all) return all.count;
  }
  return 0;
}

/** True if the API returned an explicit "errors" envelope (e.g. bad username). */
function hasErrorsEnvelope(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    "errors" in (payload as Record<string, unknown>)
  );
}

// ──────────────────────────── Fetch ──────────────────────────────

function trimBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

/**
 * Fetch one user's data. Never throws — returns a discriminated status so the
 * UI can distinguish a bad username ("not_found") from a dead/blocked API
 * ("unreachable": network error, timeout, or CORS). /solved is best-effort:
 * if only it fails we still return "ok" with total = 0.
 *
 * A single 12s AbortController guards the whole sequence.
 */
export async function fetchUser(
  username: string,
  apiBase: string,
): Promise<FetchResult> {
  const base = trimBase(apiBase);
  const user = encodeURIComponent(username.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const calRes = await fetch(`${base}/${user}/calendar`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    // 404 → username almost certainly doesn't exist.
    if (calRes.status === 404) {
      return { status: "not_found", calendar: {}, total: 0 };
    }
    // Any other non-OK is treated as the API being unhappy/unreachable.
    if (!calRes.ok) {
      return { status: "unreachable", calendar: {}, total: 0 };
    }

    const calPayload: unknown = await calRes.json();
    if (hasErrorsEnvelope(calPayload)) {
      // alfa-leetcode-api answers 200 with { errors: [...] } for bad handles.
      return { status: "not_found", calendar: {}, total: 0 };
    }

    const calendar = normalizeCalendar(extractCalendar(calPayload));

    // /solved is best-effort — tolerate its failure without downgrading status.
    let total = 0;
    try {
      const solvedRes = await fetch(`${base}/${user}/solved`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (solvedRes.ok) {
        const solvedPayload: unknown = await solvedRes.json();
        if (!hasErrorsEnvelope(solvedPayload)) {
          total = extractSolved(solvedPayload);
        }
      }
    } catch {
      // ignore — keep total at 0
    }

    return { status: "ok", calendar, total };
  } catch {
    // AbortError, network failure, DNS, or CORS rejection all land here.
    return { status: "unreachable", calendar: {}, total: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Small promise-based delay used to space out sequential requests. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
