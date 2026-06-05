import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStatsCached } from "./_lib/store";
import { allowCors, queryParam, validUsername } from "./_lib/http";

/**
 * GET /api/stats?user=<username>
 * Server-fetched + normalized + Redis-cached per-user stats.
 * 200 -> { username, calendar, total, cachedAt }
 * 404 -> { error: "not_found" }   502 -> { error: "unreachable" }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const user = validUsername(queryParam(req.query, "user"));
  if (!user) {
    return res
      .status(400)
      .json({ error: "bad_request", message: "Provide a valid ?user=" });
  }

  const result = await getStatsCached(user);
  if (result.status === "not_found") {
    return res.status(404).json({ error: "not_found", username: user });
  }
  if (result.status === "unreachable") {
    return res.status(502).json({ error: "unreachable", username: user });
  }
  res.setHeader("x-cache", result.hit ? "HIT" : "MISS");
  return res.status(200).json(result.data);
}
