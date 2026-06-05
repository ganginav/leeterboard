/**
 * Server-side LeetCode data: upstream fetch (no day bucketing).
 *
 * DESIGN — we want "did you do a PROBLEM today", not "did you submit". LeetCode's
 * submission calendar only counts daily *submissions* (re-subs included), so the
 * daily number instead comes from `recentAcSubmissionList` (`/{user}/acSubmission`)
 * — the recent *accepted* submissions. The server returns those raw as
 * { ts, slug } pairs; the CLIENT buckets them into days and counts distinct
 * problems. Bucketing lives client-side on purpose (see quirk #1).
 *
 * QUIRKS:
 *   1. LOCAL day bucketing (client) — because we have raw timestamps, the client
 *      buckets by the viewer's LOCAL day, so an 11pm Thursday solve shows on
 *      Thursday instead of drifting into Friday UTC. (The server keeps utcKey
 *      only for the optional snapshot cron's day keys.)
 *   2. Re-solves collapse — same problem twice in a day counts once (distinct
 *      slug per day; done on the client).
 *   3. WINDOW CAP — LeetCode caps recentAcSubmissionList at 20 entries, so the
 *      daily history reaches back ~the last 20 solved problems. Fine for today /
 *      this week / short streaks; longer streaks are truncated to the window.
 *   4. `total` from /solved is the cumulative unique solved count (full history).
 */

import { alfaBase } from "./config.js";

export type Calendar = Record<string, number>;
export type FetchStatus = "ok" | "not_found" | "unreachable";

/** One recent accepted submission: unix-seconds timestamp + problem slug. */
export interface AcSub {
  ts: number;
  slug: string;
}

export interface NormalizedStats {
  status: FetchStatus;
  /**
   * Recent accepted submissions. The server does NOT bucket these into days —
   * the client buckets by the viewer's LOCAL day, so an 11pm solve lands on the
   * day it was actually done rather than drifting into the next UTC day.
   */
  acSubs: AcSub[];
  /** Cumulative unique solved; null if /solved was unavailable. */
  total: number | null;
  /** Profile display name (e.g. "Vibhu Gangina"); null if unset or unavailable. */
  name: string | null;
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
 * Pull recent accepted submissions out of a recentAcSubmissionList payload
 * (`{ submission: [{ titleSlug, timestamp, ... }] }`) as { ts, slug } pairs.
 * No day bucketing here — that's the client's job (local timezone).
 */
export function extractAcSubs(payload: unknown): AcSub[] {
  const list =
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).submission)
      ? ((payload as Record<string, unknown>).submission as unknown[])
      : [];

  const out: AcSub[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const ts = Number(rec.timestamp); // unix SECONDS (string)
    const slug = typeof rec.titleSlug === "string" ? rec.titleSlug : null;
    if (!Number.isFinite(ts) || !slug) continue;
    out.push({ ts, slug });
  }
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

/** Profile display name from `/{user}` (the `name` field), trimmed; null if blank. */
function extractName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const name = (payload as Record<string, unknown>).name;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
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
      return { status: "not_found", acSubs: [], total: null, name: null };
    }
    if (!acRes.ok) {
      return { status: "unreachable", acSubs: [], total: null, name: null };
    }

    const acPayload: unknown = await acRes.json();
    if (hasErrorsEnvelope(acPayload)) {
      // alfa answers 200 with { errors: [...] } for bad handles.
      return { status: "not_found", acSubs: [], total: null, name: null };
    }

    const acSubs = extractAcSubs(acPayload);

    // /solved (cumulative total) and /{user} (display name) are best-effort —
    // their failure doesn't downgrade an otherwise-ok result.
    let total: number | null = null;
    let name: string | null = null;
    try {
      const solvedRes = await getJson(`${base}/${user}/solved`, controller.signal);
      if (solvedRes.ok) {
        const solvedPayload: unknown = await solvedRes.json();
        if (!hasErrorsEnvelope(solvedPayload)) total = extractSolved(solvedPayload);
      }
    } catch {
      // best-effort
    }
    try {
      const profileRes = await getJson(`${base}/${user}`, controller.signal);
      if (profileRes.ok) {
        const profilePayload: unknown = await profileRes.json();
        if (!hasErrorsEnvelope(profilePayload)) name = extractName(profilePayload);
      }
    } catch {
      // best-effort
    }

    return { status: "ok", acSubs, total, name };
  } catch {
    return { status: "unreachable", acSubs: [], total: null, name: null };
  } finally {
    clearTimeout(timer);
  }
}
