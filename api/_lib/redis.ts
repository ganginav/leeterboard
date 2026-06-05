import { Redis } from "@upstash/redis";

/**
 * Upstash Redis access — the ONLY place Redis is constructed.
 *
 * NOTE: we use @upstash/redis, not the deprecated/sunset @vercel/kv. The Vercel
 * Upstash Marketplace integration may inject either naming convention, so we
 * accept both pairs:
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   - KV_REST_API_URL        / KV_REST_API_TOKEN
 *
 * If neither pair is present we return null and every caller degrades
 * gracefully (no caching, defaults-only roster) instead of crashing.
 */

let cached: Redis | null | undefined;

function resolveCreds(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return { url, token };
}

/** Returns a Redis client, or null when Upstash isn't configured. Memoized. */
export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const creds = resolveCreds();
  cached = creds ? new Redis(creds) : null;
  return cached;
}

/** True when caching/roster persistence is available. */
export function redisEnabled(): boolean {
  return resolveCreds() !== null;
}
