import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";

const SRC = new URL("..", import.meta.url).pathname;
const read = (p: string) => normalizeEol(readFileSync(p, "utf8"));
const rel = (p: string) => p.slice(SRC.length);
const sourceWithoutComments = (p: string) =>
	read(p)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

function sourceFiles(dir = SRC): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (entry === "generated") continue;
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
	}
	return out;
}

const FILES = sourceFiles();
const TS_FILES = FILES.filter((f) => /\.tsx?$/.test(f));
const TOKENS = join(SRC, "styles/tokens.css");
const SPACING_JSON = join(SRC, "styles/spacing.json");

const STEPS = new Set(
	Object.keys((JSON.parse(read(SPACING_JSON)) as { steps: Record<string, string> }).steps),
);
const SPACING_PREFIX =
	"px|py|pt|pb|pl|pr|ps|pe|p|mx|my|mt|mb|ml|mr|ms|me|m|gap-x|gap-y|gap|space-x|space-y";
const VARIANT = String.raw`(?:[a-z-]+(?:\[[^\]]*\])?:)*`;
const ARBITRARY_SPACING_EXEMPT = new Set([
	"pr-[2rem]",
	"pl-[1.6em]",
	"pl-[calc(0.875rem+var(--space-8))]",
	"pl-[calc(1.125rem+var(--space-8))]",
]);

function allowsSpacingSuffix(prefix: string, suffix: string): boolean {
	if (/^\d/.test(suffix)) return STEPS.has(suffix);
	if (suffix === "px") return true;
	if (suffix === "auto") return prefix.startsWith("m");
	return suffix === "reverse" && (prefix === "space-x" || prefix === "space-y");
}

function hits(
	pattern: RegExp,
	include: (match: RegExpMatchArray) => boolean = () => true,
): string[] {
	return TS_FILES.flatMap((f) =>
		sourceWithoutComments(f)
			.split("\n")
			.flatMap((line, i) =>
				[...line.matchAll(pattern)].filter(include).map((m) => `${rel(f)}:${i + 1}: ${m[0]}`),
			),
	);
}

const sourceWithoutCommentsPreservingLines = (p: string) =>
	read(p)
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/^[ \t]*\/\/.*$/gm, "");

const CSS_RHYTHM_PROP =
	/(?<![\w-])(gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?)\s*:\s*([^;{}]+)/g;

const CSS_RHYTHM_EXEMPT = new Set(["padding-left: 10px", "margin-left: -10px"]);

function isCanonicalCssRhythmValue(value: string): boolean {
	return value.split(/\s+/).every((part) => {
		if (part === "0" || part === "auto") return true;
		const token = /^var\(--space-((?:0|[1-9][0-9]*))\)$/.exec(part)?.[1];
		return token !== undefined && STEPS.has(token);
	});
}

function cssRhythmHits(): string[] {
	return FILES.flatMap((f) => {
		const source = sourceWithoutCommentsPreservingLines(f);
		return [...source.matchAll(CSS_RHYTHM_PROP)].flatMap((match) => {
			const property = match[1] as string;
			const value = (match[2] ?? "").trim().replace(/\s+/g, " ");
			const declaration = `${property}: ${value}`;
			if (CSS_RHYTHM_EXEMPT.has(declaration) || isCanonicalCssRhythmValue(value)) return [];
			const line = source.slice(0, match.index ?? 0).split("\n").length;
			return [`${rel(f)}:${line}: ${declaration}`];
		});
	});
}

describe("radius at a call site", () => {
	it("names a --radius-* token, never a raw length", () => {
		expect(hits(/\brounded(?:-[a-z]+)?-\[(?!var\(--radius-)[^\]]+\]/g)).toEqual([]);
	});

	it("uses only radius steps the token file declares", () => {
		const declared = new Set(
			[...read(TOKENS).matchAll(/^\s*--radius-([a-z0-9]+)\s*:/gm)].map((m) => m[1]),
		);
		const unknown = hits(/\brounded(?:-[a-z]+)?-\[var\(--radius-([a-z0-9]+)\)\]/g).filter(
			(h) => !declared.has(h.slice(h.lastIndexOf("--radius-") + 9, h.lastIndexOf(")"))),
		);
		expect(unknown).toEqual([]);
	});

	it("keeps exactly the xs/sm/md/lg primitive family capped at 8px", () => {
		const declared = Object.fromEntries(
			[...read(TOKENS).matchAll(/^\s*--radius-([a-z0-9]+)\s*:\s*([\d.]+)px;/gm)].map(
				([, step, value]) => [step, Number(value)],
			),
		);
		expect(declared).toEqual({ xs: 2, sm: 4, md: 6, lg: 8 });
	});

	it("declares no radius step nothing consumes", () => {
		const used = new Set(
			FILES.filter((f) => f !== TOKENS).flatMap((f) =>
				[...sourceWithoutComments(f).matchAll(/--radius-([a-z0-9]+)/g)].map((m) => m[1] as string),
			),
		);
		const orphans = [...read(TOKENS).matchAll(/^\s*--radius-([a-z0-9]+)\s*:/gm)]
			.map((m) => m[1] as string)
			.filter((step) => !used.has(step));
		expect(orphans).toEqual([]);
	});
});

