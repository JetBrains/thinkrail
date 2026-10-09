export function ToggleSegment({
	testid,
	label,
	active,
	disabled = false,
	onClick,
}: {
	testid: string;
	label: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			disabled={disabled}
			className={`rounded-[var(--radius-sm)] px-8 py-2 tr-text-metadata ${
				active
					? "bg-control-bg-selected text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text disabled:hover:bg-transparent"
			}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}
