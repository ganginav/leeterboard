import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getBoardRoster, getStatsCached } from "./_lib/store.js";
import { getBoardMeta, normalizeBoardId } from "./_lib/board.js";
import { getRedis } from "./_lib/redis.js";
import { KEY } from "./_lib/config.js";
import { agoKey, type Calendar, type FetchStatus } from "./_lib/leetcode.js";
import { allowCors, queryParam } from "./_lib/http.js";

/** One user in the combined leaderboard payload. */
interface BoardEntry {
  username: string;
  calendar: Calendar;
  total: number | null;
  /** Yesterday's solved snapshot, if cron snapshots exist (for solved deltas). */
  solvedYesterday: number | null;
  /** Present when the user couldn't be fetched. */
  error?: Exclude<FetchStatus, "ok">;
}

const MISS_GAP_MS = 300; // politeness gap, only after an upstream miss

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET /api/leaderboard?board=<id>
 * One call that returns a board's metadata plus every roster user's normalized
 * stats, fetched through the SAME cached path as /api/stats (so repeat loads are
 * cheap). The client renders the whole board from this single response.
 * 404 if the board doesn't exist.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const boardId = normalizeBoardId(queryParam(req.query, "board"));
  if (!boardId) {
    return res.status(400).json({ error: "bad_request", message: "Provide a valid ?board=" });
  }
  const meta = await getBoardMeta(boardId);
  if (!meta) {
    return res.status(404).json({ error: "board_not_found" });
  }

  const redis = getRedis();
  const roster = await getBoardRoster(boardId);
  const yesterday = agoKey(1);

  const users: BoardEntry[] = [];
  for (const username of roster) {
    const result = await getStatsCached(username);
    let solvedYesterday: number | null = null;
    if (redis) {
      try {
        solvedYesterday =
          (await redis.get<number>(KEY.snapshot(username, yesterday))) ?? null;
      } catch (e) {
        console.error(`[leaderboard] snapshot read failed for ${username}`, e);
      }
    }

    if (result.status === "ok" && result.data) {
      users.push({
        username,
        calendar: result.data.calendar,
        total: result.data.total,
        solvedYesterday,
      });
    } else {
      // result.status is "not_found" | "unreachable" here (ok always has data).
      const error = result.status === "ok" ? "unreachable" : result.status;
      users.push({ username, calendar: {}, total: null, solvedYesterday, error });
    }

    // Only pause when we actually hit upstream (cache misses), to respect limits.
    if (!result.hit) await sleep(MISS_GAP_MS);
  }

  return res.status(200).json({
    board: { id: meta.id, name: meta.name },
    users,
    generatedAt: Date.now(),
  });
}
