import { Eye, Square, SquareArrowOutUpRight } from "lucide-react";

/** Working-state chip shown on the target region while the agent edits. */
export function EditStatusChip({
	label,
	onPreview,
	onOpenInTab,
	onStop,
}: {
	label: string;
	onPreview: () => void;
	onOpenInTab: () => void;
	onStop: () => void;
}) {
	return (
		<span
			data-testid="inline-edit-chip"
			className="inline-flex items-center gap-xs rounded-[var(--radius-lg)] border border-primary/40 bg-primary/10 py-0.5 pr-0.5 pl-sm text-primary text-[11px]"
		>
			<span className="size-1.5 animate-pulse rounded-full bg-primary" />
			{label}
			<ChipButton testid="inline-edit-preview" onClick={onPreview}>
				<Eye className="size-3" /> preview
			</ChipButton>
			<ChipButton testid="inline-edit-open-tab" onClick={onOpenInTab}>
				<SquareArrowOutUpRight className="size-3" /> tab
			</ChipButton>
			<ChipButton testid="inline-edit-stop" onClick={onStop} danger>
				<Square className="size-3" /> stop
			</ChipButton>
		</span>
	);
}

function ChipButton({
	children,
	onClick,
	testid,
	danger,
}: {
	children: React.ReactNode;
	onClick: () => void;
	testid: string;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			className={`inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-border2 bg-bg px-1.5 py-0.5 text-[10px] hover:bg-hover ${danger ? "text-red" : "text-text"}`}
		>
			{children}
		</button>
	);
}
