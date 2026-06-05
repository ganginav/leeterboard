/**
 * Cache + roster persistence built on top of redis.ts.
 *
 * Every function degrades gracefully when Redis is unconfigured: stats are
 * fetched uncached, and the roster is just the committed defaults.
 */

import { getRedis } from "./redis.js";
import { KEY, cacheTtlSeconds } from "./config.js";
import {
  fetchUpstreamStats,
  type Calendar,
  type FetchStatus,
} from "./leetcode.js";

/** Shape stored in Redis and returned to the client. */
export interface CachedStats {
  username: string;
  calendar: Calendar;
  total: number | null;
  cachedAt: number;
}

export interface StatsResult {
  status: FetchStatus;
  /** Present when status === "ok". */
  data?: CachedStats;
  /** True when served from the Redis cache (for logging/verification). */
  hit: boolean;
}

/**
 * Get one user's normalized stats, using Redis as a read-through cache with TTL.
 * Cache holds only successful results; not_found/unreachable are never cached so
 * a transient outage or a freshly-public profile recovers on the next request.
 */
export async function getStatsCached(username: string): Promise<StatsResult> {
  const redis = getRedis();
  const key = KEY.stats(username);

  // Read-through cache. A Redis read error (transient outage, or a single
  // un-parseable entry) must NOT take down the request — treat it as a miss and
  // refetch; the subsequent write self-heals any corrupt entry.
  if (redis) {
    try {
      const cached = await redis.get<CachedStats>(key);
      if (cached) {
        console.log(`[stats] cache HIT ${key}`);
        return { status: "ok", data: cached, hit: true };
      }
    } catch (e) {
      console.error(`[stats] cache READ failed for ${key} — treating as miss`, e);
    }
  }
  console.log(`[stats] cache MISS ${key}`);

  const upstream = await fetchUpstreamStats(username);
  if (upstream.status !== "ok") {
    return { status: upstream.status, hit: false };
  }

  const data: CachedStats = {
    username,
    calendar: upstream.calendar,
    total: upstream.total,
    cachedAt: Date.now(),
  };
  if (redis) {
    try {
      await redis.set(key, data, { ex: cacheTtlSeconds() });
    } catch (e) {
      console.error(`[stats] cache WRITE failed for ${key} — serving uncached`, e);
    }
  }
  return { status: "ok", data, hit: false };
}

/** Read one board's roster members, degrading to [] on any Redis error. */
export async function getBoardRoster(boardId: string): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const members = await redis.smembers(KEY.boardUsers(boardId));
    return members.map((u) => String(u).trim()).filter(Boolean);
  } catch (e) {
    console.error(`[roster] smembers failed for board ${boardId}`, e);
    return [];
  }
}

/** Add a user to a board (no-op if already present, any casing). */
export async function addBoardUser(
  boardId: string,
  name: string,
): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    const existing = await getBoardRoster(boardId);
    const dup = existing.some((u) => u.toLowerCase() === name.toLowerCase());
    if (!dup) await redis.sadd(KEY.boardUsers(boardId), name.trim());
  }
  return getBoardRoster(boardId);
}

/** Remove a user from a board by case-insensitive match. */
export async function removeBoardUser(
  boardId: string,
  name: string,
): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    const existing = await getBoardRoster(boardId);
    const match = existing.find((u) => u.toLowerCase() === name.toLowerCase());
    if (match) await redis.srem(KEY.boardUsers(boardId), match);
  }
  return getBoardRoster(boardId);
}
