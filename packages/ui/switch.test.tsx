import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch, type SwitchProps } from "./switch";

function render(props: Partial<SwitchProps> = {}): string {
	return renderToStaticMarkup(
		<Switch checked={false} label="Enable feature" onCheckedChange={() => {}} {...props} />,
	);
}

test("switch exposes state without visible on/off text", () => {
	const off = render();
	const on = render({ checked: true, testId: "feature-toggle" });

	expect(off).toContain('<button type="button" role="switch"');
	expect(off).toContain('aria-checked="false"');
	expect(off).not.toContain(">On<");
	expect(off).not.toContain(">Off<");
	expect(on).toContain('aria-checked="true"');
	expect(on).toContain('data-testid="feature-toggle"');
	expect(on).toContain('data-active="true"');
	expect(on).toContain("translate-x-16");
});

test("switch preserves native disabled behavior", () => {
	const disabled = render({ disabled: true });
	expect(disabled).toMatch(/<button[^>]* disabled=""/);
});

test("switch reports the next state exactly once", () => {
	const changes: boolean[] = [];
	const element = Switch({
		checked: false,
		label: "Enable feature",
		onCheckedChange: (checked) => changes.push(checked),
	}) as ReactElement<{ onClick: () => void }>;

	element.props.onClick();
	expect(changes).toEqual([true]);
});
