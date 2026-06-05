import type { BoardUser } from "../types";

interface CardProps {
  user: BoardUser;
  onRemove?: (username: string) => void;
}

/** Hex color → translucent rgba for tinted borders/backgrounds. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** One user's "Today" card: dot, name, streak, today's big number, meta line. */
export default function Card({ user, onRemove }: CardProps) {
  const { username, color, status, metrics } = user;

  return (
    <div
      className="animate-pop relative rounded-2xl border bg-surface/80 p-4 backdrop-blur"
      style={{ borderColor: tint(color, 0.45) }}
    >
      {/* Remove control */}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(username)}
          aria-label={`Remove ${username}`}
          className="absolute right-2 top-2 h-6 w-6 rounded-md font-mono text-sm text-muted transition hover:bg-edge hover:text-danger"
        >
          ×
        </button>
      )}

      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0">
          <div className="truncate font-sans text-sm font-semibold text-ink">
            {username}
          </div>
          <div className="truncate font-mono text-xs text-muted">
            @{username}
          </div>
        </div>
        {metrics && metrics.streak > 0 && (
          <span
            className="ml-auto mr-1 shrink-0 font-mono text-sm font-bold"
            style={{ color: "#f0a500" }}
            title={`${metrics.streak}-day streak`}
          >
            🔥{metrics.streak}
          </span>
        )}
      </div>

      <div className="mt-4">
        <CardBody user={user} />
      </div>

      {status === "ok" && metrics && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
          <span title="distinct problems solved in the last 7 days">
            7d: <span className="text-ink tnum">{metrics.week}</span>
          </span>
          <span className="text-edge2">·</span>
          <span title="cumulative unique problems solved (all time)">
            total: <span className="text-ink tnum">{metrics.total}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** The big-number / status region of a card. */
function CardBody({ user }: { user: BoardUser }) {
  const { status, metrics, color } = user;

  if (status === "loading") {
    return <div className="font-mono text-sm text-muted">syncing…</div>;
  }
  if (status === "not_found") {
    return (
      <div className="font-mono text-sm text-danger">
        not found — public profile?
      </div>
    );
  }
  if (status === "unreachable") {
    return (
      <div className="font-mono text-sm text-danger">couldn&apos;t reach API</div>
    );
  }

  // status === "ok"
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="font-mono text-5xl font-extrabold leading-none tnum"
        style={{ color }}
      >
        {metrics?.today ?? 0}
      </span>
      <span className="font-mono text-xs uppercase tracking-widest text-muted">
        solved today
      </span>
    </div>
  );
}
