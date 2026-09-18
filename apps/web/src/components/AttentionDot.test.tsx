import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionDot } from "./AttentionDot";

test("attention dot has one accessible meaning and one semantic accent", () => {
	const markup = renderToStaticMarkup(<AttentionDot />);
	expect(markup).toContain('aria-label="Needs attention"');
	expect(markup).toContain('data-testid="attention-dot"');
	expect(markup).toContain("bg-primary");
	expect(markup).not.toContain("animate-");
});
