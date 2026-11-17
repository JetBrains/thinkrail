import { expect, test } from "bun:test";
import { QUESTION_PANEL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings, QuestionPanelHeightControl } from "./ChatSettings";

test("Chat settings keeps the chat's own rows; line width and subagents have their own sections", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup).toContain('data-testid="chat-message-order-control"');
	expect(markup).toContain('data-testid="composer-growth-control"');
	expect(markup).not.toContain("line-width");
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
