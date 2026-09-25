import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "./switch";

test("switch renders its checked state and forwards button props", () => {
	const on = renderToStaticMarkup(
		<Switch checked aria-label="Enabled" data-testid="s" onCheckedChange={() => {}} />,
	);
	const off = renderToStaticMarkup(
		<Switch checked={false} disabled aria-label="Enabled" onCheckedChange={() => {}} />,
	);
	expect(on).toContain('role="switch"');
	expect(on).toContain('aria-checked="true"');
	expect(on).toContain('aria-label="Enabled"');
	expect(on).toContain('data-testid="s"');
	expect(on).toContain("translate-x-16");
	expect(off).toContain('aria-checked="false"');
	expect(off).toContain("disabled");
	expect(off).not.toContain("translate-x-16");
});
