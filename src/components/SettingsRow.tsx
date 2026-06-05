import { useState } from "react";

interface SettingsRowProps {
  onAddUser: (username: string) => void;
}

/** Bottom settings row: add a grinder to the shared roster. */
export default function SettingsRow({ onAddUser }: SettingsRowProps) {
  const [newUser, setNewUser] = useState("");

  const submitUser = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUser.trim();
    if (!trimmed) return;
    onAddUser(trimmed);
    setNewUser("");
  };

  return (
    <div className="rounded-2xl border border-edge bg-surface/60 p-4">
      {/* Add user to the shared roster */}
      <form onSubmit={submitUser} className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted">
          add a grinder <span className="text-grind">· shared</span>
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
    </div>
  );
}
