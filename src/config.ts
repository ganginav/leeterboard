/**
 * Shared roster — the committed default board.
 *
 * This is the SHARED default set of LeetCode usernames everyone sees when they
 * open the board. To change the shared board for the whole group, edit this
 * array and redeploy. Visitors can also add their own usernames at runtime via
 * the UI (those persist only in their browser's localStorage; see README's
 * "Future / scaling" section for making the roster truly shared).
 *
 * NOTE: "GANGINAV" is a seed placeholder — correct it to the real LeetCode
 * handle if it doesn't resolve (only PUBLIC profiles work).
 */
export const DEFAULT_USERS: string[] = ["GANGINAV"];

/** Per-user accent colors, cycled by roster index. */
export const USER_COLORS: string[] = [
  "#39d353",
  "#f0a500",
  "#58a6ff",
  "#ff7b72",
  "#bc8cff",
  "#3fb950",
  "#ffa657",
];

/** Default public alfa-leetcode-api instance. */
export const DEFAULT_API_BASE = "https://alfa-leetcode-api.onrender.com";

/** localStorage keys. */
export const LS_ADDED_USERS = "gb-added-users";
export const LS_API_BASE = "gb-api-base";
export const LS_ADMIN_TOKEN = "gb-admin-token";

/** True if `name` is one of the committed defaults (case-insensitive). */
export function isDefaultUser(name: string): boolean {
  const k = name.trim().toLowerCase();
  return DEFAULT_USERS.some((d) => d.toLowerCase() === k);
}

/** Auto-sync cadence and per-request politeness gap (public instance is rate-limited). */
export const AUTO_SYNC_MS = 10 * 60 * 1000; // 10 minutes
export const REQUEST_GAP_MS = 450;
export const REQUEST_TIMEOUT_MS = 12_000;
