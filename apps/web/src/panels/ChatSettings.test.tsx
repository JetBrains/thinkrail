import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings } from "./ChatSettings";

test("Chat settings renders one pin-line streaming movement control", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup).toContain("Streaming response movement");
	expect(markup).toContain('data-testid="streaming-response-movement"');
	expect(markup).toContain('data-testid="streaming-movement-trigger" aria-label="Pin line"');
	expect(markup).toContain('aria-valuetext="100% from the top"');
	expect(markup.match(/type="range"/g)).toHaveLength(1);
	expect(markup).not.toContain("Settle");
	expect(markup).not.toContain("Follow response");
});

test("Chat settings renders one chat line-width control with its Fit to pane switch", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup.match(/data-testid="chat-line-width-input"/g)).toHaveLength(1);
	expect(markup).toContain('data-testid="chat-line-width-control"');
	expect(markup).toMatch(/<button[^>]*role="switch"[^>]*data-testid="chat-line-width-bounded"/);
	expect(markup).toMatch(
		/<input[^>]*data-testid="chat-line-width-input"[^>]*data-settings-draft-input/,
	);
	expect(markup).not.toContain('data-testid="chat-line-width-error"');
	expect(markup).not.toContain("file-line-width");
});

test("Chat settings hides subagents against a host without the subagent protocol", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup).not.toContain('data-testid="settings-subagents"');
});
