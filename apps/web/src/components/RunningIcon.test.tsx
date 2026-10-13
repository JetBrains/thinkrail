import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured stroke-drawn monogram with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	// Logo strokes + split frame animation classes
	for (const cls of [
		"loader-fa",
		"loader-fb",
		"loader-s1",
		"loader-s2",
		"loader-a1",
		"loader-c3",
		"loader-c2",
		"loader-b1",
	])
		expect(markup).toContain(`motion-safe:animate-${cls}`);
	// 6 logo strokes + 2 frame halves = 8 stroke="currentColor"
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
	// 5 clip paths per icon × 2 icons = 10 total
	expect(ids).toHaveLength(10);
	expect(new Set(ids).size).toBe(10);
	for (const id of ids) expect(markup).toContain(`clip-path="url(#${id})"`);
});
