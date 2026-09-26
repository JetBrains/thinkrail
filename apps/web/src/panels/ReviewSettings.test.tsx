import { expect, test } from "bun:test";
import { AGENT_REVIEW_SETTING_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentReviewSettings } from "./ReviewSettings";

test("the agent-review toggle is hidden against a pre-v68 host", () => {
	const markup = renderToStaticMarkup(
		<AgentReviewSettings
			protocolVersion={AGENT_REVIEW_SETTING_PROTOCOL_VERSION - 1}
			enabled
			onChange={() => {}}
		/>,
	);
	expect(markup).toBe("");
});

test("the agent-review toggle is hidden before the protocol is known", () => {
	const markup = renderToStaticMarkup(
		<AgentReviewSettings protocolVersion={null} enabled onChange={() => {}} />,
	);
	expect(markup).toBe("");
});

test("a v68 host renders the toggle reflecting the current value", () => {
	const on = renderToStaticMarkup(
		<AgentReviewSettings
			protocolVersion={AGENT_REVIEW_SETTING_PROTOCOL_VERSION}
			enabled
			onChange={() => {}}
		/>,
	);
	expect(on).toContain("Agent-triggered review");
	expect(on).toContain('data-testid="agent-review-toggle" data-active="true"');

	const off = renderToStaticMarkup(
		<AgentReviewSettings
			protocolVersion={AGENT_REVIEW_SETTING_PROTOCOL_VERSION}
			enabled={false}
			onChange={() => {}}
		/>,
	);
	expect(off).toContain('data-testid="agent-review-toggle" data-active="false"');
	expect(off).toContain("only the Review button starts a review");
});
