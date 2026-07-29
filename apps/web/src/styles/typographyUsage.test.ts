import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadTypography, proseRootClassName } from "../../scripts/typography";

/**
 * The adoption guard: components may not re-declare typography that a generated semantic style already
 * owns, and both markdown surfaces must use the one shared prose system. These are the checks that keep
 * the JSON authoritative over time — a new arbitrary size or a per-surface prose selector fails here.
 */

const typography = loadTypography();
const SRC = new URL("..", import.meta.url).pathname;

/** Every source file the UI ships, minus the generated CSS and the tests themselves. */
function sourceFiles(dir = SRC): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (entry === "generated") continue;
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(path);
	}
	return out;
}
const FILES = sourceFiles();
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 5);

/**
 * The COMPLETE allowlist of files allowed to declare typography outside the generated classes: the
 * mapping layers, and the three third-party integrations that configure their own text rendering.
 */
const PRIMITIVE_ALLOWLIST = new Set([
	"index.css",
	"styles/tokens.css",
	"styles/global.css",
	"styles/fonts.css",
	"panels/monacoSetup.ts",
	"panels/TerminalInstance.tsx",
	"chat/tools/visualize/mermaid.ts",
]);

describe("component usage", () => {
	it("has no arbitrary font-size or leading values", () => {
		const offenders: string[] = [];
		for (const path of FILES) {
			if (PRIMITIVE_ALLOWLIST.has(rel(path))) continue;
			for (const m of read(path).matchAll(/(?<![-\w])(text-\[[^\]]+\]|leading-\[[^\]]+\])/g))
				offenders.push(`${rel(path)}: ${m[1]}`);
		}
		expect(offenders).toEqual([]);
	});

	it("has no direct font-family declarations", () => {
		const offenders: string[] = [];
		for (const path of FILES) {
			if (PRIMITIVE_ALLOWLIST.has(rel(path))) continue;
			const src = read(path);
			for (const m of src.matchAll(/font-\[var\(--font[a-z-]*\)\]|font-\(family-name:--[a-z-]+\)/g))
				offenders.push(`${rel(path)}: ${m[0]}`);
			if (/\bfont-family:/.test(src)) offenders.push(`${rel(path)}: font-family declaration`);
		}
		expect(offenders).toEqual([]);
	});

	it("has no retired typography utilities", () => {
		const retired = /(?<![-\w])(text-mono|text-base-mono|text-brand|text-md|text-lg)(?![-\w])/g;
		const offenders: string[] = [];
		for (const path of FILES) {
			if (PRIMITIVE_ALLOWLIST.has(rel(path))) continue;
			for (const m of read(path).matchAll(retired)) offenders.push(`${rel(path)}: ${m[1]}`);
		}
		expect(offenders).toEqual([]);
	});

	it("has no composed typography (weight/tracking/transform next to a size)", () => {
		const offenders: string[] = [];
		for (const path of FILES) {
			if (PRIMITIVE_ALLOWLIST.has(rel(path))) continue;
			for (const m of read(path).matchAll(
				/(?<![-\w])(font-(?:medium|semibold|bold|extrabold)|tracking-[a-z]+)(?![-\w])/g,
			))
				offenders.push(`${rel(path)}: ${m[1]}`);
		}
		expect(offenders).toEqual([]);
	});
});

describe("shared markdown prose", () => {
	const chat = read(join(SRC, "chat/Markdown.tsx"));
	const preview = read(join(SRC, "panels/MarkdownPreview.tsx"));
	const root = proseRootClassName(typography);

	it("is used by both markdown surfaces", () => {
		expect(chat).toContain(root);
		expect(preview).toContain(root);
	});

	it("leaves no per-surface prose typography selectors", () => {
		// `[&_h1]:text-…`-style typography overrides are what the shared system replaces.
		const perElementType =
			/\[&[^\]]*\]:(?:text-(?!primary|muted|hint|text|balance|pretty|left|center|right)|font-|leading-|tracking-)/g;
		for (const [label, src] of [
			["chat/Markdown.tsx", chat],
			["panels/MarkdownPreview.tsx", preview],
		] as const)
			expect(
				[...src.matchAll(perElementType)].map((m) => m[0]),
				label,
			).toEqual([]);
	});

	it("defines the prose hierarchy only in the JSON", () => {
		expect(typography.proseStyles.h1).toMatchObject({ fontSize: "s18", fontWeight: "semibold" });
		expect(typography.proseStyles.h2).toMatchObject({ fontSize: "s14", fontWeight: "semibold" });
		expect(typography.proseStyles.h3).toMatchObject({ fontSize: "s12", fontWeight: "semibold" });
		expect(typography.proseStyles.h4).toMatchObject({ fontSize: "s12", fontWeight: "medium" });
		expect(typography.proseStyles.h5).toMatchObject({ fontSize: "s12", fontWeight: "medium" });
		expect(typography.proseStyles.h6).toMatchObject({
			fontSize: "s10",
			fontWeight: "medium",
			textTransform: "uppercase",
			letterSpacing: "wide",
		});
		expect(typography.proseStyles.inlineCode).toMatchObject({
			fontFamily: "code",
			fontSize: "s13",
		});
		expect(typography.proseStyles.codeBlock).toMatchObject({ fontFamily: "code", fontSize: "s11" });
		expect(typography.proseStyles.tableBody).toMatchObject({
			fontSize: "s12",
			fontWeight: "regular",
		});
		expect(typography.proseStyles.tableHeader).toMatchObject({
			fontSize: "s12",
			fontWeight: "semibold",
		});
	});
});
