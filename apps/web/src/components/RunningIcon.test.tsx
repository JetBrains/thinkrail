import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BRAND_MARK_PATH } from "../constants/branding";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled brand badge with a reduced-motion static fallback", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	expect(markup).toContain(`d="${BRAND_MARK_PATH}"`);
	expect(markup).toContain("motion-safe:animate-working-train");
	expect(markup.match(/motion-safe:animate-working-signal/g)).toHaveLength(6);
	expect(markup.match(/\[--signal-delay:-[\d.]+s\]/g)).toHaveLength(5);
	expect(markup.match(/motion-reduce:hidden/g)).toHaveLength(2);
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|style="/i);
	expect(markup).not.toContain("Needs attention");
});

test("two running icons never share a tail gradient", () => {
	const markup = renderToStaticMarkup(
		<>
			<RunningIcon />
			<RunningIcon />
		</>,
	);
	const ids = [...markup.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
	expect(ids).toHaveLength(2);
	expect(new Set(ids).size).toBe(2);
	for (const id of ids) expect(markup).toContain(`stroke="url(#${id})"`);
});
