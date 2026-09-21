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
	expect(openingTag).toContain('data-testid="topbar"');
	expect(classes).toContain("window-drag");
	expect(classes).toContain("min-w-0");
	expect(classes).toContain("select-none");
	expect(classes).toContain("h-topbar-row");
	expect(classes.some((c) => /^py-/.test(c))).toBe(false);
});

test("the trailing topbar action cluster owns the no-drag boundary", () => {
	const actionOpenings = [...header.matchAll(/<div\b[^>]*data-testid="topbar-actions"[^>]*>/g)];
	expect(actionOpenings).toHaveLength(1);
	const actionOpening = actionOpenings[0];
	if (!actionOpening || actionOpening.index === undefined)
		throw new Error("missing action cluster");
	expect(classAttribute(actionOpening[0])).toEqual(
		expect.arrayContaining(["window-no-drag", "ml-auto"]),
	);
	const openingEnd = actionOpening.index + actionOpening[0].length;
	let depth = 1;
	let closeStart: number | undefined;
	const divTags = /<\/?div\b[^>]*>/g;
	divTags.lastIndex = openingEnd;
	for (const match of header.matchAll(divTags)) {
		if (match.index === undefined) continue;
		if (match[0].startsWith("</div")) {
			depth -= 1;
			if (depth === 0) {
				closeStart = match.index;
				break;
			}
		} else if (!match[0].endsWith("/>") && !match[0].endsWith(" />")) {
			depth += 1;
		}
	}
	expect(closeStart).toBeDefined();
	const buttons = [...header.matchAll(/<button\b/g)];
	expect(buttons.length).toBeGreaterThan(0);
	for (const button of buttons) {
		expect(button.index).toBeGreaterThanOrEqual(openingEnd);
		expect(button.index).toBeLessThan(closeStart ?? -1);
	}
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
