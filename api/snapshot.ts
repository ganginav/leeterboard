import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoster, getStatsCached } from "./_lib/store.js";
import { getRedis } from "./_lib/redis.js";
import { KEY } from "./_lib/config.js";
import { todayKey } from "./_lib/leetcode.js";
import { allowCors, authorizeSnapshot } from "./_lib/http.js";

const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * GET /api/snapshot — intended for a daily Vercel Cron.
 *
 * Records each roster user's cumulative `solved` total under
 * snap:{user}:{YYYY-MM-DD}. With two days of snapshots the UI can show a true
 * "solved today" delta (today's total − yesterday's snapshot) instead of just
 * raw submissions. Optional: the app works fine without it.
 *
 * Protected by CRON_SECRET (Authorization: Bearer ...), which Vercel Cron sends
 * automatically. Vercel Cron requires a Pro plan — this whole feature is optional.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!authorizeSnapshot(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const redis = getRedis();
  if (!redis) {
    return res
      .status(200)
      .json({ ok: false, reason: "redis_not_configured", stored: 0 });
  }

  const day = todayKey();
  const roster = await getRoster();
  let stored = 0;

  for (const username of roster) {
    const result = await getStatsCached(username);
    if (result.status === "ok" && result.data && result.data.total !== null) {
      await redis.set(KEY.snapshot(username, day), result.data.total, {
        ex: SNAPSHOT_TTL_SECONDS,
      });
      stored++;
    }
  }

  return res.status(200).json({ ok: true, day, stored, users: roster.length });
}
