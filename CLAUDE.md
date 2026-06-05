# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

**Read `AGENTS.md` before making any changes.** It defines the working agreement for this repo: KISS / DRY / YAGNI, a worktree-per-feature Git workflow, small focused commits that build and run, and a high product-design bar (no generic template UI).

## Commands

```bash
npm install        # install deps
vercel dev         # serves the SPA AND /api functions (http://localhost:3000) — mirrors prod
vercel env pull    # pull env vars (incl. Upstash) into .env.local for `vercel dev`
npm run dev        # Vite-only dev at http://localhost:5173 — NO /api, so the board can't load
npm run build      # tsc -b (type-checks SPA + /api) THEN vite build -> dist/
npm run preview    # serve the built dist/ (no /api → board can't load)
npm run typecheck  # tsc -b --noEmit
```

There is **no test runner and no linter**. `npm run build` is the gate — it type-checks both the SPA and the `/api` functions (strict, `noUnusedLocals`/`noUnusedParameters`) and fails on errors. Run it before committing. The app needs `/api` to load the board, so develop with `vercel dev` (plain `vite`/`vite preview` only serve the SPA shell — the board shows a "couldn't reach the board" notice).

TypeScript uses project references from `tsconfig.json`: `tsconfig.app.json` (the `src/` SPA, DOM libs), `tsconfig.node.json` (Vite config), and `tsconfig.api.json` (the `api/` functions, Node libs/types). `.tsbuildinfo` files are gitignored.

## Architecture

Leeterboard tracks a friend group's public LeetCode activity (daily submissions, streaks, leaderboard) — no manual logging. **Vite + React 18 + TypeScript + Tailwind 3** SPA, plus **Vercel serverless functions** that act as a shared roster store + caching proxy.

### Multi-board, server-backed — this is the central design

There is **no single global board**. Each board is an independent shared roster identified by a short code, lives entirely in Redis, and is reached at the path **`/b/{ID}`** — the code in the URL is the only key (no accounts/login). The browser calls **only** same-origin `/api/*` routes — never LeetCode/alfa directly. The server fetches + normalizes upstream LeetCode data and caches it in Upstash Redis. No browser CORS, centralized rate-limiting.

`App.tsx` is a tiny path router (`boardIdFromPath`): `/b/{ID}` renders `BoardView`, anything else renders `Landing` (create a board / join by code-or-link / reopen a recent one). `BoardView` loads everything via `loadBoard(id)` (`GET /api/leaderboard?board=ID`): a `not_found` means a bad/expired code (dead-end screen), `unreachable` shows a retry notice. Recently-opened boards are remembered in `localStorage` (`src/lib/boards.ts`) purely as a landing-screen convenience — the server is always the source of truth. There is no client-side fetch fallback; the app is useless without `/api` + Redis.

### The network layer is the load-bearing wall (two small modules)

- **Client: `src/lib/api.ts`** — the only place the client hits `/api`. Swap it and nothing else moves.
- **Server: `api/_lib/`** — `redis.ts` (the *only* Redis constructor), `leetcode.ts` (fetch + normalize), `store.ts` (read-through cache + roster ops), `http.ts` (auth/validation), `config.ts` (server constants). Routes (`stats.ts`, `roster.ts`, `leaderboard.ts`, `snapshot.ts`) are thin handlers over `_lib`.

The LeetCode quirks split across the two sides: **`api/_lib/leetcode.ts`** owns upstream *fetching + normalization* (it returns a normalized calendar to the client), while **`src/lib/leetcode.ts`** owns the client-side *derivations* `today`/`week`/`streak`/`deriveMetrics` computed from that normalized calendar. Touch carefully:

