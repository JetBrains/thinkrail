import { STORAGE_PREFIX } from "../constants/branding";
import { selectAutoSettledCounts, useAppStore } from "../store";
import { getTransport } from "../transport";

export const SETTLED_NOTICE_QUIET_MS = 2_000;
const NOTICE_DURATION_MS = 15_000;

function storageKey(): string {
	return `${STORAGE_PREFIX}settled-shelf-noticed:${getTransport().httpBase()}`;
}

export function settledShelfNoticed(): boolean {
	try {
		return localStorage.getItem(storageKey()) !== null;
	} catch {
		return true;
	}
}

export function settledNoticeTitle(count: number): string {
	return `Moved ${count === 1 ? "1 quiet workspace" : `${count} quiet workspaces`} to Settled`;
}

export function settledNoticeMessage(settleIdleDays: number | null): string {
	const why =
		settleIdleDays === null
			? "Their pull request merged or closed."
			: `Their pull request merged or closed, or they sat idle for ${settleIdleDays === 1 ? "a day" : `${settleIdleDays} days`}.`;
	return `${why} Any work in one, or Keep active, brings it back.`;
}

export function announceSettledShelf(): void {
	if (settledShelfNoticed()) return;
	const state = useAppStore.getState();
	const filled = selectAutoSettledCounts(state, Date.now());
	const count = filled.reduce((sum, entry) => sum + entry.count, 0);
	if (count === 0) return;
	try {
		localStorage.setItem(storageKey(), String(Date.now()));
	} catch {}
	state.pushToast({
		variant: "info",
		title: settledNoticeTitle(count),
		message: settledNoticeMessage(state.settleIdleDays),
		durationMs: NOTICE_DURATION_MS,
		action: {
			label: "Show",
			onClick: () => {
				const store = useAppStore.getState();
				for (const { projectId } of filled) {
					store.expandProject(projectId);
					store.toggleSettledShelf(projectId, true);
				}
			},
		},
	});
}
