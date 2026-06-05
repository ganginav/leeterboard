import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  addRosterUser,
  getRoster,
  isDefaultUser,
  removeRosterUser,
} from "./_lib/store";
import { DEFAULT_USERS } from "./_lib/config";
import { allowCors, queryParam, requireAdmin, validUsername } from "./_lib/http";

/**
 * /api/roster — the SHARED roster (committed defaults + Redis-stored adds).
 *   GET    -> { users, defaults }            (public)
 *   POST   { username }  -> { users }        (write, admin-guarded)
 *   DELETE ?user=<name>  -> { users }        (write, admin-guarded; defaults protected)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res);

  switch (req.method) {
    case "OPTIONS":
      return res.status(204).end();

    case "GET": {
      const users = await getRoster();
      return res.status(200).json({ users, defaults: DEFAULT_USERS });
    }

    case "POST": {
      if (!requireAdmin(req, res)) return; // responds 401 itself
      const name = validUsername((req.body as { username?: unknown })?.username);
      if (!name) {
        return res
          .status(400)
          .json({ error: "bad_request", message: "Invalid username." });
      }
      const users = await addRosterUser(name);
      return res.status(200).json({ users, defaults: DEFAULT_USERS });
    }

    case "DELETE": {
      if (!requireAdmin(req, res)) return;
      const name = validUsername(queryParam(req.query, "user"));
      if (!name) {
        return res
          .status(400)
          .json({ error: "bad_request", message: "Provide a valid ?user=" });
      }
      if (isDefaultUser(name)) {
        return res.status(409).json({
          error: "protected_default",
          message: `"${name}" is a committed default and can't be removed.`,
        });
      }
      const users = await removeRosterUser(name);
      return res.status(200).json({ users, defaults: DEFAULT_USERS });
    }

    default:
      return res.status(405).json({ error: "method_not_allowed" });
  }
}
