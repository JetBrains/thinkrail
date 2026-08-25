export type WorkbenchSide = "left" | "right";
export type WorkbenchAuxiliaryRegion = WorkbenchSide | "bottom";

export interface LayoutAttention {
	selectedByGroup: Record<string, string>;
	lastFocusedCenterGroupId: string;
	lastFocusedSideGroupId: Partial<Record<WorkbenchAuxiliaryRegion, string>>;
	navigationClockByGroup: Record<string, number>;
}

export function readLayoutSelection(
	attention: LayoutAttention,
	groupId: string,
): string | undefined {
	if (!Object.hasOwn(attention.selectedByGroup, groupId)) return undefined;
	const value = attention.selectedByGroup[groupId];
	return typeof value === "string" ? value : undefined;
}

export function readLayoutNavigationClock(
	attention: LayoutAttention,
	groupId: string,
): number | undefined {
	if (!Object.hasOwn(attention.navigationClockByGroup, groupId)) return undefined;
	const value = attention.navigationClockByGroup[groupId];
	return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}
