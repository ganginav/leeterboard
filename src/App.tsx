import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import Card from "./components/Card";
import Leaderboard from "./components/Leaderboard";
import Sparkline from "./components/Sparkline";
import SettingsRow from "./components/SettingsRow";
import {
  AUTO_SYNC_MS,
  DEFAULT_API_BASE,
  DEFAULT_USERS,
  LS_ADDED_USERS,
  LS_ADMIN_TOKEN,
  LS_API_BASE,
  REQUEST_GAP_MS,
  USER_COLORS,
  isDefaultUser,
} from "./config";
import { deriveMetrics, fetchUser, sleep } from "./lib/leetcode";
import type { FetchResult, FetchStatus, UserMetrics } from "./lib/leetcode";
import {
  AdminRequiredError,
  apiAddUser,
  apiRemoveUser,
  loadBoardViaApi,
  type BoardEntry,
} from "./lib/api";
import type { BoardMode, BoardUser, Metric } from "./types";

/** Per-user fetch state, keyed by lowercased username in `states`. */
interface UserState {
  status: FetchStatus | "loading";
  metrics: UserMetrics | null;
  /** True per-day solved delta (api mode + cron snapshots only). */
  solvedToday: number | null;
}

interface RosterEntry {
  username: string;
  isDefault: boolean;
}

const envBase = import.meta.env.VITE_API_BASE?.trim();

// ───────────────────── localStorage helpers ──────────────────────

function loadAddedUsers(): string[] {
  try {
    const raw = localStorage.getItem(LS_ADDED_USERS);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  } catch {
    /* ignore malformed storage */
  }
  return [];
}

function persistAddedUsers(users: string[]): void {
  try {
    localStorage.setItem(LS_ADDED_USERS, JSON.stringify(users));
  } catch {
    /* storage may be unavailable (private mode) — non-fatal */
  }
}

