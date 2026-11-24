import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { SETTINGS_ROW_FOCUS, SETTINGS_ROW_INSET, useSettingsRowRoving } from "./settingsRowCursor";

export interface SettingsLineProps {
	rowId: string;
	settingId?: string | undefined;
	testId?: string;
	framed?: boolean;
	className?: string;
	children: ReactNode;
}

export function SettingsLine({
	rowId,
	settingId,
	testId,
	framed = false,
	className,
	children,
}: SettingsLineProps) {
	const { tabIndex, ref } = useSettingsRowRoving(rowId);
	return (
		<div
			data-setting-row={rowId}
			data-setting-id={settingId}
			data-testid={testId}
			ref={ref}
			tabIndex={tabIndex}
			className={cn(!framed && SETTINGS_ROW_INSET, SETTINGS_ROW_FOCUS, className)}
		>
			{children}
		</div>
	);
}
