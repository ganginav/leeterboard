# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

**Read `AGENTS.md` before making any changes.** It defines the working agreement for this repo: KISS / DRY / YAGNI, a worktree-per-feature Git workflow, small focused commits that build and run, and a high product-design bar (no generic template UI).

## Commands

```bash
npm install        # install deps
npm run dev        # Vite-only dev at http://localhost:5173 — NO /api, runs the LOCAL FALLBACK
vercel dev         # serves the SPA AND /api functions (http://localhost:3000) — mirrors prod
vercel env pull    # pull env vars (incl. Upstash) into .env.local for `vercel dev`
npm run build      # tsc -b (type-checks SPA + /api) THEN vite build -> dist/
npm run preview    # serve the built dist/ (no /api → fallback)
npm run typecheck  # tsc -b --noEmit
```

There is **no test runner and no linter**. `npm run build` is the gate — it type-checks both the SPA and the `/api` functions (strict, `noUnusedLocals`/`noUnusedParameters`) and fails on errors. Run it before committing. `vercel` CLI may not be installed locally; without it, only the fallback path is runnable (see below).

TypeScript uses project references from `tsconfig.json`: `tsconfig.app.json` (the `src/` SPA, DOM libs), `tsconfig.node.json` (Vite config), and `tsconfig.api.json` (the `api/` functions, Node libs/types). `.tsbuildinfo` files are gitignored.

## Architecture

GrindBoard tracks a friend group's public LeetCode activity (daily submissions, streaks, leaderboard) — no manual logging. **Vite + React 18 + TypeScript + Tailwind 3** SPA, plus **Vercel serverless functions** that act as a shared roster store + caching proxy.

### Two data modes — this is the central design

The app runs in one of two modes, chosen at startup by `loadBoardViaApi()` probing `GET /api/leaderboard`:

- **`api` (shared, server-backed):** the browser calls only same-origin `/api/*` routes. The server fetches + normalizes upstream LeetCode data, caches it in Upstash Redis, and stores a **shared roster** everyone sees. No browser CORS, centralized rate-limiting.
- **`local` (fallback):** when `/api/*` is absent (plain `vite`, `vite preview`, the Docker/nginx image), the app reads committed `DEFAULT_USERS` + per-browser `localStorage` additions and fetches the public alfa API **directly** from the in-app "API base" field.

`App.tsx` detects the mode once on mount and **renders the same UI either way**; mutations and sync dispatch on `modeRef.current`. When touching App, preserve both paths — the fallback must never crash when the backend is missing.

### The network layer is the load-bearing wall (two small modules)

- **Client: `src/lib/api.ts`** — the only place the client hits `/api`. Swap it and nothing else moves.
- **Server: `api/_lib/`** — `redis.ts` (the *only* Redis constructor), `leetcode.ts` (fetch + normalize), `store.ts` (read-through cache + roster ops), `http.ts` (auth/validation), `config.ts` (server constants). Routes (`stats.ts`, `roster.ts`, `leaderboard.ts`, `snapshot.ts`) are thin handlers over `_lib`.

`leetcode.ts` exists on **both** sides (server normalizes raw payloads; client `src/lib/leetcode.ts` keeps the same helpers for fallback fetching + always owns the derivations `today`/`week`/`streak`/`deriveMetrics`). The LeetCode quirks are isolated and commented in both — touch carefully:

1. **UTC day bucketing** — every day key comes from `getUTC*` (LeetCode buckets the calendar by UTC midnight); local getters would drift "today" by a day.
2. **Calendar string parsing** — `/calendar`'s value may be an object *or* a JSON-stringified object of `unixTimestampSeconds: count`.
3. **The "don't lose your streak mid-day" rule** in `computeStreak`.
4. **submissions ≠ solved** — the daily number is submissions (re-subs count); `total` is unique cumulative solved.

### Server specifics

- **Redis is optional and every path degrades gracefully.** `getRedis()` returns null when neither `UPSTASH_REDIS_REST_URL/_TOKEN` nor `KV_REST_API_URL/_TOKEN` is set; callers then fetch uncached and serve defaults-only. **Use `@upstash/redis`, never the sunset `@vercel/kv`.**
- **Caching:** `getStatsCached()` is read-through (`stats:{user}` with `CACHE_TTL_SECONDS` TTL); only `ok` results are cached. Responses set `x-cache: HIT|MISS`.
- **Roster:** committed `DEFAULT_USERS` (duplicated in `api/_lib/config.ts` ↔ `src/config.ts`, kept in sync deliberately) merged case-insensitively with a Redis SET `roster:users`. Defaults are unremovable (DELETE returns 409).
- **Write protection:** if `ADMIN_TOKEN` is set, `POST`/`DELETE /api/roster` require header `x-admin-token`; otherwise writes are open. GET is always public. A 401 surfaces in the UI as an admin-token prompt (`AdminRequiredError`).
- **`/api/leaderboard`** returns the whole board in one call (client renders from it). **`/api/snapshot`** is an optional daily cron recording solved totals so the UI can show a true "solved today" delta.

### `vercel.json`

Rewrites every non-`/api` route to the SPA (`/((?!api/).*)` → `/index.html`) so functions take precedence over the SPA fallback. Includes the daily snapshot cron (needs a paid Vercel plan; optional).

## Conventions

- **Dark "grindset terminal" aesthetic** — do not regress to generic styling. Palette/fonts (JetBrains Mono for wordmark/numbers/labels, IBM Plex Sans for body) live in `tailwind.config.js` + `src/index.css`; per-user colors cycle `USER_COLORS`. Monospace tabular numbers, color-tinted card borders, tasteful entrance pop.
- **No `any` on public surfaces.** Narrow `unknown` from API payloads explicitly (`extract*`/`hasErrorsEnvelope`).
- Comment **only** where intent is non-obvious — in practice the LeetCode quirks and the graceful-degradation branches.

## Deploy

- **Vercel:** Vite SPA + `/api` functions auto-detected. Add **Upstash Redis** via Dashboard → Storage → Marketplace (injects `KV_REST_API_*`). Optional: `ADMIN_TOKEN`, `ALFA_API_BASE` (self-host upstream), `CACHE_TTL_SECONDS`, `CRON_SECRET`.
- **Self-host:** `docker compose up --build` runs the SPA (nginx, `:8080`, **local fallback mode**) + a private alfa-leetcode-api (`:3000`). For the full shared/cached experience, deploy to Vercel and point `ALFA_API_BASE` at your alfa instance.