function loadApiBase(): string {
  try {
    const saved = localStorage.getItem(LS_API_BASE)?.trim();
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return envBase || DEFAULT_API_BASE;
}

function loadAdminToken(): string {
  try {
    return localStorage.getItem(LS_ADMIN_TOKEN)?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * LOCAL-mode roster: committed defaults merged with user-added names,
 * de-duplicated case-insensitively, defaults first and unremovable.
 */
function buildRoster(added: string[]): RosterEntry[] {
  const seen = new Set<string>();
  const roster: RosterEntry[] = [];
  for (const u of DEFAULT_USERS) {
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roster.push({ username: u, isDefault: true });
  }
  for (const u of added) {
    const name = u.trim();
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    roster.push({ username: name, isDefault: false });
  }
  return roster;
}

/** Convert a server leaderboard entry into per-user UI state. */
function entryToState(entry: BoardEntry): UserState {
  const status: FetchStatus = entry.error ?? "ok";
  if (status !== "ok") return { status, metrics: null, solvedToday: null };

  const result: FetchResult = {
    status: "ok",
    calendar: entry.calendar,
    total: entry.total ?? 0,
  };
  const solvedToday =
    entry.total != null && entry.solvedYesterday != null
      ? Math.max(0, entry.total - entry.solvedYesterday)
      : null;
  return { status: "ok", metrics: deriveMetrics(result), solvedToday };
}

// ─────────────────────────── App ─────────────────────────────────

export default function App() {
  const [mode, setMode] = useState<BoardMode>("detecting");
  const [serverRoster, setServerRoster] = useState<string[]>([]); // api mode
  const [addedUsers, setAddedUsers] = useState<string[]>(loadAddedUsers); // local mode
  const [apiBase, setApiBase] = useState<string>(loadApiBase);
  const [adminToken, setAdminToken] = useState<string>(loadAdminToken);
  const [adminLocked, setAdminLocked] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [states, setStates] = useState<Record<string, UserState>>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("today");

  const roster = useMemo<RosterEntry[]>(() => {
    if (mode === "api") {
      return serverRoster.map((u) => ({ username: u, isDefault: isDefaultUser(u) }));
    }
    return buildRoster(addedUsers);
  }, [mode, serverRoster, addedUsers]);

  // Refs so async loops / callbacks read live values without stale closures.
  const apiBaseRef = useRef(apiBase);
  apiBaseRef.current = apiBase;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const addedUsersRef = useRef(addedUsers);
  addedUsersRef.current = addedUsers;
  const adminTokenRef = useRef(adminToken);
  adminTokenRef.current = adminToken;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const runIdRef = useRef(0);

  // ── API mode: pull the whole board in one call ──
  const applyEntries = useCallback((entries: BoardEntry[]) => {
    setServerRoster(entries.map((e) => e.username));
    setStates(() => {
      const next: Record<string, UserState> = {};
      for (const e of entries) next[e.username.toLowerCase()] = entryToState(e);
      return next;
    });
  }, []);

  const syncApi = useCallback(async () => {
    setSyncing(true);
    const entries = await loadBoardViaApi();
    if (entries) {
      applyEntries(entries);
      setLastSynced(Date.now());
    }
    setSyncing(false);
  }, [applyEntries]);

  // ── Local mode: fetch a single user (used when adding) ──
  const syncUser = useCallback(async (username: string) => {
    const key = username.toLowerCase();
    const base = apiBaseRef.current;
    setStates((prev) => ({
      ...prev,
      [key]: { status: "loading", metrics: prev[key]?.metrics ?? null, solvedToday: null },
    }));
    const result = await fetchUser(username, base);
    setStates((prev) => ({
      ...prev,
      [key]: {
        status: result.status,
        metrics: result.status === "ok" ? deriveMetrics(result) : (prev[key]?.metrics ?? null),
        solvedToday: null,
      },
    }));
  }, []);

  // ── Local mode: sequential, rate-limited, progressive full sync ──
  const syncAll = useCallback(async () => {
    const runId = ++runIdRef.current;
    const list = rosterRef.current;
    const base = apiBaseRef.current;
    setSyncing(true);

    setStates((prev) => {
      const next = { ...prev };
      for (const r of list) {
        const key = r.username.toLowerCase();
        next[key] = { status: "loading", metrics: prev[key]?.metrics ?? null, solvedToday: null };
      }
      return next;
    });

    for (let i = 0; i < list.length; i++) {
      if (runId !== runIdRef.current) return; // superseded
      const r = list[i];
      const result = await fetchUser(r.username, base);
      if (runId !== runIdRef.current) return;
      const key = r.username.toLowerCase();
      setStates((prev) => ({
        ...prev,
        [key]: {
          status: result.status,
          metrics: result.status === "ok" ? deriveMetrics(result) : (prev[key]?.metrics ?? null),
          solvedToday: null,
        },
      }));
      if (i < list.length - 1) await sleep(REQUEST_GAP_MS);
    }

    setLastSynced(Date.now());
    setSyncing(false);
  }, []);

  /** Dispatch a refresh by the current mode. */
  const sync = useCallback(() => {
    if (modeRef.current === "api") void syncApi();
    else void syncAll();
  }, [syncApi, syncAll]);

  // On mount: detect whether the shared /api layer exists, else fall back.
  useEffect(() => {
    void (async () => {
      const entries = await loadBoardViaApi();
      if (entries) {
        setMode("api");
        applyEntries(entries);
        setLastSynced(Date.now());
      } else {
        setMode("local");
        void syncAll();
      }
    })();
  }, [applyEntries, syncAll]);

  // Local mode only: re-sync when the API base changes.
  useEffect(() => {
    if (modeRef.current === "local") void syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Auto-refresh every 10 minutes (both modes).
  useEffect(() => {
    const id = window.setInterval(() => sync(), AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [sync]);

  // ── Roster mutations (mode-aware) ──
  const addUser = useCallback(
    async (username: string) => {
      const name = username.trim();
      if (!name) return;
      setActionError(null);

      if (modeRef.current === "api") {
        try {
          const users = await apiAddUser(name, adminTokenRef.current);
          setAdminLocked(false);
          setServerRoster(users);
          void syncApi(); // refresh stats so the newcomer fills in
        } catch (e) {
          if (e instanceof AdminRequiredError) setAdminLocked(true);
          else setActionError(e instanceof Error ? e.message : "Couldn't add user.");
        }
        return;
      }

      // local mode
      const key = name.toLowerCase();
      const exists = buildRoster(addedUsersRef.current).some(
        (r) => r.username.toLowerCase() === key,
      );
      if (exists) return;
      setAddedUsers((prev) => {
        const next = [...prev, name];
        persistAddedUsers(next);
        return next;
      });
      void syncUser(name);
    },
    [syncApi, syncUser],
  );

  const removeUser = useCallback(
    async (username: string) => {
      setActionError(null);
      if (modeRef.current === "api") {
        try {
          const users = await apiRemoveUser(username, adminTokenRef.current);
          setAdminLocked(false);
          setServerRoster(users);
          setStates((prev) => {
            const next = { ...prev };
            delete next[username.toLowerCase()];
            return next;
          });
        } catch (e) {
          if (e instanceof AdminRequiredError) setAdminLocked(true);
          else setActionError(e instanceof Error ? e.message : "Couldn't remove user.");
        }
        return;
      }

      // local mode
      const key = username.toLowerCase();
      setAddedUsers((prev) => {
        const next = prev.filter((u) => u.toLowerCase() !== key);
        persistAddedUsers(next);
        return next;
      });
      setStates((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const changeApiBase = useCallback((base: string) => {
    const trimmed = base.trim() || DEFAULT_API_BASE;
    try {
      localStorage.setItem(LS_API_BASE, trimmed);
    } catch {
      /* ignore */
    }
    setApiBase(trimmed); // local-mode re-sync effect picks this up
  }, []);

  const changeAdminToken = useCallback((token: string) => {
    try {
      localStorage.setItem(LS_ADMIN_TOKEN, token);
    } catch {
      /* ignore */
    }
    setAdminToken(token);
    setAdminLocked(false);
    setActionError(null);
  }, []);

  // Compose roster + fetch state + cycled color into render-ready users.
  const boardUsers: BoardUser[] = useMemo(
    () =>
      roster.map((r, i) => {
        const st = states[r.username.toLowerCase()];
        return {
          username: r.username,
          color: USER_COLORS[i % USER_COLORS.length],
          isDefault: r.isDefault,
          status: st?.status ?? "loading",
          metrics: st?.metrics ?? null,
          solvedToday: st?.solvedToday ?? null,
        };
      }),
    [roster, states],
  );

  const subsToday = useMemo(
    () =>
      boardUsers.reduce(
        (sum, u) => sum + (u.status === "ok" ? (u.metrics?.today ?? 0) : 0),
        0,
      ),
    [boardUsers],
  );

  const cardsByToday = useMemo(
    () => [...boardUsers].sort((a, b) => (b.metrics?.today ?? -1) - (a.metrics?.today ?? -1)),
    [boardUsers],
  );

  const weekly = useMemo(
    () =>
      boardUsers
        .filter((u) => u.status === "ok" && u.metrics)
        .sort((a, b) => (b.metrics?.week ?? 0) - (a.metrics?.week ?? 0)),
    [boardUsers],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Header
        subsToday={subsToday}
        syncing={syncing}
        lastSynced={lastSynced}
        onSync={sync}
      />

      {/* Honest note about what the numbers mean. */}
      <p className="mt-6 rounded-xl border border-edge bg-surface/50 px-4 py-3 font-sans text-xs leading-relaxed text-muted">
        <span className="font-mono font-bold text-grind">heads up:</span> the
        daily number is <strong className="text-ink">submissions</strong> —
        LeetCode&apos;s per-day signal — so re-submits and multiple attempts
        count. <strong className="text-ink">solved</strong> is the exact
        cumulative count of unique accepted problems. Only{" "}
        <strong className="text-ink">public</strong> LeetCode profiles can be
        read.
      </p>

      {/* ── Today ── */}
      <section className="mt-10">
        <h2 className="mb-3 font-mono text-sm font-bold uppercase tracking-widest text-muted">
          Today
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cardsByToday.map((u) => (
            <Card key={u.username} user={u} onRemove={removeUser} />
          ))}
        </div>
      </section>

      {/* ── Leaderboard ── */}
      <section className="mt-10">
        <Leaderboard users={boardUsers} metric={metric} onMetricChange={setMetric} />
      </section>

      {/* ── Last 7 days ── */}
      <section className="mt-10">
        <h2 className="mb-3 font-mono text-sm font-bold uppercase tracking-widest text-muted">
          Last 7 days
        </h2>
        {weekly.length === 0 ? (
          <div className="rounded-2xl border border-edge bg-surface/60 p-6 text-center font-mono text-sm text-muted">
            no data yet — syncing…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {weekly.map((u) => (
              <div
                key={u.username}
                className="rounded-2xl border border-edge bg-surface/60 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: u.color }}
                    />
                    <span className="font-sans text-sm font-semibold text-ink">
                      {u.username}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted">
                    7d total:{" "}
                    <span className="font-bold text-ink tnum">
                      {u.metrics?.week ?? 0}
                    </span>
                  </span>
                </div>
                <Sparkline days={u.metrics?.last7 ?? []} color={u.color} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Settings ── */}
      <section className="mt-10">
        <SettingsRow
          mode={mode === "detecting" ? "local" : mode}
          apiBase={apiBase}
          onApiBaseChange={changeApiBase}
          onAddUser={addUser}
          adminToken={adminToken}
          onAdminTokenChange={changeAdminToken}
          adminLocked={adminLocked}
        />
        {actionError && (
          <p className="mt-2 px-1 font-mono text-[11px] text-danger">{actionError}</p>
        )}
        <p className="mt-2 px-1 font-mono text-[11px] text-muted">
          {mode === "api" ? (
            <>
              <span className="text-grind">shared board</span> · server-cached ·
              roster lives on the server
            </>
          ) : (
            <>
              <span className="text-gold">local mode</span> · reading from{" "}
              <span className="text-ink">{apiBase}</span> · roster saved in this
              browser
            </>
          )}
        </p>
      </section>

      <footer className="mt-12 border-t border-edge pt-6 text-center font-mono text-[11px] text-muted">
        THE GRIND BOARD · data via{" "}
        <a
          href="https://github.com/alfaarghya/alfa-leetcode-api"
          target="_blank"
          rel="noreferrer"
          className="text-muted underline hover:text-grind"
        >
          alfa-leetcode-api
        </a>{" "}
        · keep grinding
      </footer>
    </div>
  );
}
