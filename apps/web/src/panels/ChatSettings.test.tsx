import { expect, test } from "bun:test";
import { QUESTION_PANEL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings, QuestionPanelHeightControl } from "./ChatSettings";

test("Chat settings renders one chat line-width control with its Fit to pane switch", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup.match(/data-testid="chat-line-width-input"/g)).toHaveLength(1);
	expect(markup).toContain('data-testid="chat-line-width-control"');
	expect(markup).toMatch(/<button[^>]*role="switch"[^>]*data-testid="chat-line-width-bounded"/);
	const input = markup.match(/<input[^>]*data-testid="chat-line-width-input"[^>]*>/)?.[0];
	expect(input).toContain("data-settings-draft-input");
	expect(markup).not.toContain('data-testid="chat-line-width-error"');
	expect(markup).not.toContain("file-line-width");
});

test("Chat settings hides subagents against a host without the subagent protocol", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup).not.toContain('data-testid="settings-subagents"');
});

test("the question panel height is offered only to a host that stores it", () => {
	const render = (protocolVersion: number | null) =>
		renderToStaticMarkup(
			<QuestionPanelHeightControl protocolVersion={protocolVersion} value={75} />,
		);
	expect(render(null)).toBe("");
	expect(render(QUESTION_PANEL_PROTOCOL_VERSION - 1)).toBe("");
	const input = render(QUESTION_PANEL_PROTOCOL_VERSION).match(
		/<input[^>]*data-testid="question-panel-height-input"[^>]*>/,
	)?.[0];
	expect(input).toContain('value="75"');
	expect(input).toContain('min="40"');
	expect(input).toContain('max="100"');
	expect(input).toContain("data-settings-draft-input");
});
