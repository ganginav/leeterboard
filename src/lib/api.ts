/**
 * api.ts — the data source for the shared (server-backed) board.
 *
 * The client talks ONLY to our same-origin `/api/*` serverless routes — never to
 * LeetCode/alfa directly — so there are no browser CORS concerns and caching +
 * rate-limiting live on the server. This module is the single place the network
 * source lives — swap it and nothing else moves.
 *
 * `loadBoardViaApi()` returns null when the board can't be loaded (the API layer
 * is unreachable or returns a non-JSON response); App surfaces that as an error
 * and retries on the next sync.
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

/**
 * Load the whole board in ONE call. Returns null when the board can't be loaded
 * (the API layer is unreachable or returns a non-JSON response); the caller
 * surfaces that as an error notice and retries on the next sync.
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
    return null; // network/abort → board unavailable
  }
}

async function rosterWrite(
  method: "POST" | "DELETE",
  url: string,
  body: unknown,
): Promise<string[]> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { message?: string }).message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (data as RosterResponse).users;
}

/** Add a user to the shared roster; returns the updated roster. */
export function apiAddUser(username: string): Promise<string[]> {
  return rosterWrite("POST", "/api/roster", { username });
}

/** Remove a user from the shared roster; returns the updated roster. */
export function apiRemoveUser(username: string): Promise<string[]> {
  return rosterWrite("DELETE", `/api/roster?user=${encodeURIComponent(username)}`, undefined);
}
