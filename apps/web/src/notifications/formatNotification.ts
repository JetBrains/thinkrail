import type { SessionCompletion } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";

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
	| { kind: "search" };

/** A ready-to-show notification derived from one flush of accumulated events. */
export interface NotificationSpec {
	title: string;
	/** The worktree name for a single event; channels with a subtitle field use it, others fold it into the body. */
	subtitle?: string;
	body: string;
	tag: string;
	target: NotificationTarget;
}

const BODY_MAX = 100;
const APP_NAME = "ThinkRail";
const AGGREGATE_TAG = "thinkrail-attention";

export function reasonLabel(reason: AttentionReason): string {
	if (reason.kind === "needs-input") return t("notifications.reason.needsInput");
	const completion = reason.completion;
	switch (completion.outcome) {
		case "succeeded":
			return t("notifications.reason.succeeded");
		case "interrupted":
			return t("notifications.reason.interrupted");
		case "cancelled":
			return t("notifications.reason.cancelled");
		case "failed":
			return completion.failure === "length"
				? t("notifications.reason.contextFull")
				: t("notifications.reason.failed");
	}
}

function truncate(text: string): string {
	return text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX - 1)}…`;
}

/**
 * Collapse a window's accumulated attention events into one notification: a single worktree opens
 * its chat on click, several open search. Returns null when nothing passed.
 */
export function formatNotification(events: readonly AttentionEvent[]): NotificationSpec | null {
	const [event] = events;
	if (!event) return null;
	if (events.length === 1) {
		const name = event.worktreeName.trim();
		// Title is always the bold ThinkRail mark; the worktree is the subtitle, the reason the body.
		return {
			title: APP_NAME,
			...(name ? { subtitle: name } : {}),
			body: truncate(reasonLabel(event.reason)),
			tag: `attention:${event.sessionId}`,
			target: { kind: "chat", workspaceId: event.workspaceId, sessionId: event.sessionId },
		};
	}
	return {
		title: APP_NAME,
		body: truncate(t("notifications.aggregate.body", { count: events.length })),
		tag: AGGREGATE_TAG,
		target: { kind: "search" },
	};
}
