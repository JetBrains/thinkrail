import { expect, test } from "bun:test";
import {
	ACTIVITY_PROTOCOL_VERSION,
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
	SERVER_FALLBACK_OPT_OUT_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import {
	supportsHostUpdateRun,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsServerFallbackOptOut,
	supportsSessionActivity,
} from "./wireTransport";

test("a host at or beyond the activity version supports the layer", () => {
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION + 1)).toBe(true);
});

test("an older host and a pre-welcome connection do not, so the client clears rather than keeps glyphs", () => {
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionActivity(null)).toBe(false);
});

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

test("the server-side-fallback opt-out is offered only by a host at or beyond v73", () => {
	expect(supportsServerFallbackOptOut(SERVER_FALLBACK_OPT_OUT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsServerFallbackOptOut(SERVER_FALLBACK_OPT_OUT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsServerFallbackOptOut(null)).toBe(false);
});
