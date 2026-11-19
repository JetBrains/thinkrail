import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useSettingsJump } from "./jumpToSetting";
import { SETTINGS_ROWS } from "./SettingsGroup";

export interface SettingsDisclosureProps {
	rowId: string;
	label: string;
	summary?: string | undefined;
	settingIds?: readonly string[];
	defaultExpanded?: boolean;
	testId?: string;
	children: ReactNode;
}

export function SettingsDisclosure({
	rowId,
	label,
	summary,
	settingIds = [],
	defaultExpanded = false,
	testId,
	children,
}: SettingsDisclosureProps) {
	const panelId = useId();
	const [expanded, setExpanded] = useState(defaultExpanded);
	const jump = useSettingsJump();
	const reveal = jump !== null && settingIds.includes(jump.id) ? jump.seq : null;
	useEffect(() => {
		if (reveal !== null) setExpanded(true);
	}, [reveal]);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="flex flex-col border-border-muted border-b">
			<button
				type="button"
				tabIndex={0}
				aria-expanded={expanded}
				aria-controls={expanded ? panelId : undefined}
				data-setting-row={rowId}
				data-setting-stop=""
				data-testid={testId}
				className="flex w-full items-center gap-8 py-12 text-left transition-colors focus-visible:focus-ring-inset"
				onClick={() => setExpanded((value) => !value)}
			>
				<span className="flex-1 tr-text-ui text-text-default">{label}</span>
				{summary ? (
					<span className="min-w-0 break-words text-right tr-text-metadata text-text-muted">
						{summary}
					</span>
				) : null}
				<Chevron className="size-16 shrink-0 text-text-muted" aria-hidden="true" />
			</button>
			{expanded ? (
				<div id={panelId} className={SETTINGS_ROWS}>
					{children}
				</div>
			) : null}
		</div>
	);
}
