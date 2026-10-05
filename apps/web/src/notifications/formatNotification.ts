import type { SessionCompletion } from "@thinkrail/contracts";

/** Why a worktree's attention dot lit up, captured when the event is enqueued. */
export type AttentionReason =
	| { kind: "needs-input" }
	| { kind: "completed"; completion: SessionCompletion };

/** One worktree that transitioned into needs-attention. */
export interface AttentionEvent {
	sessionId: string;
	workspaceId: string;
	worktreeName: string;
	reason: AttentionReason;
}

/** Where a click on the emitted notification should land. */
export type NotificationTarget =
	| { kind: "chat"; workspaceId: string; sessionId: string }
	| { kind: "app" };

/** A ready-to-show notification derived from one flush of accumulated events. */
export interface NotificationSpec {
	title: string;
	body: string;
	tag: string;
	target: NotificationTarget;
}

const BODY_MAX = 100;
const APP_NAME = "ThinkRail";
const AGGREGATE_TAG = "thinkrail-attention";

export function reasonLabel(reason: AttentionReason): string {
	if (reason.kind === "needs-input") return "needs your input";
	const completion = reason.completion;
	switch (completion.outcome) {
		case "succeeded":
			return "finished";
		case "interrupted":
			return "interrupted";
		case "cancelled":
			return "cancelled";
		case "failed":
			return completion.failure === "length" ? "stopped — context full" : "failed";
	}
}

function truncate(text: string): string {
	return text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX - 1)}…`;
}

/**
 * Collapse a window's accumulated attention events into one notification: a single worktree opens
 * its chat on click, several focus the app. Returns null when nothing passed.
 */
export function formatNotification(events: readonly AttentionEvent[]): NotificationSpec | null {
	if (events.length === 0) return null;
	if (events.length === 1) {
		const event = events[0]!;
		const name = event.worktreeName.trim() || APP_NAME;
		return {
			title: name,
			body: truncate(reasonLabel(event.reason)),
			tag: `attention:${event.sessionId}`,
			target: { kind: "chat", workspaceId: event.workspaceId, sessionId: event.sessionId },
		};
	}
	return {
		title: APP_NAME,
		body: truncate(`${events.length} worktrees need attention`),
		tag: AGGREGATE_TAG,
		target: { kind: "app" },
	};
}
