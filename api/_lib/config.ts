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

/** Redis key helpers. Boards are independent: each has its own user SET + meta. */
export const KEY = {
  /** Per-user normalized stats cache (shared across boards — same handle, same stats). */
  stats: (user: string) => `stats:${user.toLowerCase()}`,
  /** Daily solved snapshot for the "solved today" delta. */
  snapshot: (user: string, day: string) => `snap:${user.toLowerCase()}:${day}`,
  /** A board's roster (Redis SET of usernames). */
  boardUsers: (id: string) => `board:${id}:users`,
  /** A board's metadata (Redis JSON: { name, createdAt }). */
  boardMeta: (id: string) => `board:${id}:meta`,
  /** Index of all board ids (so the snapshot cron can enumerate them). */
  boards: "boards",
};
