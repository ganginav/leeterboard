import type { VercelRequest, VercelResponse } from "@vercel/node";
import { addBoardUser, getBoardRoster, removeBoardUser } from "./_lib/store.js";
import { boardExists, normalizeBoardId } from "./_lib/board.js";
import { allowCors, queryParam, validUsername } from "./_lib/http.js";

/**
 * /api/roster?board=<id> — a single board's shared roster.
 *   GET    -> { users }
 *   POST   { username }  -> { users }      (open write; cross-origin gated by CORS)
 *   DELETE ?user=<name>  -> { users }      (open write)
 * 404 if the board doesn't exist.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const boardId = normalizeBoardId(queryParam(req.query, "board"));
  if (!boardId) {
    return res.status(400).json({ error: "bad_request", message: "Provide a valid ?board=" });
  }
  if (!(await boardExists(boardId))) {
    return res.status(404).json({ error: "board_not_found" });
  }

  switch (req.method) {
    case "GET":
      return res.status(200).json({ users: await getBoardRoster(boardId) });

    case "POST": {
      const name = validUsername((req.body as { username?: unknown })?.username);
      if (!name) {
        return res.status(400).json({ error: "bad_request", message: "Invalid username." });
      }
      return res.status(200).json({ users: await addBoardUser(boardId, name) });
    }

    case "DELETE": {
      const name = validUsername(queryParam(req.query, "user"));
      if (!name) {
        return res.status(400).json({ error: "bad_request", message: "Provide a valid ?user=" });
      }
      return res.status(200).json({ users: await removeBoardUser(boardId, name) });
    }

    default:
      return res.status(405).json({ error: "method_not_allowed" });
  }
}
