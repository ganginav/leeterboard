import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare, so token checks don't leak length-prefix info
 * via response timing. (The length mismatch shortcut itself only reveals the
 * length, which is not secret-bearing.)
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Cron auth for the snapshot route. Accepts Vercel Cron's
 * `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is unset, the route is
 * open (the feature is optional and the snapshot only writes derived data).
 */
export function authorizeSnapshot(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return true; // unprotected by choice

  const auth = headerValue(req.headers["authorization"]);
  return !!auth && safeEqual(auth, `Bearer ${cronSecret}`);
}

export function headerValue(h: string | string[] | undefined): string | undefined {
  return Array.isArray(h) ? h[0] : h;
}

/** First value of a query param that may arrive as string | string[]. */
export function queryParam(
  q: VercelRequest["query"],
  key: string,
): string | undefined {
  const v = q[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Validate a candidate LeetCode username. Returns trimmed value or null. */
export function validUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  // LeetCode handles: letters, digits, underscore, dash, dot; 1–40 chars.
  // Must START with an alphanumeric so pure-punctuation handles like "." or
  // ".." can't pass — those survive encodeURIComponent unescaped and would
  // turn the upstream URL into a path-traversal (`${base}/../calendar`).
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(name)) return null;
  if (name.includes("..")) return null; // belt-and-suspenders against traversal
  return name;
}

export function allowCors(req: VercelRequest, res: VercelResponse): void {
  // The deployed UI calls its own /api SAME-ORIGIN, so it never needs CORS.
  // These headers only matter for cross-origin callers, and the mutating routes
  // (roster POST/DELETE) are exactly what we don't want a random site driving
  // from a victim's browser. So:
  //   - reads stay public to any origin ("*"),
  //   - but POST/DELETE are only advertised to origins explicitly trusted via
  //     ALLOWED_ORIGINS. Since those verbs are preflighted (JSON body / DELETE),
  //     an untrusted browser never gets to send the write.
  const origin = headerValue(req.headers.origin);
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const trusted = !!origin && allowed.includes(origin);

  res.setHeader("Access-Control-Allow-Origin", trusted ? origin! : "*");
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    trusted ? "GET,POST,DELETE,OPTIONS" : "GET,OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
