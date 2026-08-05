/** One segment of a slim header view-toggle (Preview|Source, Split|Inline) — shared by the panes. */
export function ToggleSegment({
	testid,
	label,
	active,
	onClick,
}: {
	testid: string;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			className={`rounded-[var(--radius-sm)] px-sm py-0.5 tr-text-metadata ${
				active
					? "bg-container-elevated-bg text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}
