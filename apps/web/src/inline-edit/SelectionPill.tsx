import { Sparkles } from "lucide-react";

/** Floating "✦ Edit" pill anchored above a selection. Fixed-positioned at `rect.top/left` (viewport). */
export function SelectionPill({
	rect,
	onClick,
}: {
	rect: { top: number; left: number };
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="inline-edit-pill"
			onMouseDown={(e) => e.preventDefault()} // keep the text selection alive through the click
			onClick={onClick}
			style={{ position: "fixed", top: Math.max(8, rect.top - 36), left: rect.left }}
			className="z-40 flex items-center gap-xs rounded-[var(--radius-lg)] border border-border2 bg-elevated px-sm py-0.5 text-text text-xs shadow-[var(--shadow-md)] hover:bg-hover"
		>
			<Sparkles className="size-3 text-primary" />
			Edit
			<kbd className="ml-1 rounded-[var(--radius-sm)] border border-border2 px-1 text-hint text-[10px]">
				⌘K
			</kbd>
		</button>
	);
}
