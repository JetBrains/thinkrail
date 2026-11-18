import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs, tabPanel, tabStep } from "./Tabs";

test("arrows wrap around the tabs, Home and End reach the ends, other keys do nothing", () => {
	expect(tabStep("ArrowRight", 0, 3)).toBe(1);
	expect(tabStep("ArrowRight", 2, 3)).toBe(0);
	expect(tabStep("ArrowLeft", 0, 3)).toBe(2);
	expect(tabStep("Home", 2, 3)).toBe(0);
	expect(tabStep("End", 0, 3)).toBe(2);
	expect(tabStep("Enter", 1, 3)).toBeNull();
	expect(tabStep("ArrowRight", 0, 0)).toBeNull();
});

test("one tab stop: only the selected tab is focusable, and every tab controls the one labelled panel", () => {
	const markup = renderToStaticMarkup(
		<>
			<Tabs
				id="t"
				label="Sections"
				tabs={[
					{ id: "a", label: "A", testId: "tab-a" },
					{ id: "b", label: "B" },
				]}
				value="b"
				onChange={() => {}}
			/>
			<div {...tabPanel("t", "b")} />
		</>,
	);
	expect(markup).toContain('role="tablist" aria-label="Sections"');
	expect(markup).toContain(
		'role="tab" id="t-tab-a" aria-selected="false" aria-controls="t-panel" tabindex="-1"',
	);
	expect(markup).toContain(
		'role="tab" id="t-tab-b" aria-selected="true" aria-controls="t-panel" tabindex="0"',
	);
	expect(markup).toContain('role="tabpanel" id="t-panel" aria-labelledby="t-tab-b"');
});
