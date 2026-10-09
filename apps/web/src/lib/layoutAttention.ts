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

function sameRecord(
	first: Record<string, string | number> | undefined,
	second: Record<string, string | number> | undefined,
): boolean {
	const firstKeys = Object.keys(first ?? {});
	const secondKeys = Object.keys(second ?? {});
	return (
		firstKeys.length === secondKeys.length &&
		firstKeys.every((key) => Object.hasOwn(second ?? {}, key) && first?.[key] === second?.[key])
	);
}

export function sameLayoutAttention(
	first: LayoutAttention | undefined,
	second: LayoutAttention | undefined,
): boolean {
	if (first === second) return true;
	if (!first || !second) return false;
	return (
		first.lastFocusedCenterGroupId === second.lastFocusedCenterGroupId &&
		sameRecord(first.selectedByGroup, second.selectedByGroup) &&
		sameRecord(first.lastFocusedSideGroupId, second.lastFocusedSideGroupId) &&
		sameRecord(first.navigationClockByGroup, second.navigationClockByGroup)
	);
}