1. **UTC day bucketing** — every day key comes from `getUTC*`; local getters would drift "today" by a day. (both sides)
2. **Daily = problems solved, NOT submissions** — the daily calendar is built from `recentAcSubmissionList` (`/{user}/acSubmission`): server `normalizeAcCalendar` buckets *accepted* submissions by UTC day and counts **distinct** problems (titleSlug) per day. We deliberately do NOT use the submission calendar (it counts re-subs). `total` (from `/solved`) is cumulative unique solved.
3. **20-entry window cap** — LeetCode caps `recentAcSubmissionList` at 20, so the daily calendar only reaches back ~20 solved problems; long streaks truncate to the window. The `stats:v2:` cache prefix exists because this metric replaced the old submission-based one.
4. **The "don't lose your streak mid-day" rule** in `computeStreak`. (client)

### Server specifics

- **Redis is optional and every path degrades gracefully.** `getRedis()` returns null when neither `UPSTASH_REDIS_REST_URL/_TOKEN` nor `KV_REST_API_URL/_TOKEN` is set; callers then fetch uncached and serve defaults-only. **Use `@upstash/redis`, never the sunset `@vercel/kv`.**
- **Caching:** `getStatsCached()` is read-through (`stats:{user}` with `CACHE_TTL_SECONDS` TTL); only `ok` results are cached. Responses set `x-cache: HIT|MISS`.
- **Boards:** `api/_lib/board.ts` owns ids (Crockford-ish base32, no ambiguous chars), creation, and meta (`board:{id}:meta` JSON). Each board's roster is a Redis SET `board:{id}:users`; `boards` is a SET of all ids (so the snapshot cron can enumerate them). There are no committed defaults — boards start empty. `POST /api/board` creates one (needs Redis → 503 without it); roster/leaderboard routes 404 on an unknown board.
- **Roster writes** (`POST`/`DELETE /api/roster?board=ID`) are open — no token gate; any user is removable. Cross-origin writes are blocked by CORS: `allowCors` only advertises `POST`/`DELETE` to origins listed in `ALLOWED_ORIGINS` (the verbs are preflighted). GET is always public.
- **`/api/leaderboard?board=ID`** returns `{ board, users }` in one call (client renders from it). **`/api/snapshot`** is an optional daily cron that snapshots solved totals for every user across all boards, so the UI can show a true "solved today" delta.
- **Redis is required for boards** (unlike the stats cache, which degrades gracefully). All Redis reads still swallow errors and degrade (board not found / empty roster) rather than 500.

### `vercel.json`

Rewrites every non-`/api` route to the SPA (`/((?!api/).*)` → `/index.html`) so functions take precedence over the SPA fallback. Includes the daily snapshot cron (needs a paid Vercel plan; optional).

## Conventions

- **Clean LeetCode-style dark theme** — flat `#1a1a1a` background, `#282828` panels, clean system sans (Helvetica Neue / system-ui), LeetCode green `#2cbb5d` accent (`grind`), orange `#ffa116` (`gold`, streaks/#1), red `#ef4743` (`danger`). Palette in `tailwind.config.js`, base in `src/index.css`. JetBrains Mono (`font-mono`) is reserved for numeric values/codes (tabular alignment), not labels. Per-user colors cycle `USER_COLORS` (used for the dot, leaderboard bars, chart lines). Keep it simple — no heavy gradients, all-caps mono labels, or color-tinted glowing borders.
- **No `any` on public surfaces.** Narrow `unknown` from API payloads explicitly (server `extract*`/`hasErrorsEnvelope` in `api/_lib/leetcode.ts`).
- Comment **only** where intent is non-obvious — in practice the LeetCode quirks and the server's graceful-degradation branches (no Redis / upstream failure).

## Deploy

- **Vercel:** Vite SPA + `/api` functions auto-detected. Add **Upstash Redis** via Dashboard → Storage → Marketplace (injects `KV_REST_API_*`). Optional: `ALFA_API_BASE` (point upstream at your own alfa instance), `ALLOWED_ORIGINS` (trusted origins for cross-origin roster writes), `CACHE_TTL_SECONDS`, `CRON_SECRET`. The app requires `/api`, so Vercel (or an equivalent functions host) is the only supported deploy target — there's no static-only build.
