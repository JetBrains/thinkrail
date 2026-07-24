import type { ReactNode } from "react";
import type { ChoiceBeat } from "./content";
import { DEMO_PROJECT, DEMO_WORKSPACE, REVEAL_COPY } from "./content";

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
					{REVEAL_COPY.tree.projectAnnotation}
				</span>
				{"\n└─ .thinkrail/\n    └─ worktrees/\n        └─ "}
				<span className="rounded-[var(--radius-sm)] bg-primary/20 px-xs text-text">
					{DEMO_PROJECT}/{DEMO_WORKSPACE}/
				</span>
				<span className="ml-sm rounded-full bg-primary/20 px-sm font-[var(--font)] text-primary text-xs">
					{REVEAL_COPY.tree.workspaceAnnotation}
				</span>
			</div>
		);
	if (beat.reveal === "hooks")
		return (
			<div data-testid="game-hooks">
				<p className="rounded-[var(--radius-sm)] bg-bg-dark p-sm font-[var(--font-mono)] text-red text-sm">
					{REVEAL_COPY.hooks.errorLine}
				</p>
				<div className="mt-sm rounded-[var(--radius-md)] border border-primary/40 p-md text-sm text-text">
					{REVEAL_COPY.hooks.leadIn}
					<span className="font-semibold text-primary">{REVEAL_COPY.hooks.setupHooksLabel}</span>
					{REVEAL_COPY.hooks.afterLabel}
					<span className="font-[var(--font-mono)]">{REVEAL_COPY.hooks.npmInstall}</span>
					{REVEAL_COPY.hooks.copyGlue}
					<span className="font-[var(--font-mono)]">{REVEAL_COPY.hooks.envFile}</span>
					{REVEAL_COPY.hooks.tail}
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
				{REVEAL_COPY.history.lead}
				<span className="font-[var(--font-mono)]">{REVEAL_COPY.history.gitLabel}</span>
				{REVEAL_COPY.history.tail}
			</p>
		);
	return (
		<p
			className="rounded-[var(--radius-md)] border border-border2 bg-elevated p-md text-sm text-text"
			data-testid="game-payoff"
		>
			{REVEAL_COPY.payoff}
		</p>
	);
}
