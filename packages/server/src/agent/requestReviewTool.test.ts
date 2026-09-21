import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test } from "bun:test";
import {
	createRequestReviewTool,
	REQUEST_REVIEW_TOOL_NAME,
	requestReviewExtension,
	setAgentReviewEnabledResolver,
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

afterEach(() => setAgentReviewEnabledResolver(() => true));

test("requestReviewExtension registers the tool only when agent review is enabled", () => {
	const registered: string[] = [];
	const pi = {
		registerTool: (t: { name: string }) => registered.push(t.name),
	} as unknown as ExtensionAPI;

	setAgentReviewEnabledResolver(() => false);
	requestReviewExtension(pi);
	expect(registered).not.toContain(REQUEST_REVIEW_TOOL_NAME);

	setAgentReviewEnabledResolver(() => true);
	requestReviewExtension(pi);
	expect(registered).toContain(REQUEST_REVIEW_TOOL_NAME);
});
