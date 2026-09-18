import { expect, test } from "bun:test";
import { PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsPlanReview } from "./wireTransport";

test("plan review is offered only by a host at or beyond its capability version", () => {
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanReview(null)).toBe(false);
});
