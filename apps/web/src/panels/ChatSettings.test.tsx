import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings } from "./ChatSettings";

test("Chat settings renders one two-handle streaming movement control", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	expect(markup).toContain("Streaming response movement");
	expect(markup).toContain(
		"Choose when the chat moves while an answer grows and where its newest edge lands.",
	);
	expect(markup).toContain('data-testid="streaming-response-movement"');
	expect(markup).toContain('data-testid="streaming-movement-settle" aria-label="Settle position"');
	expect(markup).toContain('aria-valuetext="75% from the top"');
	expect(markup).toContain(
		'data-testid="streaming-movement-trigger" aria-label="Trigger position"',
	);
	expect(markup).toContain('aria-valuetext="100% from the top"');
	expect(markup.match(/type="range"/g)).toHaveLength(2);
});
