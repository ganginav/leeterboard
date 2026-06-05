import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createBoard, getBoardMeta, normalizeBoardId } from "./_lib/board.js";
import { redisEnabled } from "./_lib/redis.js";
import { allowCors, queryParam } from "./_lib/http.js";

/**
 * /api/board — board lifecycle.
 *   POST { name? }      -> 201 { id, name, createdAt }   (create a new board)
 *   GET  ?id=<code>     -> 200 { id, name, createdAt }   (404 if unknown)
 *
 * Boards need persistence: without Redis, POST returns 503.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(req, res);

  switch (req.method) {
    case "OPTIONS":
      return res.status(204).end();

    case "POST": {
      if (!redisEnabled()) {
        return res.status(503).json({
          error: "storage_unavailable",
          message: "Boards need a database. Connect Upstash Redis and redeploy.",
        });
      }
      const name = (req.body as { name?: unknown })?.name;
      const meta = await createBoard(typeof name === "string" ? name : undefined);
      if (!meta) {
        return res.status(503).json({ error: "storage_unavailable" });
      }
      return res.status(201).json(meta);
    }

    case "GET": {
      const id = normalizeBoardId(queryParam(req.query, "id"));
      if (!id) {
        return res.status(400).json({ error: "bad_request", message: "Provide a valid ?id=" });
      }
      const meta = await getBoardMeta(id);
      if (!meta) {
        return res.status(404).json({ error: "board_not_found" });
      }
      return res.status(200).json(meta);
    }

    default:
      return res.status(405).json({ error: "method_not_allowed" });
  }
}
