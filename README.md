# Leeterboard

A shared **LeetCode accountability tracker** for a friend group — _leet +
leaderboard_. Point it at a few public LeetCode usernames and it shows
everyone's **daily activity, streaks, and a leaderboard** — so the group stays
accountable and keeps each other honest. No manual logging: everything is
auto-fetched from public profiles.

Boards are **shared and server-backed**, and there can be **many** — each is its
own board with a short code, reached at `/b/{CODE}`. Create one, send the link
to your group, and everyone sees and edits the same live board. No login — the
link is the key. A serverless **caching proxy** sits between the browser and the
public LeetCode API so we don't hammer it. Built with **Vite + React +
TypeScript + Tailwind**; deploys to **Vercel** (SPA + serverless functions +
Upstash Redis).

![stack](https://img.shields.io/badge/vite-react%2Bts-39d353) ![license](https://img.shields.io/badge/license-MIT-8b949e)

---

## What the numbers mean (read this)

- **The big daily number is _problems solved that day_** — distinct problems
  accepted, so re-solving the same one counts once. It's the "did you actually do
  a problem today" signal, derived from LeetCode's recent **accepted** submissions
  (`recentAcSubmissionList`), not raw submissions.
- **"total" is the exact cumulative count** of unique solved problems (all time).
- **Window cap:** LeetCode only exposes your **last ~20 accepted** problems, so
  the daily history (and therefore long streaks) reaches back only that far.
  Today / this week / short streaks are unaffected.
- **Only _public_ LeetCode profiles work.** A private profile reads as "not found".

Streaks count **consecutive UTC days** with at least one problem solved. If you
haven't solved one yet _today_, your streak is measured ending **yesterday**, so
it isn't falsely "lost" early in the day.

---

## Architecture

```
Browser (React SPA)
   │  same-origin calls only
   ▼
/api/*  (Vercel Serverless Functions, Node)
   ├── reads/writes the shared roster        ──►  Upstash Redis  (roster:users SET)
   ├── fetches + normalizes per-user stats    ──►  upstream alfa-leetcode-api
   └── caches stats per user (TTL)            ──►  Upstash Redis  (stats:{user})
```

The client **never calls LeetCode/alfa directly** in production — only our
`/api/*` routes — which removes all browser CORS concerns and centralizes
caching + rate-limiting on the server. The whole network layer lives in two
small modules: **`src/lib/api.ts`** (client) and **`api/_lib/`** (server).

Data still comes from [**alfa-leetcode-api**](https://github.com/alfaarghya/alfa-leetcode-api),
a REST wrapper over LeetCode's GraphQL, using `/{user}/calendar` and
`/{user}/solved`.

The app requires `/api` to function — there is no client-side fetch fallback. If
`/api/leaderboard` can't be reached, the board shows a "couldn't reach the board"
notice and retries on the next sync.

### API routes (`/api`)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/board` | POST | create a board (`{name?}`) → `{id,name,createdAt}` (`503` if no Redis) |
| `/api/board?id=` | GET | board metadata (`404` if unknown) |
| `/api/stats?user=` | GET | normalized, Redis-cached stats for one user (`404` not_found / `502` unreachable) |
| `/api/roster?board=` | GET | that board's roster |
| `/api/roster?board=` | POST | add a user (`{username}`) to the board; open write (cross-origin gated by CORS) |
| `/api/roster?board=&user=` | DELETE | remove a user from the board |
| `/api/leaderboard?board=` | GET | **one call** → `{board, users}` with everyone's stats (`404` if unknown board) |
| `/api/snapshot` | GET | cron: snapshot solved totals across all boards for daily deltas (optional) |

Boards live in Redis: `board:{id}:meta` (name/createdAt), `board:{id}:users` (a
SET), and a `boards` index set. The board code in `/b/{id}` is the only handle —
there are no accounts.

---

## Environment variables

All server-side unless noted. Set them in **Vercel → Project → Settings →
Environment Variables** (or a local `.env` for `vercel dev`). See
[`.env.example`](.env.example).

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | no¹ | — | Upstash Redis credentials (caching + shared roster) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | no¹ | — | alternate names the Vercel Upstash integration injects (either pair works) |
| `ALFA_API_BASE` | no | `https://alfa-leetcode-api.onrender.com` | upstream LeetCode API; **point at your own alfa to self-host** |
| `CACHE_TTL_SECONDS` | no | `600` | per-user stats cache TTL |
| `CRON_SECRET` | no | — | optional secret for the snapshot cron (`Authorization: Bearer …`) |
| `ALLOWED_ORIGINS` | no | — | comma-separated origins allowed to make **cross-origin** roster writes; only needed if the frontend is served from a different origin than `/api` (reads are public regardless) |

¹ Redis is optional: without it the app still runs — stats are fetched uncached
and the roster is just the committed defaults. **We use `@upstash/redis`, not the
sunset `@vercel/kv`.**

---

## Local development

```bash
npm install
```

**With the API + Redis (recommended — mirrors production):**

```bash
npm i -g vercel        # if you don't have it
vercel link            # link this folder to a Vercel project
vercel env pull        # pull env vars (incl. Upstash) into .env.local
vercel dev             # serves the SPA AND /api at http://localhost:3000
```

> Plain `npm run dev` (Vite at http://localhost:5173) does **not** run the
> serverless functions, so the board can't load — it shows a "couldn't reach the
> board" notice. Use `vercel dev` for any real work.

Build / preview:

```bash
npm run build          # type-checks SPA + /api, then builds dist/
npm run preview        # serve the built SPA only (no /api → board can't load)
```

---

## Deploy to Vercel

1. Push to GitHub and **import the repo** in Vercel. Framework auto-detects as
   **Vite**; the `/api` directory is auto-detected as Node serverless functions.
   `vercel.json` rewrites non-`/api` routes to the SPA.
2. **Add Upstash Redis** (for the shared roster + caching):
   **Dashboard → Storage → Marketplace → "Upstash for Redis" → create a database
   → Connect Project.** This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   automatically (the app also accepts `UPSTASH_REDIS_REST_URL` / `_TOKEN`).
3. (Optional) Set `ALFA_API_BASE` to use your own alfa instance, and
   `CACHE_TTL_SECONDS` to tune cache freshness.
4. Deploy. Done — no Redis still works (defaults-only, uncached).

### Boards

- **Create:** the landing screen makes a board (optionally named) and drops you
  at `/b/{CODE}`. Share that link/code with your group.
- **Join:** open the link, or paste the code on the landing screen.
- **Edit:** anyone with the code can add/remove usernames; changes are shared
  live with everyone on that board. Writes are open; if you serve the frontend
  from a different origin than `/api`, set `ALLOWED_ORIGINS` so the cross-origin
  write isn't blocked by CORS.
- **Persistence:** boards live server-side in Redis, so a cleared browser cache
  loses nothing — just reopen the link. Recently-opened boards are listed on the
  landing screen (stored per-browser in `localStorage`) for convenience.

Boards require Upstash Redis (the stats cache degrades gracefully without it,
but boards can't be created/stored).

---

## Accurate daily solved (optional)

The calendar only exposes daily *submissions*, not unique solves. To show a true
per-day **solved** delta, the `/api/snapshot` route records each user's
cumulative solved total once a day; the UI then shows
`solved today = today's total − yesterday's snapshot`.

- `vercel.json` includes a daily cron hitting `/api/snapshot`. **Vercel Cron
  needs a paid plan / has plan limits** — this feature is entirely optional; the
  board works without it (you just won't see "solved today").
- Protect the route with `CRON_SECRET` (`Authorization: Bearer …`, which Vercel
  Cron sends automatically). If unset, the route is open.

---

## Caching model

`/api/stats` (and therefore `/api/leaderboard`) is a **read-through cache**:
on a miss it fetches upstream and stores the normalized result in Redis under
`stats:{user}` with `CACHE_TTL_SECONDS` TTL; on a hit within the TTL it returns
instantly without touching LeetCode. Only successful results are cached, so a
transient outage or a newly-public profile recovers on the next request.
Responses carry an `x-cache: HIT|MISS` header (and the server logs hits/misses)
for verification. This is what protects the public instance from rate limits.

---

## Project layout

```
api/                   # Vercel serverless functions (the shared backend)
  _lib/                #   redis, config, leetcode (normalize+fetch), store (cache+roster), http (auth)
  stats.ts roster.ts leaderboard.ts snapshot.ts
src/
  config.ts            # DEFAULT_USERS, colors, tuning
  lib/api.ts           # client → /api data layer (swappable network source)
  lib/leetcode.ts      # date helpers + streak + deriveMetrics (client-side derivations)
  components/          # Header, Card, Leaderboard, Sparkline, SettingsRow
  App.tsx              # board load + sync orchestration, layout
```

The LeetCode quirks (UTC bucketing, calendar string parsing, streak rule,
submissions ≠ solved) are commented where they live — server normalization in
`api/_lib/leetcode.ts`, client derivations in `src/lib/leetcode.ts`.

---

## License

MIT — see [LICENSE](LICENSE).
