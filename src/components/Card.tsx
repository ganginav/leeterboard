import type { BoardUser } from "../types";

interface CardProps {
  user: BoardUser;
  onRemove?: (username: string) => void;
}

/** One user's "Today" card: dot, name, streak, today's big number, meta line. */
export default function Card({ user, onRemove }: CardProps) {
  const { username, name, color, status, metrics } = user;
  const realName = name && name.toLowerCase() !== username.toLowerCase() ? name : null;

  return (
    <div className="animate-pop relative rounded-xl border border-edge bg-surface p-4">
      {/* Remove control */}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(username)}
          aria-label={`Remove ${username}`}
          className="absolute right-2 top-2 h-6 w-6 rounded-md text-sm text-muted transition hover:bg-edge hover:text-danger"
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
          {/* Always two lines for consistent card height — fall back to the
              handle as the "name" when no real name is set. */}
          <div className="truncate text-sm font-semibold text-ink">
            {realName ?? username}
          </div>
          <div className="truncate text-xs text-muted">@{username}</div>
        </div>
        {metrics && metrics.streak > 0 && (
          <span
            className="ml-auto mr-1 shrink-0 text-sm font-bold text-gold"
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
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
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
  const { status, metrics } = user;

  if (status === "loading") {
    return <div className="text-sm text-muted">syncing…</div>;
  }
  if (status === "not_found") {
    return <div className="text-sm text-danger">not found — public profile?</div>;
  }
  if (status === "unreachable") {
    return <div className="text-sm text-danger">couldn&apos;t reach API</div>;
  }

  // status === "ok" — green like LeetCode's "Accepted".
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-5xl font-bold leading-none tnum text-grind">
        {metrics?.today ?? 0}
      </span>
      <span className="text-xs text-muted">solved today</span>
    </div>
  );
}
