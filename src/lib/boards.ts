/**
 * Client-side board routing + the "recently opened" list.
 *
 * Routing is dependency-free: a board lives at the path `/b/{ID}`. `navigate()`
 * pushes history and fires a popstate so App re-reads the path. Recently-opened
 * boards are remembered in localStorage purely as a convenience on the landing
 * screen — the source of truth is always the server, keyed by the id.
 */

import { LS_RECENT_BOARDS } from "../config";

export interface RecentBoard {
  id: string;
  name: string;
  at: number; // last opened (ms)
}

const MAX_RECENT = 8;

/** Extract a board id from a path like `/b/K7P2QXM` (uppercased), else null. */
export function boardIdFromPath(path: string = window.location.pathname): string | null {
  const m = path.match(/^\/b\/([0-9A-Za-z]{4,16})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

export function boardPath(id: string): string {
  return `/b/${id}`;
}

/** Full shareable URL for a board. */
export function boardUrl(id: string): string {
  return `${window.location.origin}${boardPath(id)}`;
}

/** Push a new path and notify listeners (App listens for popstate). */
export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function getRecentBoards(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(LS_RECENT_BOARDS);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return (arr as RecentBoard[])
      .filter((b) => b && typeof b.id === "string")
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export function rememberBoard(board: { id: string; name: string }): void {
  try {
    const others = getRecentBoards().filter((b) => b.id !== board.id);
    const next = [{ id: board.id, name: board.name, at: Date.now() }, ...others].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(LS_RECENT_BOARDS, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function forgetBoard(id: string): void {
  try {
    const next = getRecentBoards().filter((b) => b.id !== id);
    localStorage.setItem(LS_RECENT_BOARDS, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
