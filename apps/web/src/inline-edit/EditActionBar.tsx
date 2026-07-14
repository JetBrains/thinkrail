import { Check, MessageSquare, RotateCcw, SquareArrowOutUpRight, Undo2 } from "lucide-react";

/**
 * The review action row: a "turn N of M" indicator, the agent's "why", Keep / Undo-last-change /
 * Revert-all / Refine / Open-as-chat, + the other-files notice. "Undo last change" only shows once there's
 * a turn to step back to (`turnCount > 1`); with a single turn, "Revert all" alone covers the full undo.
 */
export function EditActionBar({
	why,
	otherPaths,
	busy,
	turnIndex,
	turnCount,
	onKeep,
	onUndoLast,
	onRevertAll,
	onRefine,
	onOpenInTab,
	onOpenChanges,
}: {
	why?: string;
	otherPaths: string[];
	busy?: boolean;
	/** 1-based index of the turn under review, and the total turn count (for the "turn N of M" chip). */
	turnIndex: number;
	turnCount: number;
	onKeep: () => void;
	onUndoLast: () => void;
	onRevertAll: () => void;
	onRefine: () => void;
	onOpenInTab: () => void;
	onOpenChanges: () => void;
}) {
	const canStepBack = turnCount > 1;
	return (
		<div data-testid="inline-edit-actionbar" className="mt-xs flex flex-col gap-xs">
			{turnCount > 1 ? (
				<span data-testid="inline-edit-turn-indicator" className="text-hint text-[10px]">
					turn {turnIndex} of {turnCount}
				</span>
			) : null}
			{why ? <p className="text-muted text-xs italic">✦ {why}</p> : null}
			<div className="flex flex-wrap items-center gap-xs">
				<ActionButton testid="inline-edit-keep" onClick={onKeep} disabled={!!busy} tone="keep">
					<Check className="size-3" /> Keep
				</ActionButton>
				{canStepBack ? (
					<ActionButton
						testid="inline-edit-undo-last"
						onClick={onUndoLast}
						disabled={!!busy}
						tone="revert"
					>
						<Undo2 className="size-3" /> Undo last change
					</ActionButton>
				) : null}
				<ActionButton
					testid="inline-edit-revert-all"
					onClick={onRevertAll}
					disabled={!!busy}
					tone="revert"
				>
					<RotateCcw className="size-3" /> Revert all
				</ActionButton>
				<ActionButton testid="inline-edit-refine" onClick={onRefine} disabled={!!busy}>
					<MessageSquare className="size-3" /> Refine…
				</ActionButton>
				<ActionButton testid="inline-edit-open-chat" onClick={onOpenInTab} disabled={!!busy}>
					<SquareArrowOutUpRight className="size-3" /> Open as chat
				</ActionButton>
			</div>
			{otherPaths.length > 0 ? (
				<button
					type="button"
					data-testid="inline-edit-other-files"
					onClick={onOpenChanges}
					className="self-start text-gold text-[11px] hover:underline"
				>
					▲ also touched {otherPaths.length} other file{otherPaths.length > 1 ? "s" : ""} — view in
					Changes
				</button>
			) : null}
		</div>
	);
}

function ActionButton({
	children,
	onClick,
	disabled,
	testid,
	tone,
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	testid: string;
	tone?: "keep" | "revert";
}) {
	const toneCls =
		tone === "keep"
			? "border-green/50 text-green"
			: tone === "revert"
				? "border-red/40 text-red"
				: "border-border2 text-text";
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-center gap-1 rounded-[var(--radius-md)] border bg-elevated px-sm py-0.5 text-[11px] hover:bg-hover disabled:opacity-50 ${toneCls}`}
		>
			{children}
		</button>
	);
}
