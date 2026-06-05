import { useMemo, useState } from "react";
import { weekdayInitial } from "../lib/leetcode";
import type { BoardUser } from "../types";

/**
 * Multi-line chart comparing problems-solved-per-day across the board's users
 * over the last 7 UTC days. Dependency-free SVG. A toggle switches between the
 * daily count and the running cumulative total (which fans the lines apart so
 * it's obvious who's pulling ahead).
 */
type Mode = "daily" | "cumulative";

// SVG coordinate space (scaled responsively via viewBox).
const W = 660;
const H = 240;
const PAD = { l: 30, r: 14, t: 14, b: 26 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

export default function TrendChart({ users }: { users: BoardUser[] }) {
  const [mode, setMode] = useState<Mode>("daily");

  const series = useMemo(
    () => users.filter((u) => u.metrics && u.metrics.last7.length > 0),
    [users],
  );

  const chart = useMemo(() => {
    if (series.length === 0) return null;
    const days = series[0].metrics!.last7.map((b) => b.day);
    const n = days.length;

    const values = series.map((u) => {
      const daily = u.metrics!.last7.map((b) => b.count);
      if (mode === "daily") return daily;
      let run = 0;
      return daily.map((c) => (run += c));
    });

    const max = Math.max(1, ...values.flat());
    const x = (i: number) => PAD.l + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
    const y = (v: number) => PAD.t + PLOT_H - (v / max) * PLOT_H;

    // A few rounded y gridlines (0 → max).
    const ticks = max <= 5 ? max : 4;
    const tickVals = Array.from({ length: ticks + 1 }, (_, i) => Math.round((i / ticks) * max));

    return { days, n, values, max, x, y, tickVals: [...new Set(tickVals)] };
  }, [series, mode]);

  if (!chart) return null;
  const { days, values, x, y, tickVals } = chart;

  return (
    <div className="rounded-2xl border border-edge bg-surface/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-muted">
          Solved per day
        </span>
        <div className="flex gap-1 rounded-xl border border-edge bg-surface p-1">
          {(["daily", "cumulative"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                mode === m ? "bg-grind/15 text-grind" : "text-muted hover:text-ink"
              }`}
            >
              {m === "daily" ? "per day" : "cumulative"}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Solved per day chart">
        {/* horizontal gridlines + y labels */}
        {tickVals.map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="#3a3a3a" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted" fontSize={10} fontFamily="JetBrains Mono, monospace">
              {v}
            </text>
          </g>
        ))}

        {/* x-axis weekday labels */}
        {days.map((day, i) => (
          <text
            key={day}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted"
            fontSize={10}
            fontFamily="JetBrains Mono, monospace"
          >
            {weekdayInitial(day)}
          </text>
        ))}

        {/* one line + points per user */}
        {series.map((u, si) => {
          const pts = values[si].map((v, i) => `${x(i)},${y(v)}`).join(" ");
          return (
            <g key={u.username}>
              <polyline
                points={pts}
                fill="none"
                stroke={u.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {values[si].map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={u.color}>
                  <title>{`${u.username} · ${days[i]}: ${v}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((u) => (
          <span key={u.username} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: u.color }} />
            {u.name ?? u.username}
          </span>
        ))}
      </div>
    </div>
  );
}
