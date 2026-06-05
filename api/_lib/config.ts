/**
 * Server-side copy of the committed default roster.
 *
 * KEEP IN SYNC with `src/config.ts` DEFAULT_USERS. It is intentionally
 * duplicated rather than imported: the serverless functions compile as an
 * isolated Node bundle and shouldn't pull in the browser `src` module graph
 * (which references import.meta / DOM). This list is tiny and rarely changes.
 *
 * These usernames are the shared baseline everyone sees and can NEVER be
 * removed via the API.
 */
export const DEFAULT_USERS: string[] = ["GANGINAV"];

/** Upstream alfa-leetcode-api base (server-only). Self-host plugs in here. */
export function alfaBase(): string {
  return (
    process.env.ALFA_API_BASE?.trim() || "https://alfa-leetcode-api.onrender.com"
  );
}

/** Cache TTL for per-user stats, in seconds. */
export function cacheTtlSeconds(): number {
  const n = Number(process.env.CACHE_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 600;
}

/** Redis key helpers. */
export const KEY = {
  stats: (user: string) => `stats:${user.toLowerCase()}`,
  roster: "roster:users",
  snapshot: (user: string, day: string) => `snap:${user.toLowerCase()}:${day}`,
};
