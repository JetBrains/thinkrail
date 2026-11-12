import { t } from "@thinkrail/locales/react";
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
	return t("panels.settledNotice.title", { count });
}

export function settledNoticeMessage(settleIdleDays: number | null): string {
	return settleIdleDays === null
		? t("panels.settledNotice.messageMerged")
		: t("panels.settledNotice.messageIdle", { count: settleIdleDays });
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
			label: t("panels.settledNotice.show"),
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
