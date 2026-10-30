import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import type { ReactNode } from "react";

export function SettingsDisclosure({
	label,
	summary,
	expanded,
	testId,
	onToggle,
	children,
}: {
	label: string;
	summary: string;
	expanded: boolean;
	testId: string;
	onToggle: () => void;
	children: ReactNode;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="flex flex-col border-border-muted border-b">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				data-testid={testId}
				className="flex w-full items-center gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
			>
				<span className="flex-1 tr-text-ui text-text-default">{label}</span>
				<span className="truncate tr-text-metadata text-text-muted">{summary}</span>
				<Chevron className="size-20 shrink-0 text-text-muted" aria-hidden="true" />
			</button>
			{expanded ? children : null}
		</div>
	);
}
