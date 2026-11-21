import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestionChips } from "./SuggestionChips";

const SHORTCUTS = [
	{ caps: ["Alt", "1"], aria: "Alt+1 Alt+Shift+1" },
	{ caps: ["Alt", "2"], aria: "Alt+2 Alt+Shift+2" },
];

test("renders one labelled, numbered chip per suggestion and nothing for an empty list", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<SuggestionChips
				sessionId="s1"
				suggestions={["Run the tests", "Open a PR"]}
				onSend={() => {}}
				onEdit={() => {}}
				shortcuts={SHORTCUTS}
				chatRoot={null}
			/>
		</TooltipProvider>,
	);
	expect(html).toContain('aria-label="Suggested next messages"');
	expect(html).not.toContain("data-key-scope");
	expect(html.match(/data-testid="composer-suggestion"/g)).toHaveLength(2);
	expect(html).toContain('aria-keyshortcuts="Alt+1 Alt+Shift+1"');
	expect(html).toContain('aria-keyshortcuts="Alt+2 Alt+Shift+2"');
	expect(
		[...html.matchAll(/data-testid="composer-suggestion-number"><span[^>]*><kbd[^>]*>(\d)</g)].map(
			([, n]) => n,
		),
	).toEqual(["1", "2"]);
	expect(html).toContain('aria-hidden="true" data-testid="composer-suggestion-number"');
	expect(html).toContain("Run the tests");
	expect(
		renderToStaticMarkup(
			<SuggestionChips
				sessionId="s1"
				suggestions={[]}
				onSend={() => {}}
				onEdit={() => {}}
				shortcuts={[]}
				chatRoot={null}
			/>,
		),
	).toBe("");
	const twelve = Array.from({ length: 12 }, (_, index) => `Step ${index + 1}`);
	const capped = renderToStaticMarkup(
		<TooltipProvider>
			<SuggestionChips
				sessionId="s1"
				suggestions={twelve}
				onSend={() => {}}
				onEdit={() => {}}
				shortcuts={[]}
				chatRoot={null}
			/>
		</TooltipProvider>,
	);
	expect(capped.match(/data-testid="composer-suggestion"/g)).toHaveLength(9);
});
