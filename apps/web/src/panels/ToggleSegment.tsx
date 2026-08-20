/**
 * One segment of a slim header view-toggle (Preview|Source, Split|Inline, List|Tree) — shared by the panes.
 * The active segment reuses the workspace tabs' selected role (`control-bg-selected`) rather than a
 * container surface, so its selected background stays visible on every toolbar surface in every theme
 * (`container-elevated-bg` resolves equal to the surrounding surface in the high-contrast themes).
 */
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
					? "bg-control-bg-selected text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}
