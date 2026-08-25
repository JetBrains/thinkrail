import type { FollowUp } from "./followUps";

export function FollowUpChips({
	items,
	onPick,
}: {
	items: FollowUp[];
	onPick: (prompt: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div
			data-testid="followup-row"
			className="flex w-full shrink-0 flex-wrap gap-xs bg-container-workspace-bg px-md pt-xs"
		>
			{items.map((item) => (
				<button
					key={item.label}
					type="button"
					data-testid="followup-chip"
					title={item.prompt}
					onClick={() => onPick(item.prompt)}
					className="flex max-w-full items-center rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-2xs text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
				>
					<span className="truncate">{item.label}</span>
				</button>
			))}
		</div>
	);
}
