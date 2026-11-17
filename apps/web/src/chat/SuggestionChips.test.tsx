import { expect, test } from "bun:test";
import { localKeys } from "@thinkrail/ui/local-keys";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { SuggestionChips, suggestionKeyIndex } from "./SuggestionChips";

test("renders one labelled chip per suggestion and nothing for an empty list", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<SuggestionChips suggestions={["Run the tests", "Open a PR"]} onSend={() => {}} />
		</TooltipProvider>,
	);
	expect(html).toContain('aria-label="Suggested next messages"');
	expect(html).toContain('data-key-scope="composer"');
	expect(html.match(/data-testid="composer-suggestion"/g)).toHaveLength(2);
	expect(html).toContain('aria-keyshortcuts="Alt+1"');
	expect(html).toContain("Run the tests");
	expect(renderToStaticMarkup(<SuggestionChips suggestions={[]} onSend={() => {}} />)).toBe("");
});

const press = (code: string, modifiers: { alt?: boolean; shift?: boolean } = {}) => ({
	code,
	key: code.replace("Digit", ""),
	altKey: modifiers.alt ?? false,
	shiftKey: modifiers.shift ?? false,
	ctrlKey: false,
	metaKey: false,
	isComposing: false,
	keyCode: 0,
	target: null,
});

test("the input's and the conversation's local keys send chip N on Alt+N by default", () => {
	for (const scope of ["composer", "transcript"] as const) {
		const keys = localKeys(null, scope, LOCAL_KEY_DEFAULTS[scope]);
		const index = (code: string, modifiers?: { alt?: boolean; shift?: boolean }) =>
			suggestionKeyIndex(keys.match(press(code, modifiers), { textEntry: true }));
		expect([scope, index("Digit1", { alt: true }), index("Digit9", { alt: true })]).toEqual([
			scope,
			0,
			8,
		]);
		expect(index("Digit1")).toBeNull();
		expect(index("Digit0", { alt: true })).toBeNull();
		expect(index("KeyA", { alt: true })).toBeNull();
	}
	expect(suggestionKeyIndex(null)).toBeNull();
	expect(suggestionKeyIndex("composer.followUp")).toBeNull();
});
