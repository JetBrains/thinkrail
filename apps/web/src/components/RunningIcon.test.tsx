import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BRAND_MARK_SEGMENTS } from "../constants/branding";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured Helios orbit with a travelling arc", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain('data-neon="pulse"');
	expect(markup).toContain("size-14 text-primary");
	expect(markup.match(/motion-safe:animate-helios-orbit/g)).toHaveLength(1);
	expect(markup).toContain("motion-safe:animate-helios-sun");
	expect(markup.match(/data-testid="running-icon-frame"/g)).toHaveLength(1);
	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(2);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toContain("motion-reduce:");
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|style="/i);
	expect(markup).not.toContain("Needs attention");
});

test("running icon draws the shared brand sun rather than its own copy", () => {
	const markup = renderToStaticMarkup(<RunningIcon />);
	expect(markup).toContain(`d="${BRAND_MARK_SEGMENTS.sun}"`);
});
