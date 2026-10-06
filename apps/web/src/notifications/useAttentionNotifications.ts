import { useEffect } from "react";
import { selectWorkspaceById, useAppStore } from "@/store";
import { createAttentionNotificationEngine, type TimerHandle } from "./attentionNotificationEngine";
import { createAttentionObserver } from "./attentionObserver";
import { type AttentionCandidate, isLit } from "./detectAttention";
import type { NotificationSpec } from "./formatNotification";
import { isPromptSnoozed } from "./notificationPrompt";
import {
	isWindowFocused,
	notificationPermission,
	showBrowserNotification,
} from "./webNotifications";

/** Collection-window length: enqueued edges accumulate this long, then flush as one batch. */
export const ATTENTION_WINDOW_MS = 1000;

type AppState = ReturnType<typeof useAppStore.getState>;

function collectCandidates(state: AppState): AttentionCandidate[] {
	const candidates: AttentionCandidate[] = [];
	for (const records of Object.values(state.sessionStateByWorkspace)) {
		for (const record of Object.values(records)) {
			candidates.push({
				sessionId: record.sessionId,
				workspaceId: record.workspaceId,
				worktreeName: selectWorkspaceById(state, record.workspaceId)?.name ?? "",
				state: record.state,
			});
		}
	}
	return candidates;
}

function navigate(spec: NotificationSpec): void {
	if (spec.target.kind === "app") return; // window already focused by the click handler
	const state = useAppStore.getState();
	const projectId = selectWorkspaceById(state, spec.target.workspaceId)?.projectId;
	if (!projectId) return;
	// The route-based open lands the chat at its latest message (no message jump/flash), same as a
	// deep link — not requestChatLocation, which reveals a specific message.
	state.activateWorkspaceFromRoute(
		{ id: spec.target.workspaceId, projectId },
		spec.target.sessionId,
	);
}

/**
 * The attention-notification observer: it watches session-state transitions (the green dot), feeds
 * rising edges into the engine, and renders surviving batches as browser notifications. Mount once.
 */
export function useAttentionNotifications(): void {
	useEffect(() => {
		const engine = createAttentionNotificationEngine({
			windowMs: ATTENTION_WINDOW_MS,
			isEnabled: () => useAppStore.getState().notificationsEnabled,
			permission: notificationPermission,
			isWindowFocused,
			isStillLit: (sessionId) => {
				const state = useAppStore.getState();
				for (const records of Object.values(state.sessionStateByWorkspace)) {
					const record = records[sessionId];
					if (record) return isLit(record.state);
				}
				return false;
			},
			emit: (spec) =>
				showBrowserNotification({
					title: spec.title,
					body: spec.body,
					tag: spec.tag,
					onClick: () => navigate(spec),
				}),
			onPermissionNeeded: () => {
				const permission = notificationPermission();
				if (permission === "denied" || permission === "unsupported") return;
				if (isPromptSnoozed()) return;
				useAppStore.getState().openNotificationPrompt();
			},
			schedule: (callback, delay): TimerHandle => setTimeout(callback, delay),
			cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		});

		const observer = createAttentionObserver((event) => engine.enqueue(event));
		// Cheap gate: the store notifies on every mutation (streaming deltas included), but attention
		// only moves when sessionStateClock advances, so skip the candidate rebuild otherwise.
		let lastClock: number | null = null;
		const evaluate = (state: AppState) => {
			if (state.sessionStateClock === lastClock) return;
			lastClock = state.sessionStateClock;
			observer.observe({
				snapshotInstalled: state.sessionStateSnapshotInstalled,
				connectionGeneration: state.connectionGeneration,
				candidates: collectCandidates(state),
			});
		};

		evaluate(useAppStore.getState());
		const unsubscribe = useAppStore.subscribe(evaluate);
		return () => {
			unsubscribe();
			engine.dispose();
		};
	}, []);
}
