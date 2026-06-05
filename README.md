# THE GRIND BOARD

A shared **LeetCode accountability tracker** for a friend group. Point it at a
few public LeetCode usernames and it shows everyone's **daily activity,
streaks, and a leaderboard** — so the group stays locked in and keeps each
other honest. No manual logging: everything is auto-fetched from public
profiles.

As of v2 the board is **shared and server-backed**: every visitor sees the same
roster, and a serverless **caching proxy** sits between the browser and the
public LeetCode API so we don't hammer it. Built with **Vite + React +
TypeScript + Tailwind**; deploys to **Vercel** (SPA + serverless functions),
with a **Docker** path for self-hosting.

![stack](https://img.shields.io/badge/vite-react%2Bts-39d353) ![license](https://img.shields.io/badge/license-MIT-8b949e)

---

## What the numbers mean (read this)

- **The big daily number is _submissions_, not unique solves.** It comes from
  LeetCode's per-day submission calendar — the most reliable public "did they
  grind today" signal — so re-submits and multiple attempts all count. This is
  intentional: it rewards showing up.
- **"solved" is the exact cumulative total** of unique accepted problems.
- **"solved today" (optional)** is a true per-day *solved* delta, shown only when
  daily snapshots exist (see [Accurate daily solved](#accurate-daily-solved-optional)).
- **Only _public_ LeetCode profiles work.** A private profile reads as "not found".

Streaks count **consecutive UTC days** with at least one submission. If you
haven't submitted yet _today_, your streak is measured ending **yesterday**, so
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

### Graceful fallback (no server needed to run)

If `/api/*` isn't available — e.g. you run plain `vite`, `vite preview`, or the
Docker/nginx image — the app automatically falls back to **local mode**: it
reads the committed `DEFAULT_USERS` plus any usernames you add in *your* browser
(`localStorage`), fetching the public alfa API directly from the in-app "API
base" field. It never crashes when the backend is absent.

### API routes (`/api`)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/stats?user=` | GET | normalized, Redis-cached stats for one user (`404` not_found / `502` unreachable) |
| `/api/roster` | GET | shared roster = committed defaults ∪ Redis set (deduped) |
| `/api/roster` | POST | add a user (`{username}`); admin-guarded |
| `/api/roster?user=` | DELETE | remove a user; admin-guarded; **defaults can't be removed** (`409`) |
| `/api/leaderboard` | GET | **one call** returning every roster user's stats (through the cache) |
| `/api/snapshot` | GET | cron: record each user's solved total for daily deltas (optional) |

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
| `ADMIN_TOKEN` | no | — | if set, roster writes require header `x-admin-token`; if unset, writes are open |
| `CRON_SECRET` | no | — | optional secret for the snapshot cron (`Authorization: Bearer …`) |
| `VITE_API_BASE` | no | public alfa | **fallback/local mode only** (build-time); upstream for direct browser fetch when `/api` is absent |

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

**Vite only (no `/api`, exercises the local fallback):**

```bash
npm run dev            # http://localhost:5173 — runs in local fallback mode
```

> Plain `npm run dev` does **not** run the serverless functions, so the app
> shows "local mode" and reads the public alfa directly. Use `vercel dev` to
> test the shared/cached path.

Build / preview:

```bash
npm run build          # type-checks SPA + /api, then builds dist/
npm run preview        # serve the built SPA (no /api → fallback)
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
3. (Optional) Set `ADMIN_TOKEN` to lock roster edits, `ALFA_API_BASE` to use your
   own alfa instance, and `CACHE_TTL_SECONDS` to tune cache freshness.
4. Deploy. Done — no Redis still works (defaults-only, uncached).

### Changing the shared roster

- **Committed baseline:** edit `DEFAULT_USERS` in
  [`src/config.ts`](src/config.ts) **and** the duplicated copy in
  [`api/_lib/config.ts`](api/_lib/config.ts) (kept in sync on purpose), then
  redeploy. These can never be removed via the API.
- **At runtime:** anyone can add a username in the UI — it's `POST`ed to
  `/api/roster` and shared with everyone. Non-default users can be removed.
  (If `ADMIN_TOKEN` is set, the UI shows a token field; a rejected write surfaces
  "edits are locked — enter the admin token".)

---

## Self-host with Docker

`docker compose up --build` runs the SPA (nginx, **:8080**) and a private
`alfa-leetcode-api` (**:3000**).

```bash
docker compose up --build
```

The nginx image serves the **static SPA only** (no serverless `/api`), so it runs
in **local fallback mode** and the browser talks to the alfa container directly
(`VITE_API_BASE=http://localhost:3000`, baked at build). This is the simplest
self-host and needs no Redis. To get the full shared/cached experience while
self-hosting, deploy to Vercel and set `ALFA_API_BASE` to your own alfa instance.

---

## Accurate daily solved (optional)

The calendar only exposes daily *submissions*, not unique solves. To show a true
per-day **solved** delta, the `/api/snapshot` route records each user's
cumulative solved total once a day; the UI then shows
`solved today = today's total − yesterday's snapshot`.

- `vercel.json` includes a daily cron hitting `/api/snapshot`. **Vercel Cron
  needs a paid plan / has plan limits** — this feature is entirely optional; the
  board works without it (you just won't see "solved today").
- Protect the route with `ADMIN_TOKEN` (header `x-admin-token`) or `CRON_SECRET`
  (`Authorization: Bearer …`, which Vercel Cron sends automatically).

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
  config.ts            # DEFAULT_USERS, colors, tuning, localStorage keys
  lib/api.ts           # client → /api data layer (swappable network source)
  lib/leetcode.ts      # date helpers + normalize + streak + deriveMetrics (also powers local fallback)
  components/          # Header, Card, Leaderboard, Sparkline, SettingsRow
  App.tsx              # mode detection (api vs local), sync orchestration, layout
```

The LeetCode quirks (UTC bucketing, calendar string parsing, streak rule,
submissions ≠ solved) are commented where they live — server normalization in
`api/_lib/leetcode.ts`, client derivations in `src/lib/leetcode.ts`.

---

## License

MIT — see [LICENSE](LICENSE).
