import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured stroke-drawn monogram with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	for (const cls of [
		"loader-t-bar",
		"loader-t-stem",
		"loader-r-tail",
		"loader-r-bowl",
		"loader-r-stem",
		"loader-r-leg",
	])
		expect(markup).toContain(`motion-safe:animate-${cls}`);
	expect(markup.match(/motion-safe:animate-loader-frame/g)).toHaveLength(2);
	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(8);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|style="/i);
	expect(markup).not.toContain("Needs attention");
});

test("two running icons never share a clip path", () => {
	const markup = renderToStaticMarkup(
		<>
			<RunningIcon />
			<RunningIcon />
		</>,
	);
	const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
	expect(ids).toHaveLength(10);
	expect(new Set(ids).size).toBe(10);
	for (const id of ids) expect(markup).toContain(`clip-path="url(#${id})"`);
});
