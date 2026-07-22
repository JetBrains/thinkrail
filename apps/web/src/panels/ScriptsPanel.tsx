import { Pencil, Play, Plus } from "lucide-react";
import { useState } from "react";

interface Script {
	id: string;
	name: string;
	command: string;
}

// MOCK scripts (display-only; not persisted or executed — see task-contextual-rail).
const MOCK_SCRIPTS: Script[] = [
	{ id: "dev", name: "Dev server", command: "npm run dev" },
	{ id: "test", name: "Test", command: "npm test" },
	{ id: "build", name: "Build", command: "npm run build" },
];

/**
 * Project-level **run scripts** (project rail → "Scripts"): manual shortcuts a worktree can trigger.
 * MOCK/display-only — the list is local state; adding/editing/running are host concerns (a follow-up;
 * see task-contextual-rail). Reuses existing button/icon/token styles.
 */
export function ScriptsPanel() {
	const [scripts, setScripts] = useState<Script[]>(MOCK_SCRIPTS);
	const addScript = () =>
		setScripts((prev) => [...prev, { id: crypto.randomUUID(), name: "New script", command: "" }]);

	return (
		<div data-testid="scripts-panel" className="flex flex-col gap-sm p-sm">
			<div className="flex items-center justify-between gap-sm">
				<p className="text-hint text-xs">Manual shortcuts you trigger from a worktree.</p>
				<button
					type="button"
					data-testid="script-add"
					onClick={addScript}
					className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-0.5 text-muted text-xs hover:bg-hover hover:text-text"
				>
					<Plus className="size-3.5" />
					Add
				</button>
			</div>
			{scripts.length === 0 ? (
				<p data-testid="scripts-empty" className="text-hint text-xs">
					No scripts yet. Add one to get started.
				</p>
			) : (
				<ul className="flex flex-col gap-px">
					{scripts.map((script) => (
						<li
							key={script.id}
							data-testid="script-item"
							className="group flex items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-sm hover:bg-hover"
						>
							<Play className="size-3.5 shrink-0 text-primary" />
							<span className="shrink-0 truncate text-text">{script.name}</span>
							<span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-hint text-xs">
								{script.command}
							</span>
							<button
								type="button"
								data-testid="script-edit"
								aria-label={`Edit ${script.name}`}
								className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 transition hover:text-text group-hover:opacity-100"
							>
								<Pencil className="size-3.5" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
