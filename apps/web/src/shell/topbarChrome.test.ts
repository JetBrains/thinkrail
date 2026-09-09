import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const shellSource = readFileSync(new URL("./Shell.tsx", import.meta.url), "utf8");
const headerStart = shellSource.indexOf("<header");
const headerEnd = shellSource.indexOf("</header>");
const header = shellSource.slice(headerStart, headerEnd);
const jsxTag = (name: string) => new RegExp(`<${name}\\b(?:=>|[^>])*>`, "g");
const openingTag = jsxTag("header").exec(header)?.[0] ?? "";

const classAttribute = (tag: string) => /className="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];

test("the topbar is a fixed-height window-drag region on the topbar row token", () => {
	expect(headerStart).toBeGreaterThanOrEqual(0);
	expect(headerEnd).toBeGreaterThan(headerStart);
	const classes = classAttribute(openingTag);
	expect(classes).toContain("window-drag");
	expect(classes).toContain("select-none");
	expect(classes).toContain("h-topbar-row");
	expect(classes.some((c) => /^py-/.test(c))).toBe(false);
});

test("every button inside the topbar opts out of window dragging", () => {
	const buttons = [...header.matchAll(jsxTag("button"))].map((m) => m[0]);
	expect(buttons.length).toBeGreaterThan(0);
	for (const button of buttons) expect(classAttribute(button)).toContain("window-no-drag");
});

test("the topbar reserves host-published window-chrome insets at both edges through width tokens", () => {
	for (const edge of ["left", "right"]) {
		const spacer = [...header.matchAll(jsxTag("div"))]
			.map((m) => m[0])
			.find((tag) => tag.includes(`data-testid="window-chrome-inset-${edge}"`));
		expect(spacer).toContain('aria-hidden="true"');
		expect(spacer).toBeDefined();
		expect(classAttribute(spacer ?? "")).toContain(`w-window-chrome-inset-${edge}`);
	}
});
