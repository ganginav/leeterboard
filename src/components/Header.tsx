interface HeaderProps {
  subsToday: number;
  syncing: boolean;
  lastSynced: number | null;
  onSync: () => void;
}

/** Top bar: wordmark, "subs today" stat, and the manual sync button. */
export default function Header({
  subsToday,
  syncing,
  lastSynced,
  onSync,
}: HeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-mono text-3xl font-extrabold tracking-tight sm:text-4xl">
          <span className="text-grind">LEET</span>ERBOARD
        </h1>
        <p className="mt-1 font-sans text-sm text-muted">
          See who&apos;s actually doing their LeetCode.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-3xl font-extrabold leading-none tnum text-grind">
            {subsToday}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted">
            subs today
          </div>
        </div>

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          title={
            lastSynced
              ? `Last synced ${new Date(lastSynced).toLocaleTimeString()}`
              : "Not synced yet"
          }
          className="rounded-xl border border-edge2 bg-surface px-4 py-2 font-mono text-sm font-bold uppercase tracking-wider text-ink transition hover:border-grind hover:text-grind disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-edge2 disabled:hover:text-ink"
        >
          {syncing ? "syncing…" : "sync now"}
        </button>
      </div>
    </header>
  );
}
