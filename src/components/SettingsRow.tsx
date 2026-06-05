import { useState } from "react";
import { DEFAULT_API_BASE } from "../config";
import type { BoardMode } from "../types";

interface SettingsRowProps {
  mode: BoardMode;
  /** local mode only — runtime alfa API base override. */
  apiBase: string;
  onApiBaseChange: (base: string) => void;
  onAddUser: (username: string) => void;
  /** api mode only — admin token for roster writes. */
  adminToken: string;
  onAdminTokenChange: (token: string) => void;
  /** api mode only — true once a write was rejected with 401. */
  adminLocked: boolean;
}

/**
 * Bottom settings row. The second control is mode-aware:
 *  - api mode  → admin token field (roster writes are server-side & shared)
 *  - local mode → API base override (point at a self-hosted alfa, no rebuild)
 */
export default function SettingsRow({
  mode,
  apiBase,
  onApiBaseChange,
  onAddUser,
  adminToken,
  onAdminTokenChange,
  adminLocked,
}: SettingsRowProps) {
  const [newUser, setNewUser] = useState("");
  const [baseDraft, setBaseDraft] = useState(apiBase);
  const [tokenDraft, setTokenDraft] = useState(adminToken);

  const submitUser = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUser.trim();
    if (!trimmed) return;
    onAddUser(trimmed);
    setNewUser("");
  };

  const submitBase = (e: React.FormEvent) => {
    e.preventDefault();
    onApiBaseChange(baseDraft.trim() || DEFAULT_API_BASE);
  };

  const submitToken = (e: React.FormEvent) => {
    e.preventDefault();
    onAdminTokenChange(tokenDraft.trim());
  };

  return (
    <div className="grid gap-4 rounded-2xl border border-edge bg-surface/60 p-4 sm:grid-cols-2">
      {/* Add user (shared in api mode, per-browser in local mode) */}
      <form onSubmit={submitUser} className="flex flex-col gap-1.5">
        <label className="font-mono text-[11px] uppercase tracking-widest text-muted">
          add a grinder {mode === "api" && <span className="text-grind">· shared</span>}
        </label>
        <div className="flex gap-2">
          <input
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            placeholder="leetcode username"
            spellCheck={false}
            autoCapitalize="none"
            className="min-w-0 flex-1 rounded-lg border border-edge2 bg-[#010409] px-3 py-2 font-mono text-sm text-ink placeholder:text-muted focus:border-grind focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-edge2 bg-surface px-3 py-2 font-mono text-sm font-bold text-grind transition hover:border-grind"
          >
            add
          </button>
        </div>
      </form>

      {mode === "api" ? (
        /* Admin token (only needed if the deploy set ADMIN_TOKEN) */
        <form onSubmit={submitToken} className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] uppercase tracking-widest text-muted">
            admin token{" "}
            {adminLocked && (
              <span className="text-danger">· edits locked — enter token</span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="only if this deploy is locked"
              spellCheck={false}
              autoCapitalize="none"
              className={`min-w-0 flex-1 rounded-lg border bg-[#010409] px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:outline-none ${
                adminLocked ? "border-danger focus:border-danger" : "border-edge2 focus:border-grind"
              }`}
            />
            <button
              type="submit"
              disabled={tokenDraft.trim() === adminToken}
              className="rounded-lg border border-edge2 bg-surface px-3 py-2 font-mono text-sm font-bold text-ink transition hover:border-grind hover:text-grind disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-edge2 disabled:hover:text-ink"
            >
              save
            </button>
          </div>
        </form>
      ) : (
        /* API base override (self-host without rebuilding) */
        <form onSubmit={submitBase} className="flex flex-col gap-1.5">
          <label className="font-mono text-[11px] uppercase tracking-widest text-muted">
            api base (self-host override)
          </label>
          <div className="flex gap-2">
            <input
              value={baseDraft}
              onChange={(e) => setBaseDraft(e.target.value)}
              placeholder={DEFAULT_API_BASE}
              spellCheck={false}
              autoCapitalize="none"
              className="min-w-0 flex-1 rounded-lg border border-edge2 bg-[#010409] px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:border-grind focus:outline-none"
            />
            <button
              type="submit"
              disabled={baseDraft.trim() === apiBase}
              className="rounded-lg border border-edge2 bg-surface px-3 py-2 font-mono text-sm font-bold text-ink transition hover:border-grind hover:text-grind disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-edge2 disabled:hover:text-ink"
            >
              set
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
