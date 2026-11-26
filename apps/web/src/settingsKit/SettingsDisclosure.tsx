import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useSettingsJump } from "./jumpToSetting";
import { SETTINGS_ROWS } from "./SettingsGroup";
import { SETTINGS_ROW_FOCUS, SETTINGS_ROW_INSET, useSettingsRowRoving } from "./settingsRowCursor";

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
	const { tabIndex, ref } = useSettingsRowRoving(rowId);
	const reveal = jump !== null && settingIds.includes(jump.id) ? jump.seq : null;
	useEffect(() => {
		if (reveal !== null) setExpanded(true);
	}, [reveal]);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="flex flex-col border-border-muted border-b">
			<button
				ref={ref}
				type="button"
				tabIndex={tabIndex}
				aria-expanded={expanded}
				aria-controls={expanded ? panelId : undefined}
				data-setting-row={rowId}
				data-testid={testId}
				className={cn(
					"flex items-center gap-8 py-12 text-left transition-colors",
					SETTINGS_ROW_INSET,
					SETTINGS_ROW_FOCUS,
				)}
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
