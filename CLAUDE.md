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

### Server-backed, single data path — this is the central design

The browser calls **only** same-origin `/api/*` routes — never LeetCode/alfa directly. The server fetches + normalizes upstream LeetCode data, caches it in Upstash Redis, and stores a **shared roster** everyone sees. No browser CORS, centralized rate-limiting.

On mount `App.tsx` loads the whole board via `loadBoardViaApi()` (`GET /api/leaderboard`). If that call can't be satisfied (API unreachable / non-JSON response) it returns null and App shows a "couldn't reach the board" notice, retrying on the next sync. There is no client-side fetch fallback — the app is useless without `/api`.

### The network layer is the load-bearing wall (two small modules)

- **Client: `src/lib/api.ts`** — the only place the client hits `/api`. Swap it and nothing else moves.
- **Server: `api/_lib/`** — `redis.ts` (the *only* Redis constructor), `leetcode.ts` (fetch + normalize), `store.ts` (read-through cache + roster ops), `http.ts` (auth/validation), `config.ts` (server constants). Routes (`stats.ts`, `roster.ts`, `leaderboard.ts`, `snapshot.ts`) are thin handlers over `_lib`.

The LeetCode quirks split across the two sides: **`api/_lib/leetcode.ts`** owns upstream *fetching + normalization* (it returns a normalized calendar to the client), while **`src/lib/leetcode.ts`** owns the client-side *derivations* `today`/`week`/`streak`/`deriveMetrics` computed from that normalized calendar. Touch carefully:

1. **UTC day bucketing** — every day key comes from `getUTC*` (LeetCode buckets the calendar by UTC midnight); local getters would drift "today" by a day. (both sides)
2. **Calendar string parsing** — `/calendar`'s value may be an object *or* a JSON-stringified object of `unixTimestampSeconds: count`. (server `normalizeCalendar`)
3. **The "don't lose your streak mid-day" rule** in `computeStreak`. (client)
4. **submissions ≠ solved** — the daily number is submissions (re-subs count); `total` is unique cumulative solved.

### Server specifics

- **Redis is optional and every path degrades gracefully.** `getRedis()` returns null when neither `UPSTASH_REDIS_REST_URL/_TOKEN` nor `KV_REST_API_URL/_TOKEN` is set; callers then fetch uncached and serve defaults-only. **Use `@upstash/redis`, never the sunset `@vercel/kv`.**
- **Caching:** `getStatsCached()` is read-through (`stats:{user}` with `CACHE_TTL_SECONDS` TTL); only `ok` results are cached. Responses set `x-cache: HIT|MISS`.
- **Roster:** committed `DEFAULT_USERS` (duplicated in `api/_lib/config.ts` ↔ `src/config.ts`, kept in sync deliberately) merged case-insensitively with a Redis SET `roster:users`. Defaults are unremovable (DELETE returns 409).
- **Write protection:** roster writes (`POST`/`DELETE /api/roster`) are open — there's no token gate. Cross-origin writes are blocked by CORS: `allowCors` only advertises `POST`/`DELETE` to origins listed in `ALLOWED_ORIGINS` (the verbs are preflighted, so an untrusted browser never gets to send the write). GET is always public.
- **`/api/leaderboard`** returns the whole board in one call (client renders from it). **`/api/snapshot`** is an optional daily cron recording solved totals so the UI can show a true "solved today" delta.

### `vercel.json`

Rewrites every non-`/api` route to the SPA (`/((?!api/).*)` → `/index.html`) so functions take precedence over the SPA fallback. Includes the daily snapshot cron (needs a paid Vercel plan; optional).

## Conventions

- **Dark "grindset terminal" aesthetic** — do not regress to generic styling. Palette/fonts (JetBrains Mono for wordmark/numbers/labels, IBM Plex Sans for body) live in `tailwind.config.js` + `src/index.css`; per-user colors cycle `USER_COLORS`. Monospace tabular numbers, color-tinted card borders, tasteful entrance pop.
- **No `any` on public surfaces.** Narrow `unknown` from API payloads explicitly (server `extract*`/`hasErrorsEnvelope` in `api/_lib/leetcode.ts`).
- Comment **only** where intent is non-obvious — in practice the LeetCode quirks and the server's graceful-degradation branches (no Redis / upstream failure).

## Deploy

- **Vercel:** Vite SPA + `/api` functions auto-detected. Add **Upstash Redis** via Dashboard → Storage → Marketplace (injects `KV_REST_API_*`). Optional: `ALFA_API_BASE` (point upstream at your own alfa instance), `ALLOWED_ORIGINS` (trusted origins for cross-origin roster writes), `CACHE_TTL_SECONDS`, `CRON_SECRET`. The app requires `/api`, so Vercel (or an equivalent functions host) is the only supported deploy target — there's no static-only build.
