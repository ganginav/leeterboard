/**
 * Server-side LeetCode data: upstream fetch + normalization.
 *
 * The raw-calendar parsing and UTC-day bucketing now live HERE (moved off the
 * client): the browser receives an already-normalized `{ "YYYY-MM-DD": count }`
 * map and never touches LeetCode's quirky payload shapes. The client still owns
 * the *derivations* (today / week / streak) over that normalized map.
 *
 * QUIRKS handled here:
 *   1. UTC day bucketing — LeetCode buckets the submission calendar by UTC
 *      midnight, so day keys come from getUTC* (see utcKey).
 *   2. Calendar string parsing — /calendar's value may be an object OR a
 *      JSON-stringified object of `unixTimestampSeconds: count`.
 *   3. submissions ≠ solved — the calendar counts daily *submissions* (re-subs
 *      included); `total` from /solved is the unique cumulative solved count.
 */

import { alfaBase } from "./config";

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
 * Accept an object or a JSON string, sum counts into UTC-day buckets. (QUIRK #2)
 * Non-numeric keys/values are ignored.
 */
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
    if (!Number.isFinite(tsNum) || !Number.isFinite(c)) continue;
    const day = utcKey(new Date(tsNum * 1000)); // ts is in SECONDS
    out[day] = (out[day] ?? 0) + c;
  }
  return out;
}

function extractCalendar(payload: unknown): unknown {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if ("submissionCalendar" in p) return p.submissionCalendar;
  }
  return payload;
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
    const calRes = await getJson(`${base}/${user}/calendar`, controller.signal);
    if (calRes.status === 404) {
      return { status: "not_found", calendar: {}, total: null };
    }
    if (!calRes.ok) {
      return { status: "unreachable", calendar: {}, total: null };
    }

    const calPayload: unknown = await calRes.json();
    if (hasErrorsEnvelope(calPayload)) {
      // alfa answers 200 with { errors: [...] } for bad handles.
      return { status: "not_found", calendar: {}, total: null };
    }

    const calendar = normalizeCalendar(extractCalendar(calPayload));

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
