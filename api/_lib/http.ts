import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Write protection for mutating routes.
 *
 * - If ADMIN_TOKEN is set, POST/DELETE require a matching `x-admin-token`
 *   header (otherwise 401). GET routes never call this.
 * - If ADMIN_TOKEN is unset, writes are open (fine for a small friend group).
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) return true; // open writes

  const provided = headerValue(req.headers["x-admin-token"]);
  if (provided && provided === expected) return true;

  res.status(401).json({ error: "unauthorized", message: "Admin token required to edit the roster." });
  return false;
}

/**
 * Cron/admin auth for the snapshot route. Accepts either the ADMIN_TOKEN
 * (x-admin-token) or Vercel Cron's `Authorization: Bearer <CRON_SECRET>`.
 * If neither secret is configured, the route is open.
 */
export function authorizeSnapshot(req: VercelRequest): boolean {
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!adminToken && !cronSecret) return true; // unprotected by choice

  const admin = headerValue(req.headers["x-admin-token"]);
  if (adminToken && admin === adminToken) return true;

  const auth = headerValue(req.headers["authorization"]);
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  return false;
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
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) return null;
  return name;
}

export function allowCors(res: VercelResponse): void {
  // Same-origin in production; permissive here keeps `vercel dev` + tooling happy.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
