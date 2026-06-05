/**
 * Server-side LeetCode data: upstream fetch + normalization.
 *
 * The "problems solved per day" calendar is built HERE (off the client): the
 * browser receives an already-normalized `{ "YYYY-MM-DD": count }` map and never
 * touches LeetCode's payload shapes. The client owns the *derivations*
 * (today / week / streak) over that map.
 *
 * DESIGN — we want "did you do a PROBLEM today", not "did you submit". LeetCode's
 * submission calendar only counts daily *submissions* (re-subs included), which
 * isn't what we want. So the daily number comes from `recentAcSubmissionList`
 * (`/{user}/acSubmission`): we bucket those *accepted* submissions by UTC day and
 * count DISTINCT problems (titleSlug) per day → genuine problems-solved-per-day.
 *
 * QUIRKS:
 *   1. UTC day bucketing — day keys come from getUTC* (see utcKey), so "today"
 *      doesn't drift for non-UTC viewers.
 *   2. Re-solves collapse — solving the same problem twice in a day counts once
 *      (distinct titleSlug per day).
 *   3. WINDOW CAP — LeetCode caps recentAcSubmissionList at 20 entries, so the
 *      calendar only reaches back ~the last 20 solved problems. Fine for today /
 *      this week / short streaks; longer streaks are truncated to the window.
 *   4. `total` from /solved is the cumulative unique solved count (full history).
 */

import { alfaBase } from "./config.js";

export type Calendar = Record<string, number>;
export type FetchStatus = "ok" | "not_found" | "unreachable";

export interface NormalizedStats {
  status: FetchStatus;
  calendar: Calendar;
  /** Cumulative unique solved; null if /solved was unavailable. */
  total: number | null;
}

const REQUEST_TIMEOUT_MS = 12_000;

/** Format a Date as its UTC "YYYY-MM-DD" key. (QUIRK #1) */
export function utcKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return utcKey(new Date());
}

/** The UTC day key `n` days before today (n=0 is today). */
export function agoKey(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcKey(d);
}

/**
 * Build { UTC day -> distinct problems accepted } from a recentAcSubmissionList
 * payload (`{ submission: [{ titleSlug, timestamp, ... }] }`). Re-solving the
 * same problem on the same day counts once.
 */
export function normalizeAcCalendar(payload: unknown): Calendar {
  const list =
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).submission)
      ? ((payload as Record<string, unknown>).submission as unknown[])
      : [];

  const byDay: Record<string, Set<string>> = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const ts = Number(rec.timestamp); // unix SECONDS (string)
    const slug = typeof rec.titleSlug === "string" ? rec.titleSlug : null;
    if (!Number.isFinite(ts) || !slug) continue;
    const date = new Date(ts * 1000);
    if (Number.isNaN(date.getTime())) continue;
    const day = utcKey(date);
    (byDay[day] ??= new Set()).add(slug);
  }

  const out: Calendar = {};
  for (const [day, slugs] of Object.entries(byDay)) out[day] = slugs.size;
  return out;
}

/** Read cumulative solved: solvedProblem -> totalSolved -> acSubmissionNum "All". */
function extractSolved(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
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
  return null;
}

function hasErrorsEnvelope(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    "errors" in (payload as Record<string, unknown>)
  );
}

async function getJson(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { signal, headers: { Accept: "application/json" } });
}

/**
 * Fetch + normalize one user from the upstream alfa instance. Never throws;
 * returns a discriminated status so callers can map to HTTP codes. /solved is
 * best-effort and does not downgrade an otherwise-ok result.
 */
export async function fetchUpstreamStats(
  username: string,
): Promise<NormalizedStats> {
  const base = alfaBase().replace(/\/+$/, "");
  const user = encodeURIComponent(username.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Recent ACCEPTED submissions → distinct problems per day (limit is capped
    // at 20 upstream regardless of what we ask).
    const acRes = await getJson(`${base}/${user}/acSubmission?limit=20`, controller.signal);
    if (acRes.status === 404) {
      return { status: "not_found", calendar: {}, total: null };
    }
    if (!acRes.ok) {
      return { status: "unreachable", calendar: {}, total: null };
    }

    const acPayload: unknown = await acRes.json();
    if (hasErrorsEnvelope(acPayload)) {
      // alfa answers 200 with { errors: [...] } for bad handles.
      return { status: "not_found", calendar: {}, total: null };
    }

    const calendar = normalizeAcCalendar(acPayload);

    let total: number | null = null;
    try {
      const solvedRes = await getJson(`${base}/${user}/solved`, controller.signal);
      if (solvedRes.ok) {
        const solvedPayload: unknown = await solvedRes.json();
        if (!hasErrorsEnvelope(solvedPayload)) {
          total = extractSolved(solvedPayload);
        }
      }
    } catch {
      // best-effort
    }

    return { status: "ok", calendar, total };
  } catch {
    return { status: "unreachable", calendar: {}, total: null };
  } finally {
    clearTimeout(timer);
  }
}
