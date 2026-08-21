import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const TYPOGRAPHY = JSON.parse(
	readFileSync(new URL("../../web/src/styles/typography.json", import.meta.url), "utf8"),
) as {
	fontFamilies: Record<string, { stack: string[]; selfHosted?: string[] } | { $ref: string }>;
};

function appFamily(id: string) {
	const entry = TYPOGRAPHY.fontFamilies[id];
	if (!entry) throw new Error(`unknown app font family '${id}'`);
	return "$ref" in entry ? appFamily(entry.$ref) : entry;
}

function cssStack(name: string): string[] {
	const match = CSS.match(new RegExp(`--${name}:([^;]*);`));
	if (!match) throw new Error(`--${name} is not declared in styles.css`);
	return (match[1] as string).split(",").map((f) => f.trim().replace(/^"|"$/g, ""));
}

describe("site fonts match the app", () => {
	it("declares the same stacks", () => {
		expect(cssStack("font-sans")).toEqual(appFamily("interface").stack);
		expect(cssStack("font-mono")).toEqual(appFamily("code").stack);
	});

	it("uses the app's brand display face for the display role", () => {
		expect(cssStack("font-display")).toEqual(appFamily("brand").stack);
	});

	it("bundles the app's interface, code and brand font packages", () => {
		const imported = [...CSS.matchAll(/@import "([^"]+)";/g)].map((m) => m[1]);
		expect(imported).toEqual([
			...(appFamily("interface").selfHosted ?? []),
			...(appFamily("code").selfHosted ?? []),
			...(appFamily("brand").selfHosted ?? []),
		]);
	});

	it("requests no font from a CDN", () => {
		const html = readFileSync(new URL("./pages/index.astro", import.meta.url), "utf8");
		for (const source of [CSS, html])
			expect(source).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com|api\.fontshare\.com/);
	});
});
