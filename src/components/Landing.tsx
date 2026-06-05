import { useState } from "react";
import { createBoard } from "../lib/api";
import {
  boardIdFromPath,
  boardPath,
  getRecentBoards,
  navigate,
  rememberBoard,
} from "../lib/boards";

/** Parse a pasted code or full board link into a board id, or null. */
function parseJoin(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const fromUrl = boardIdFromPath(new URL(s).pathname);
    if (fromUrl) return fromUrl;
  } catch {
    /* not a URL — try as a raw code */
  }
  const up = s.toUpperCase();
  return /^[0-9A-Z]{4,16}$/.test(up) ? up : null;
}

/** Landing screen: create a board, join one by code/link, or reopen a recent one. */
export default function Landing() {
  const [name, setName] = useState("");
  const [join, setJoin] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = getRecentBoards();

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const board = await createBoard(name.trim() || undefined);
      rememberBoard(board);
      navigate(boardPath(board.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the board.");
      setCreating(false);
    }
  };

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseJoin(join);
    if (!id) {
      setError("That doesn't look like a valid board code or link.");
      return;
    }
    navigate(boardPath(id));
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <h1 className="font-mono text-4xl font-extrabold tracking-tight sm:text-5xl">
        <span className="text-grind">LEET</span>ERBOARD
      </h1>
      <p className="mt-2 font-sans text-sm text-muted">
        A shared LeetCode board for your friend group. Make one, share the link,
        and keep each other honest. No login — the link is the key.
      </p>

      {/* Create */}
      <form
        onSubmit={onCreate}
        className="mt-8 rounded-2xl border border-edge bg-surface/60 p-4"
      >
        <label className="font-mono text-[11px] uppercase tracking-widest text-muted">
          new board
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="board name (optional)"
            maxLength={40}
            className="min-w-0 flex-1 rounded-lg border border-edge2 bg-[#010409] px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus:border-grind focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating}
            className="shrink-0 rounded-lg border border-grind bg-grind/15 px-4 py-2 font-mono text-sm font-bold text-grind transition hover:bg-grind/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "creating…" : "create board"}
          </button>
        </div>
      </form>

      {/* Join */}
      <form onSubmit={onJoin} className="mt-3 rounded-2xl border border-edge bg-surface/60 p-4">
        <label className="font-mono text-[11px] uppercase tracking-widest text-muted">
          join with a code or link
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={join}
            onChange={(e) => setJoin(e.target.value)}
            placeholder="e.g. K7P2QXM"
            spellCheck={false}
            autoCapitalize="characters"
            className="min-w-0 flex-1 rounded-lg border border-edge2 bg-[#010409] px-3 py-2 font-mono text-sm text-ink placeholder:text-muted focus:border-grind focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-edge2 bg-surface px-4 py-2 font-mono text-sm font-bold text-ink transition hover:border-grind hover:text-grind"
          >
            open
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-2 px-1 font-mono text-[11px] text-danger">{error}</p>
      )}

      {recent.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
            recent
          </div>
          <ul className="space-y-2">
            {recent.map((b) => (
              <li key={b.id}>
                <a
                  href={boardPath(b.id)}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(boardPath(b.id));
                  }}
                  className="flex items-center justify-between rounded-xl border border-edge bg-surface/60 px-3 py-2 transition hover:border-grind"
                >
                  <span className="truncate font-sans text-sm text-ink">{b.name}</span>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted">{b.id}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-12 text-center font-mono text-[11px] text-muted">
        LEETERBOARD · data via{" "}
        <a
          href="https://github.com/alfaarghya/alfa-leetcode-api"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-grind"
        >
          alfa-leetcode-api
        </a>
      </footer>
    </div>
  );
}
