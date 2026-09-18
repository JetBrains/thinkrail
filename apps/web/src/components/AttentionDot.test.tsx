import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionDot } from "./AttentionDot";

test("attention dot accepts a caller-owned shortcut suffix without changing its visual vocabulary", () => {
	const markup = renderToStaticMarkup(
		<AttentionDot label="Needs attention, F8 next, Shift+F8 previous" />,
	);
	expect(markup).toContain('aria-label="Needs attention, F8 next, Shift+F8 previous"');
	expect(markup).toContain("bg-primary");
});

test("attention dot has one accessible meaning and one semantic accent", () => {
	const markup = renderToStaticMarkup(<AttentionDot />);
	expect(markup).toContain('aria-label="Needs attention"');
	expect(markup).toContain('data-testid="attention-dot"');
	expect(markup).toContain("bg-primary");
	expect(markup).not.toContain("animate-");
});
