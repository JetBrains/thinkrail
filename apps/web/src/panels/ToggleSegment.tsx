export function ToggleSegment({
	testid,
	label,
	active,
	disabled,
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
			className={`rounded-[var(--radius-sm)] px-8 py-2 tr-text-metadata disabled:text-text-disabled ${
				active
					? "bg-control-bg-selected text-text-default"
					: "text-text-muted enabled:hover:bg-control-bg-hovered enabled:hover:text-text-default"
			}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}
