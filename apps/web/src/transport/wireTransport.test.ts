import { expect, test } from "bun:test";
import {
	CHANGE_MUTATIONS_PROTOCOL_VERSION,
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
	REVIEW_RICH_ANCHORS_PROTOCOL_VERSION,
	type SessionStateRecord,
} from "@thinkrail/contracts";
import {
	mergeSessionStateRecords,
	supportsChangeMutations,
	supportsHostUpdateRun,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsRichAnchors,
} from "./wireTransport";

test("host update execution is offered only by a host at or beyond the v70 capability", () => {
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsHostUpdateRun(null)).toBe(false);
});

test("change mutations are offered only by a host at or beyond their capability version", () => {
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION)).toBe(true);
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsChangeMutations(null)).toBe(false);
});

test("rich review anchors are authored only against a host that preserves them", () => {
	expect(supportsRichAnchors(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION)).toBe(true);
	expect(supportsRichAnchors(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsRichAnchors(null)).toBe(false);
});

test("plan review is offered only by a host at or beyond the v67 capability", () => {
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanReview(null)).toBe(false);
});

test("auto plan-summary is requested only from a host at or beyond the v69 capability", () => {
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION + 1)).toBe(true);
	// A pre-v69 host serves no todo.generateSummary, so a new client must not issue the request.
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanSummaryGeneration(null)).toBe(false);
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
