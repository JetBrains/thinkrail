import { expect, test } from "bun:test";
import {
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import {
	supportsHostUpdateRun,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
} from "./wireTransport";

test("host update execution is offered only by a host at or beyond the v70 capability", () => {
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsHostUpdateRun(null)).toBe(false);
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
