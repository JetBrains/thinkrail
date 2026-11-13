import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestionChips, suggestionShortcutLabel } from "./SuggestionChips";

test("renders one labelled chip per suggestion and nothing for an empty list", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<SuggestionChips suggestions={["Run the tests", "Open a PR"]} onSend={() => {}} />
		</TooltipProvider>,
	);
	expect(html).toContain('aria-label="Suggested next messages"');
	expect(html.match(/data-testid="composer-suggestion"/g)).toHaveLength(2);
	expect(html).toContain("Run the tests");
	expect(renderToStaticMarkup(<SuggestionChips suggestions={[]} onSend={() => {}} />)).toBe("");
});

test("names the Alt+N shortcut in each platform's notation", () => {
	expect(suggestionShortcutLabel(0, "MacIntel")).toBe("⌥1");
	expect(suggestionShortcutLabel(2, "Win32")).toBe("Alt+3");
	expect(suggestionShortcutLabel(1, "Linux x86_64")).toBe("Alt+2");
});
