import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import Card from "./components/Card";
import Leaderboard from "./components/Leaderboard";
import Sparkline from "./components/Sparkline";
import SettingsRow from "./components/SettingsRow";
import { AUTO_SYNC_MS, USER_COLORS, isDefaultUser } from "./config";
import { deriveMetrics } from "./lib/leetcode";
import type { FetchResult, FetchStatus, UserMetrics } from "./lib/leetcode";
import { apiAddUser, apiRemoveUser, loadBoardViaApi, type BoardEntry } from "./lib/api";
import type { BoardUser, Metric } from "./types";

/** Per-user fetch state, keyed by lowercased username in `states`. */
interface UserState {
  status: FetchStatus | "loading";
  metrics: UserMetrics | null;
  /** True per-day solved delta (from cron snapshots only). */
  solvedToday: number | null;
}

interface RosterEntry {
  username: string;
  isDefault: boolean;
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
  const [serverRoster, setServerRoster] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState(false);

  const [states, setStates] = useState<Record<string, UserState>>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("today");

  const roster = useMemo<RosterEntry[]>(
    () => serverRoster.map((u) => ({ username: u, isDefault: isDefaultUser(u) })),
    [serverRoster],
  );

  const applyEntries = useCallback((entries: BoardEntry[]) => {
    setServerRoster(entries.map((e) => e.username));
    setStates(() => {
      const next: Record<string, UserState> = {};
      for (const e of entries) next[e.username.toLowerCase()] = entryToState(e);
      return next;
    });
  }, []);

  // Pull the whole shared board in one call.
  const sync = useCallback(async () => {
    setSyncing(true);
    const entries = await loadBoardViaApi();
    if (entries) {
      applyEntries(entries);
      setLastSynced(Date.now());
      setBoardError(false);
    } else {
      setBoardError(true);
    }
    setSyncing(false);
  }, [applyEntries]);

  // On mount: load the board once.
  useEffect(() => {
    void sync();
  }, [sync]);

  // Auto-refresh every 10 minutes.
  useEffect(() => {
    const id = window.setInterval(() => void sync(), AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [sync]);

  const addUser = useCallback(
    async (username: string) => {
      const name = username.trim();
      if (!name) return;
      setActionError(null);
      try {
        const users = await apiAddUser(name);
        setServerRoster(users);
        void sync(); // refresh stats so the newcomer fills in
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Couldn't add user.");
      }
    },
    [sync],
  );

  const removeUser = useCallback(async (username: string) => {
    setActionError(null);
    try {
      const users = await apiRemoveUser(username);
      setServerRoster(users);
      setStates((prev) => {
        const next = { ...prev };
        delete next[username.toLowerCase()];
        return next;
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't remove user.");
    }
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
        onSync={() => void sync()}
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

      {boardError && (
        <p className="mt-4 rounded-xl border border-danger/50 bg-surface/50 px-4 py-3 font-mono text-xs text-danger">
          couldn&apos;t reach the board — retrying on the next sync.
        </p>
      )}

      {/* ── Today ── */}
      <section className="mt-10">
        <h2 className="mb-3 font-mono text-sm font-bold uppercase tracking-widest text-muted">
          Today
        </h2>
        {boardUsers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge2 bg-surface/40 p-8 text-center">
            <p className="font-mono text-sm text-ink">nobody on the board yet</p>
            <p className="mt-1 font-sans text-xs text-muted">
              add a LeetCode username below to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cardsByToday.map((u) => (
              <Card key={u.username} user={u} onRemove={removeUser} />
            ))}
          </div>
        )}
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
            {boardUsers.length === 0 ? "nothing to show yet" : "no data yet — syncing…"}
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
        <SettingsRow onAddUser={addUser} />
        {actionError && (
          <p className="mt-2 px-1 font-mono text-[11px] text-danger">{actionError}</p>
        )}
        <p className="mt-2 px-1 font-mono text-[11px] text-muted">
          <span className="text-grind">shared board</span> · server-cached ·
          roster lives on the server
        </p>
      </section>

      <footer className="mt-12 border-t border-edge pt-6 text-center font-mono text-[11px] text-muted">
        LEETERBOARD · data via{" "}
        <a
          href="https://github.com/alfaarghya/alfa-leetcode-api"
          target="_blank"
          rel="noreferrer"
          className="text-muted underline hover:text-grind"
        >
          alfa-leetcode-api
        </a>
      </footer>
    </div>
  );
}
