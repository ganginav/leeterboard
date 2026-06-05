/**
 * api.ts — the data source for a board (server-backed).
 *
 * The client talks ONLY to same-origin `/api/*` routes. Every board is keyed by
 * its short id (`?board=ID`); the id in the URL `/b/{ID}` is the only handle
 * needed — no accounts. This module is the single place the network lives.
 */

import type { Calendar, FetchStatus } from "./leetcode";

export interface BoardMeta {
  id: string;
  name: string;
}

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
  board: BoardMeta;
  users: BoardEntry[];
  generatedAt: number;
}

/** Result of loading a board: found, not found (bad/expired code), or unreachable. */
export type BoardLoad =
  | { ok: true; board: BoardMeta; users: BoardEntry[] }
  | { ok: false; reason: "not_found" | "unreachable" };

/** Load a board's metadata + everyone's stats in one call. */
export async function loadBoard(boardId: string): Promise<BoardLoad> {
  try {
    const res = await fetch(`/api/leaderboard?board=${encodeURIComponent(boardId)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("application/json")) {
      return { ok: false, reason: "unreachable" };
    }
    const data = (await res.json()) as LeaderboardResponse;
    if (!data?.board || !Array.isArray(data.users)) {
      return { ok: false, reason: "unreachable" };
    }
    return { ok: true, board: data.board, users: data.users };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** Create a new board; returns its id + name. Throws on failure. */
export async function createBoard(name?: string): Promise<BoardMeta> {
  const res = await fetch("/api/board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string }).message ?? `Couldn't create board (${res.status})`;
    throw new Error(msg);
  }
  const meta = data as BoardMeta;
  return { id: meta.id, name: meta.name };
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
    const msg = (data as { message?: string }).message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (data as { users: string[] }).users;
}

/** Add a user to a board; returns the updated roster. */
export function apiAddUser(boardId: string, username: string): Promise<string[]> {
  return rosterWrite("POST", `/api/roster?board=${encodeURIComponent(boardId)}`, {
    username,
  });
}

/** Remove a user from a board; returns the updated roster. */
export function apiRemoveUser(boardId: string, username: string): Promise<string[]> {
  return rosterWrite(
    "DELETE",
    `/api/roster?board=${encodeURIComponent(boardId)}&user=${encodeURIComponent(username)}`,
    undefined,
  );
}
