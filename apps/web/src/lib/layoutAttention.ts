export type WorkbenchSide = "left" | "right";

/** Browser-local selection/focus overlay; never serialized into a workspace layout document. */
export interface LayoutAttention {
	selectedByGroup: Record<string, string>;
	lastFocusedCenterGroupId: string;
	lastFocusedSideGroupId: Partial<Record<WorkbenchSide, string>>;
	navigationClockByGroup: Record<string, number>;
}

/** Read an untrusted group selection without consulting inherited object properties. */
export function readLayoutSelection(
	attention: LayoutAttention,
	groupId: string,
): string | undefined {
	if (!Object.hasOwn(attention.selectedByGroup, groupId)) return undefined;
	const value = attention.selectedByGroup[groupId];
	return typeof value === "string" ? value : undefined;
}

/** Read an untrusted, tuple-keyed center clock without consulting inherited object properties. */
export function readLayoutNavigationClock(
	attention: LayoutAttention,
	groupId: string,
): number | undefined {
	if (!Object.hasOwn(attention.navigationClockByGroup, groupId)) return undefined;
	const value = attention.navigationClockByGroup[groupId];
	return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}
