import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "./Header";
import Card from "./Card";
import Leaderboard from "./Leaderboard";
import Sparkline from "./Sparkline";
import SettingsRow from "./SettingsRow";
import { AUTO_SYNC_MS, USER_COLORS } from "../config";
import { deriveMetrics } from "../lib/leetcode";
import type { FetchResult, FetchStatus, UserMetrics } from "../lib/leetcode";
import { apiAddUser, apiRemoveUser, loadBoard, type BoardEntry } from "../lib/api";
import { boardUrl, navigate, rememberBoard } from "../lib/boards";
import type { BoardUser, Metric } from "../types";

interface UserState {
  status: FetchStatus | "loading";
  metrics: UserMetrics | null;
  solvedToday: number | null;
}

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

export default function BoardView({ boardId }: { boardId: string }) {
  const [boardName, setBoardName] = useState<string>(boardId);
  const [serverRoster, setServerRoster] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, UserState>>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("today");
  const [actionError, setActionError] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "ok" | "not_found" | "unreachable">(
    "loading",
  );
  const [copied, setCopied] = useState(false);

  const applyEntries = useCallback((entries: BoardEntry[]) => {
    setServerRoster(entries.map((e) => e.username));
    setStates(() => {
      const next: Record<string, UserState> = {};
      for (const e of entries) next[e.username.toLowerCase()] = entryToState(e);
      return next;
    });
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    const result = await loadBoard(boardId);
    if (result.ok) {
      setBoardName(result.board.name);
      rememberBoard(result.board);
      applyEntries(result.users);
      setLastSynced(Date.now());
      setLoad("ok");
    } else {
      // Don't blow away a board we've already loaded on a transient blip.
      setLoad((prev) => (prev === "ok" && result.reason === "unreachable" ? "ok" : result.reason));
    }
    setSyncing(false);
  }, [boardId, applyEntries]);

  // Load on mount + whenever the board id changes.
  useEffect(() => {
    setLoad("loading");
    setServerRoster([]);
    setStates({});
    void sync();
  }, [sync]);

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
        const users = await apiAddUser(boardId, name);
        setServerRoster(users);
        void sync();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Couldn't add user.");
      }
    },
    [boardId, sync],
  );

  const removeUser = useCallback(
    async (username: string) => {
      setActionError(null);
      try {
        const users = await apiRemoveUser(boardId, username);
        setServerRoster(users);
        setStates((prev) => {
          const next = { ...prev };
          delete next[username.toLowerCase()];
          return next;
        });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Couldn't remove user.");
      }
    },
    [boardId],
  );

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(boardUrl(boardId)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [boardId]);

  const boardUsers: BoardUser[] = useMemo(
    () =>
      serverRoster.map((username, i) => {
        const st = states[username.toLowerCase()];
        return {
          username,
          color: USER_COLORS[i % USER_COLORS.length],
          status: st?.status ?? "loading",
          metrics: st?.metrics ?? null,
          solvedToday: st?.solvedToday ?? null,
        };
      }),
    [serverRoster, states],
  );

  const todayTotal = useMemo(
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

  // Bad/expired code → dead end with a way home.
  if (load === "not_found") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
        <h1 className="font-mono text-2xl font-extrabold">board not found</h1>
        <p className="mt-2 font-sans text-sm text-muted">
          No board with code <span className="font-mono text-ink">{boardId}</span>.
          The link may be mistyped.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mx-auto mt-5 rounded-lg border border-grind bg-grind/15 px-4 py-2 font-mono text-sm font-bold text-grind transition hover:bg-grind/25"
        >
          ← back to start
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Header
        boardName={boardName}
        todayTotal={todayTotal}
        syncing={syncing}
        lastSynced={lastSynced}
        onSync={() => void sync()}
      />

      {/* Share bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface/50 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
          board code
        </span>
        <span className="font-mono text-sm font-bold text-ink">{boardId}</span>
        <button
          type="button"
          onClick={copyLink}
          className="ml-auto rounded-lg border border-edge2 bg-surface px-3 py-1.5 font-mono text-xs font-bold text-ink transition hover:border-grind hover:text-grind"
        >
          {copied ? "copied ✓" : "copy share link"}
        </button>
      </div>

      {/* Honest note about what the numbers mean. */}
      <p className="mt-4 rounded-xl border border-edge bg-surface/50 px-4 py-3 font-sans text-xs leading-relaxed text-muted">
        <span className="font-mono font-bold text-grind">heads up:</span> the
        daily number is <strong className="text-ink">distinct problems solved</strong>{" "}
        that day (re-solving the same one counts once) — that&apos;s the
        &ldquo;did you do a problem today&rdquo; signal, not raw submissions.{" "}
        <strong className="text-ink">total</strong> is cumulative unique solved.
        Built from your last ~20 accepted problems, so very long streaks may be
        capped. Only <strong className="text-ink">public</strong> profiles work.
      </p>

      {load === "unreachable" && (
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
            <p className="font-mono text-sm text-ink">
              {load === "loading" ? "loading…" : "nobody on the board yet"}
            </p>
            {load !== "loading" && (
              <p className="mt-1 font-sans text-xs text-muted">
                add a LeetCode username below, then share the code with your group.
              </p>
            )}
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
              <div key={u.username} className="rounded-2xl border border-edge bg-surface/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: u.color }} />
                    <span className="font-sans text-sm font-semibold text-ink">{u.username}</span>
                  </div>
                  <span className="font-mono text-xs text-muted">
                    7d total:{" "}
                    <span className="font-bold text-ink tnum">{u.metrics?.week ?? 0}</span>
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
          <span className="text-grind">shared board</span> · anyone with the code
          can view &amp; edit · server-cached
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
