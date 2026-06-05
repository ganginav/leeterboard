/**
 * Cache + roster persistence built on top of redis.ts.
 *
 * Every function degrades gracefully when Redis is unconfigured: stats are
 * fetched uncached, and the roster is just the committed defaults.
 */

import { getRedis } from "./redis.js";
import { DEFAULT_USERS, KEY, cacheTtlSeconds } from "./config.js";
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

  if (redis) {
    const cached = await redis.get<CachedStats>(key);
    if (cached) {
      console.log(`[stats] cache HIT ${key}`);
      return { status: "ok", data: cached, hit: true };
    }
  }
  console.log(`[stats] cache MISS ${KEY.stats(username)}`);

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
    await redis.set(key, data, { ex: cacheTtlSeconds() });
  }
  return { status: "ok", data, hit: false };
}

/** Is `name` one of the committed defaults? (case-insensitive) */
export function isDefaultUser(name: string): boolean {
  const k = name.trim().toLowerCase();
  return DEFAULT_USERS.some((d) => d.toLowerCase() === k);
}

/**
 * Merge committed defaults with the Redis-stored user set, de-duplicated
 * case-insensitively. Defaults always come first and can never be absent.
 */
export async function getRoster(): Promise<string[]> {
  const redis = getRedis();
  const added = redis ? await redis.smembers(KEY.roster) : [];

  const seen = new Set<string>();
  const roster: string[] = [];
  for (const u of [...DEFAULT_USERS, ...added]) {
    const name = String(u).trim();
    const k = name.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    roster.push(name);
  }
  return roster;
}

/** Add a user to the shared roster (no-op if it already exists, any casing). */
export async function addRosterUser(name: string): Promise<string[]> {
  const redis = getRedis();
  if (redis && !isDefaultUser(name)) {
    const existing = await redis.smembers(KEY.roster);
    const dup = existing.some(
      (u) => String(u).toLowerCase() === name.toLowerCase(),
    );
    if (!dup) await redis.sadd(KEY.roster, name.trim());
  }
  return getRoster();
}

/** Remove a user from the shared roster by case-insensitive match. */
export async function removeRosterUser(name: string): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    const existing = await redis.smembers(KEY.roster);
    const match = existing.find(
      (u) => String(u).toLowerCase() === name.toLowerCase(),
    );
    if (match) await redis.srem(KEY.roster, match);
  }
  return getRoster();
}
