/**
 * api.ts — the swappable data source for the SHARED (server-backed) board.
 *
 * In production (and under `vercel dev`) the client talks ONLY to our same-origin
 * `/api/*` serverless routes — never to LeetCode/alfa directly — so there are no
 * browser CORS concerns and caching + rate-limiting live on the server.
 *
 * When `/api/*` isn't available (e.g. plain `vite` with no functions, or
 * `vite preview`), `loadBoardViaApi()` returns null and the app falls back to
 * the legacy per-browser path in `leetcode.ts` (see App.tsx). This module is the
 * single place the network source lives — swap it and nothing else moves.
 */

import type { Calendar, FetchStatus } from "./leetcode";

/** One user as returned by GET /api/leaderboard. */
export interface BoardEntry {
  username: string;
  calendar: Calendar;
  total: number | null;
  /** Yesterday's solved snapshot (if cron snapshots exist) — enables solved deltas. */
  solvedYesterday: number | null;
  /** Present when this user couldn't be fetched. */
  error?: Exclude<FetchStatus, "ok">;
}

interface LeaderboardResponse {
  users: BoardEntry[];
  generatedAt: number;
}

interface RosterResponse {
  users: string[];
  defaults: string[];
}

/** Thrown when a roster write needs an admin token (HTTP 401). */
export class AdminRequiredError extends Error {
  constructor() {
    super("Admin token required");
    this.name = "AdminRequiredError";
  }
}

/**
 * Load the whole board in ONE call. Returns null (not an error) when the API
 * layer isn't present, which the caller treats as "use the local fallback".
 */
export async function loadBoardViaApi(): Promise<BoardEntry[] | null> {
  try {
    const res = await fetch("/api/leaderboard", {
      headers: { Accept: "application/json" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    // A Vite-only dev server has no /api function: it 404s or serves index.html.
    if (!res.ok || !contentType.includes("application/json")) return null;
    const data = (await res.json()) as LeaderboardResponse;
    if (!data || !Array.isArray(data.users)) return null;
    return data.users;
  } catch {
    return null; // network/abort → fall back
  }
}

async function rosterWrite(
  method: "POST" | "DELETE",
  url: string,
  body: unknown,
  adminToken: string,
): Promise<string[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (adminToken) headers["x-admin-token"] = adminToken;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) throw new AdminRequiredError();

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { message?: string }).message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (data as RosterResponse).users;
}

/** Add a user to the shared roster; returns the updated roster. */
export function apiAddUser(username: string, adminToken: string): Promise<string[]> {
  return rosterWrite("POST", "/api/roster", { username }, adminToken);
}

/** Remove a user from the shared roster; returns the updated roster. */
export function apiRemoveUser(
  username: string,
  adminToken: string,
): Promise<string[]> {
  return rosterWrite(
    "DELETE",
    `/api/roster?user=${encodeURIComponent(username)}`,
    undefined,
    adminToken,
  );
}
