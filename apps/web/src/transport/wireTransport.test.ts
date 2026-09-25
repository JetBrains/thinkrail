import { expect, test } from "bun:test";
import {
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	type SessionStateRecord,
} from "@thinkrail/contracts";
import { mergeSessionStateRecords, supportsPlanReview } from "./wireTransport";

test("plan review is offered only by a host at or beyond its capability version", () => {
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanReview(null)).toBe(false);
});

function record(sessionId: string, completionId: string): SessionStateRecord {
	return {
		sessionId,
		workspaceId: "workspace",
		projectId: "project",
		state: {
			execution: "idle",
			runId: `run:${sessionId}`,
			needsInput: null,
			completion: { completionId, outcome: "succeeded" },
			completionUnread: true,
			queuedCount: 0,
		},
	};
}

test("buffered state replaces its stale snapshot row before activation binding", () => {
	const other = record("other", "completion:other");
	expect(
		mergeSessionStateRecords(
			[record("target", "completion:old"), other],
			[record("target", "completion:newer"), record("target", "completion:latest")],
		),
	).toEqual([record("target", "completion:latest"), other]);
});
