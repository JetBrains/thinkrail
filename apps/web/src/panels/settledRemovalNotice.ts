import { t } from "@thinkrail/locales/react";
import { STORAGE_PREFIX } from "../constants/branding";
import { selectSettledRemovalCandidates, useAppStore } from "../store";
import { getTransport } from "../transport";

export const SETTLED_REMOVAL_NOTICE_QUIET_MS = 2_000;
const NOTICE_DURATION_MS = 20_000;

function storageKey(): string {
	return `${STORAGE_PREFIX}settled-removal-noticed:${getTransport().httpBase()}`;
}

function noticedIds(): Set<string> | null {
	try {
		const stored = JSON.parse(localStorage.getItem(storageKey()) ?? "[]");
		return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
	} catch {
		return null;
	}
}

/** Warn once per newly eligible set; the user removes nothing until they confirm the review. */
export function announceSettledRemovals(): void {
	const state = useAppStore.getState();
	const days = state.settledRemovalDays;
	const candidates = selectSettledRemovalCandidates(state, Date.now());
	if (days === null || candidates.length === 0) return;
	const noticed = noticedIds();
	if (!noticed || candidates.every((row) => noticed.has(row.workspace.id))) return;
	for (const row of candidates) noticed.add(row.workspace.id);
	try {
		localStorage.setItem(storageKey(), JSON.stringify([...noticed]));
	} catch {}
	state.pushToast({
		variant: "warning",
		title: t("panels.settledRemoval.noticeTitle", { count: candidates.length }),
		message: t("panels.settledRemoval.noticeMessage", { count: days }),
		durationMs: NOTICE_DURATION_MS,
		action: {
			label: t("panels.settledRemoval.review"),
			onClick: () => useAppStore.getState().setSettledRemovalReview({ projectId: null }),
		},
	});
}
