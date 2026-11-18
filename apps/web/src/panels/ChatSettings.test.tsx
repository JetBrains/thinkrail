import { expect, test } from "bun:test";
import { QUESTION_PANEL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChatPage,
	type ChatPageProps,
	ChatSettings,
	QuestionPanelHeightControl,
} from "./ChatSettings";

const page = (props: Partial<ChatPageProps>) =>
	renderToStaticMarkup(
		<ChatPage
			messageOrder="oldest-first"
			growthLimit="half-chat"
			panelHeight={70}
			protocolVersion={QUESTION_PANEL_PROTOCOL_VERSION}
			onMessageOrder={() => {}}
			onGrowthLimit={() => {}}
			onPanelHeight={() => Promise.resolve(true)}
			{...props}
		/>,
	);

const rowIds = (markup: string) =>
	[...markup.matchAll(/data-setting-row="([^"]+)"/g)].map((match) => match[1]);

test("Chat is a titled page with message order, composer size and question panel height rows", () => {
	const markup = page({});
	expect(markup).toMatch(/<h2[^>]*>Chat<\/h2>/);
	expect(markup).toContain("How the conversation and the message box behave.");
	expect(markup).toContain("Messages");
	expect(rowIds(markup)).toEqual(["message-order", "composer-size", "question-panel-height"]);
	expect(markup).toMatch(
		/role="listbox"[^>]*data-testid="chat-message-order-control"[^>]*data-cost="cheap"/,
	);
	expect(markup).toMatch(
		/role="listbox"[^>]*data-testid="composer-growth-control"[^>]*data-cost="cheap"/,
	);
	expect(markup).not.toContain("line-width");
	expect(markup).not.toContain('data-testid="settings-subagents"');
	expect(markup).not.toContain("data-changed");
});

test("each changed chat row shows Changed and its own Reset", () => {
	const markup = page({ messageOrder: "newest-first", growthLimit: "compact", panelHeight: 90 });
	for (const id of ["message-order", "composer-size", "question-panel-height"]) {
		expect(markup).toContain(`data-testid="settings-reset-${id}"`);
	}
	expect(markup.match(/data-changed="true"/g)).toHaveLength(3);
});

test("the store-bound section renders the same page", () => {
	expect(renderToStaticMarkup(<ChatSettings />)).toContain('data-testid="settings-chat"');
});

test("the question panel height is a number field offered only to a host that stores it", () => {
	const render = (protocolVersion: number | null) =>
		renderToStaticMarkup(
			<QuestionPanelHeightControl
				protocolVersion={protocolVersion}
				value={75}
				onCommit={() => Promise.resolve(true)}
			/>,
		);
	expect(render(null)).toBe("");
	expect(render(QUESTION_PANEL_PROTOCOL_VERSION - 1)).toBe("");
	const input = render(QUESTION_PANEL_PROTOCOL_VERSION).match(
		/<input[^>]*data-testid="question-panel-height-input"[^>]*>/,
	)?.[0];
	expect(input).toContain('value="75"');
	expect(input).toContain('type="text"');
	expect(input).toContain('inputMode="numeric"');
	expect(input).toContain('tabindex="0"');
});
