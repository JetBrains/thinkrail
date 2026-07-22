import { useState } from "react";

/**
 * Project-level **worktree lifecycle hooks** (project rail → "Hooks"). Commands that run automatically on
 * a worktree's create/archive. MOCK/display-only: the values are local state, not persisted, and nothing
 * is executed — saving + running are host/domain concerns (a follow-up; see task-contextual-rail). Reuses
 * the existing input/token styles; no new tokens.
 */
export function HooksPanel() {
	// MOCK values (local, not saved).
	const [onCreate, setOnCreate] = useState("npm install");
	const [onArchive, setOnArchive] = useState("");
	return (
		<div data-testid="hooks-panel" className="flex flex-col gap-md p-sm">
			<p className="text-hint text-xs">
				These run automatically on a worktree's lifecycle and apply to worktrees created from now
				on.
			</p>
			<HookField
				testid="hook-on-create"
				label="On create"
				description="Runs once when a new worktree is created."
				value={onCreate}
				onChange={setOnCreate}
			/>
			<HookField
				testid="hook-on-archive"
				label="On archive"
				description="Runs before a worktree is archived."
				value={onArchive}
				onChange={setOnArchive}
			/>
			<p className="text-hint text-xs">
				Merge hooks (pre / post) — available with the PR flow later.
			</p>
		</div>
	);
}

function HookField({
	testid,
	label,
	description,
	value,
	onChange,
}: {
	testid: string;
	label: string;
	description: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-xs">
			<span className="font-medium text-text text-xs">{label}</span>
			<span className="text-hint text-xs">{description}</span>
			<input
				data-testid={testid}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="e.g. npm install"
				spellCheck={false}
				className="rounded-[var(--radius-sm)] border border-border2 bg-[var(--input-bg)] px-sm py-xs font-[var(--font-mono)] text-sm text-text outline-none transition-colors placeholder:text-hint focus:border-primary"
			/>
		</div>
	);
}
