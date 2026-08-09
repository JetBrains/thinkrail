import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The site copies the app's font stacks rather than importing them — it is a standalone leaf with no
 * workspace deps (SPEC.md). Copying is only safe if it cannot drift, so this reads the app's source of
 * truth at TEST time (never at build time) and fails when the two disagree. It is also what keeps a
 * font swap in `apps/web` a one-file change: this test names the site as the second place to update.
 */
const CSS = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const TYPOGRAPHY = JSON.parse(
	readFileSync(new URL("../../web/src/styles/typography.json", import.meta.url), "utf8"),
) as {
	fontFamilies: Record<string, { stack: string[]; selfHosted?: string[] } | { $ref: string }>;
};

/** A family from the app's JSON, following the one `$ref` hop the format allows. */
function appFamily(id: string) {
	const entry = TYPOGRAPHY.fontFamilies[id];
	if (!entry) throw new Error(`unknown app font family '${id}'`);
	return "$ref" in entry ? appFamily(entry.$ref) : entry;
}

/** A custom property's value from the site's CSS, as a list of unquoted family names. */
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

	it("aliases the display role onto the interface face, like the app's brand family", () => {
		expect(cssStack("font-display")).toEqual(["var(--font-sans)"]);
	});

	it("bundles the same font packages", () => {
		const imported = [...CSS.matchAll(/@import "([^"]+)";/g)].map((m) => m[1]);
		expect(imported).toEqual([
			...(appFamily("interface").selfHosted ?? []),
			...(appFamily("code").selfHosted ?? []),
		]);
	});

	it("requests no font from a CDN", () => {
		const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
		for (const source of [CSS, html])
			expect(source).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com|api\.fontshare\.com/);
	});
});