describe("spacing at a call site", () => {
	it("keeps bare suffix keywords prefix-specific", () => {
		expect(allowsSpacingSuffix("p", "8")).toBe(true);
		expect(allowsSpacingSuffix("ml", "auto")).toBe(true);
		expect(allowsSpacingSuffix("gap", "px")).toBe(true);
		expect(allowsSpacingSuffix("space-x", "reverse")).toBe(true);
		expect(allowsSpacingSuffix("p", "bananas")).toBe(false);
		expect(allowsSpacingSuffix("p", "auto")).toBe(false);
		expect(allowsSpacingSuffix("gap", "full")).toBe(false);
	});

	it("names a canonical spacing step or a prefix-appropriate keyword", () => {
		const bad = hits(
			new RegExp(String.raw`(?<![\w-])${VARIANT}-?(${SPACING_PREFIX})-([a-z0-9.]+)`, "g"),
			(match) => !allowsSpacingSuffix(match[1] ?? "", match[2] ?? ""),
		);
		expect(bad).toEqual([]);
	});

	it("never spells a spacing length as a raw pixel value", () => {
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[-?[\d.]+px\]`, "g")),
		).toEqual([]);
	});

	it("never re-spells a step through a --space arbitrary value", () => {
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[var\(--space`, "g")),
		).toEqual([]);
	});

	it("limits arbitrary spacing utilities to documented geometry constraints", () => {
		const bad = hits(
			new RegExp(
				String.raw`(?<![\w-])${VARIANT}(-?(?:${SPACING_PREFIX})-(?:\[[^\]]+\]|\(--[^)]+\)))`,
				"g",
			),
			(match) => !ARBITRARY_SPACING_EXEMPT.has(match[1] ?? ""),
		);
		expect(bad).toEqual([]);
	});

	it("keeps reserved primitives canonical and unspent by rhythm call sites", () => {
		const reserved = ["32", "40", "64"];
		for (const step of reserved) expect(STEPS.has(step)).toBe(true);
		expect([...STEPS].every((step) => /^(?:0|[1-9]\d*)$/.test(step))).toBe(true);
		expect(
			hits(
				new RegExp(
					String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-(?:${reserved.join("|")})\b`,
					"g",
				),
			),
		).toEqual([]);
	});
});

describe("container-width presets are not spacing", () => {
	const SIZING = ["w", "min-w", "max-w", "h", "min-h", "max-h", "size", "basis"];
	const CONTAINER = "3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl";

	it("never lets the spacing gate police a width/sizing utility", () => {
		expect(SIZING.filter((p) => SPACING_PREFIX.split("|").includes(p))).toEqual([]);
	});

	it("keeps Tailwind container presets as named width utilities", () => {
		const named = new Set(
			hits(new RegExp(String.raw`(?<![\w-])(?:${SIZING.join("|")})-(?:${CONTAINER})\b`, "g")).map(
				(h) => h.slice(h.lastIndexOf(" ") + 1),
			),
		);
		for (const preset of ["max-w-lg", "max-w-sm"]) expect(named.has(preset)).toBe(true);
	});
});

describe("spacing in handwritten CSS", () => {
	it("recognizes multiline declarations and validates their complete values", () => {
		const source = "padding:\n  1rem;\nmargin: var(--not-a-space-token);";
		const values = [...source.matchAll(CSS_RHYTHM_PROP)].map((match) =>
			(match[2] ?? "").trim().replace(/\s+/g, " "),
		);
		expect(values).toEqual(["1rem", "var(--not-a-space-token)"]);
		expect(values.map(isCanonicalCssRhythmValue)).toEqual([false, false]);
		expect(isCanonicalCssRhythmValue("var(--space-8) 0 auto")).toBe(true);
	});

	it("uses canonical spacing tokens in CSS and CSS string literals", () => {
		expect(cssRhythmHits()).toEqual([]);
	});
});
