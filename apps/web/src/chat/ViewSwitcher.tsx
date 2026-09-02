import type { SessionViewMode } from "../store";

const SEGMENTS: { view: SessionViewMode; label: string }[] = [
	{ view: "chat", label: "Chat" },
	{ view: "work", label: "Work" },
];

export function ViewSwitcher({
	view,
	workAvailable,
	onSelect,
}: {
	view: SessionViewMode;
	workAvailable: boolean;
	onSelect: (view: SessionViewMode) => void;
}) {
	return (
		<div data-testid="session-view-switcher" className="flex shrink-0 items-center gap-2">
			{SEGMENTS.map(({ view: segment, label }) => {
				const active = view === segment;
				const disabled = segment === "work" && !workAvailable && !active;
				return (
					<button
						key={segment}
						type="button"
						data-testid={`session-view-${segment}`}
						data-active={active}
						aria-pressed={active}
						disabled={disabled}
						title={disabled ? "Work opens once this chat has a plan" : undefined}
						onClick={() => onSelect(segment)}
						className={`rounded-[var(--radius-sm)] px-8 py-2 tr-text-metadata ${
							active
								? "bg-control-bg-selected text-text-default"
								: disabled
									? "cursor-not-allowed text-control-disabled-text"
									: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						}`}
					>
						{label}
					</button>
				);
			})}
		</div>
	);
}
