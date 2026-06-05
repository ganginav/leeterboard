import type { BoardUser, Metric } from "../types";

interface LeaderboardProps {
  users: BoardUser[];
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}

const TABS: { key: Metric; label: string }[] = [
  { key: "today", label: "today" },
  { key: "week", label: "7 days" },
  { key: "total", label: "total solved" },
];

function valueFor(user: BoardUser, metric: Metric): number {
  if (!user.metrics) return 0;
  if (metric === "today") return user.metrics.today;
  if (metric === "week") return user.metrics.week;
  return user.metrics.total;
}

/** Ranked board with a horizontal bar per user; tabs switch the metric. */
export default function Leaderboard({
  users,
  metric,
  onMetricChange,
}: LeaderboardProps) {
  // Only rank users we actually have data for; sort desc and re-rank live.
  const ranked = users
    .filter((u) => u.status === "ok" && u.metrics)
    .map((u) => ({ user: u, value: valueFor(u, metric) }))
    .sort((a, b) => b.value - a.value);

  const max = Math.max(1, ...ranked.map((r) => r.value));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">
          Leaderboard
        </h2>
        <div className="flex gap-1 rounded-xl border border-edge bg-surface p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onMetricChange(t.key)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                metric === t.key
                  ? "bg-grind/15 text-grind"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface/60 p-6 text-center font-mono text-sm text-muted">
          {users.length === 0 ? "nothing to rank yet" : "no data yet — syncing…"}
        </div>
      ) : (
        <ol className="space-y-2">
          {ranked.map((row, i) => {
            const isFirst = i === 0 && row.value > 0;
            const widthPct = (row.value / max) * 100;
            return (
              <li
                key={row.user.username}
                className="flex items-center gap-3 rounded-xl border border-edge bg-surface/60 px-3 py-2"
              >
                <span className="w-7 shrink-0 text-center font-mono text-sm font-bold">
                  {isFirst ? "👑" : <span className="text-muted">{i + 1}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">
                      {row.user.name ?? row.user.username}
                    </span>
                    <span
                      className="shrink-0 text-sm font-bold tnum"
                      style={{ color: isFirst ? "#ffa116" : row.user.color }}
                    >
                      {row.value}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-edge">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: isFirst ? "#ffa116" : row.user.color,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
