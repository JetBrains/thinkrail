import type { ReactNode } from "react";
import type { ChoiceBeat } from "./content";
import { DEMO_PROJECT, DEMO_WORKSPACE } from "./content";

/** The right-hand reveal for a choice beat. Task 9 mounts the LifecycleLoop inside the hooks panel. */
export function BeatReveal({ beat, children }: { beat: ChoiceBeat; children?: ReactNode }) {
	if (beat.reveal === "tree")
		return (
			<div
				className="whitespace-pre rounded-[var(--radius-md)] border border-border2 bg-elevated p-md font-[var(--font-mono)] text-muted text-sm leading-7"
				data-testid="game-tree"
			>
				{"~/\n├─ projects/\n│   └─ "}
				<span className="text-text">{DEMO_PROJECT}/</span>
				<span className="ml-sm rounded-full bg-green/15 px-sm font-[var(--font)] text-green text-xs">
					your project — untouched
				</span>
				{"\n└─ .thinkrail/\n    └─ worktrees/\n        └─ "}
				<span className="rounded-[var(--radius-sm)] bg-primary/20 px-xs text-text">
					{DEMO_PROJECT}/{DEMO_WORKSPACE}/
				</span>
				<span className="ml-sm rounded-full bg-primary/20 px-sm font-[var(--font)] text-primary text-xs">
					◀ your new workspace
				</span>
			</div>
		);
	if (beat.reveal === "hooks")
		return (
			<div data-testid="game-hooks">
				<p className="rounded-[var(--radius-sm)] bg-bg-dark p-sm font-[var(--font-mono)] text-red text-sm">
					Error: Cannot find module — node_modules/ and .env never travel
				</p>
				<div className="mt-sm rounded-[var(--radius-md)] border border-primary/40 p-md text-sm text-text">
					That's why ThinkRail has <span className="font-semibold text-primary">setup hooks</span> —
					declare <span className="font-[var(--font-mono)]">npm install</span> + copy{" "}
					<span className="font-[var(--font-mono)]">.env</span> once; they run on every new
					workspace.
				</div>
				{children}
			</div>
		);
	if (beat.reveal === "history")
		return (
			<p
				className="rounded-[var(--radius-md)] border border-border2 bg-elevated p-md text-sm text-text"
				data-testid="game-history"
			>
				Yes — one shared <span className="font-[var(--font-mono)]">.git</span>: branches and commits
				are visible everywhere; only working files are separate.
			</p>
		);
	return (
		<p
			className="rounded-[var(--radius-md)] border border-border2 bg-elevated p-md text-sm text-text"
			data-testid="game-payoff"
		>
			Another workspace: your mess stays exactly as-is, the fix ships in parallel, and the workspace
			is deleted after merge.
		</p>
	);
}
