/**
 * Shared roster — the committed default board.
 *
 * This is the SHARED default set of LeetCode usernames everyone sees when they
 * open the board. To change the shared board for the whole group, edit this
 * array and redeploy. Visitors can also add usernames at runtime via the UI;
 * those go to the shared server-side roster. Kept in sync with the server copy
 * in `api/_lib/config.ts` deliberately.
 *
 * To seed a shared baseline that CAN'T be removed via the UI/API, add handles
 * here (only PUBLIC profiles work) AND mirror them in `api/_lib/config.ts`.
 */
export const DEFAULT_USERS: string[] = [];

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

/** localStorage key for the admin token used to authorize roster writes. */
export const LS_ADMIN_TOKEN = "gb-admin-token";

/** True if `name` is one of the committed defaults (case-insensitive). */
export function isDefaultUser(name: string): boolean {
  const k = name.trim().toLowerCase();
  return DEFAULT_USERS.some((d) => d.toLowerCase() === k);
}

/** Auto-sync cadence. */
export const AUTO_SYNC_MS = 10 * 60 * 1000; // 10 minutes
