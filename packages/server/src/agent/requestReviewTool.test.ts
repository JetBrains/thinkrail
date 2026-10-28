import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createRequestReviewTool,
	REQUEST_REVIEW_TOOL_NAME,
	requestReviewExtension,
} from "./requestReviewTool";

test("the tool guidance is policy-neutral — it defers to the tool result's next action", () => {
	const tool = createRequestReviewTool();
	const guidance = [tool.description, ...(tool.promptGuidelines ?? [])].join("\n").toLowerCase();
	// It must tell the worker to follow the result, not hardcode an always-fix-and-re-review policy that a
	// stronger system prompt could use to override a configured "do not fix" stop.
	expect(guidance).toContain("follow the next action");
	expect(guidance).not.toContain("request_review again before moving to the next step");
	expect(guidance).not.toContain("address every finding");
});

test("the tool guidance scopes the call to steps that changed files, so it never asks for a refused review", () => {
	const tool = createRequestReviewTool();
	const guidance = [tool.description, ...(tool.promptGuidelines ?? [])].join("\n").toLowerCase();
	// The host refuses a step with no change set; unconditional "after every step" guidance made the worker
	// call it on check / PR / reply steps and fail each time.
	expect(guidance).toContain("changed files");
	expect(guidance).toContain("skip request_review for a step that changed no files");
	expect(guidance).not.toContain("call this right after you mark a step done.");
});

test("requestReviewExtension always registers the tool (the agent-review gate is a live active-tool toggle, not registration)", () => {
	const registered: string[] = [];
	const pi = {
		registerTool: (t: { name: string }) => registered.push(t.name),
	} as unknown as ExtensionAPI;
	requestReviewExtension(pi);
	expect(registered).toContain(REQUEST_REVIEW_TOOL_NAME);
});
