import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadColors, paletteVar, renderCss, themeColorKeys, validate } from "../../scripts/colors";

/**
 * The colour adoption guard, the sibling of `typographyUsage.test.ts`. Three failure modes shaped it,
 * and all three shipped once:
 *  - a colour class Tailwind never emits (`bg-green`, after its `@theme` entry was deleted). Tailwind
 *    drops an unknown utility SILENTLY, so the element renders with no colour while its class list
 *    claims otherwise — nothing in lint, typecheck or the test suite could see it;
 *  - a CSS variable read from JS that does not exist (`--text-text-muted`, the *class* name spelled
 *    into a `getComputedStyle` call) — it resolves to "" and slides into a fallback;
 *  - a component reaching around the semantic layer for a palette entry (`bg-[var(--input)]`),
 *    which re-couples the component to a colour instead of a role.
 *
 * The palette denylist is DERIVED from `themes/runtime.ts`, so renaming a manifest key updates this
 * guard automatically rather than leaving it asserting yesterday's names.
 */

const SRC = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => path.slice(SRC.length);
/** Comments name classes and variables in order to explain them, which is not a usage. */
const code = (path: string) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

function sourceFiles(dir = SRC, exts = /\.(tsx?|css)$/): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (entry === "generated") continue;
			out.push(...sourceFiles(path, exts));
			continue;
		}
		if (exts.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
	}
	return out;
}

const COLORS = loadColors();
const FILES = sourceFiles();
const TS_FILES = FILES.filter((f) => /\.tsx?$/.test(f));
const CSS_FILES = FILES.filter((f) => f.endsWith(".css"));

const GENERATED_CSS = join(SRC, "styles/generated/colors.css");
const GENERATED_TYPE_CSS = join(SRC, "styles/generated/typography.css");

const THEME_ENTRY = /^\s*--color-([a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/gm;
/** `--color-<name>` in the generated `@theme inline` — exactly the utilities Tailwind will emit. */
const PUBLISHED_TARGET = new Map(
	[...read(GENERATED_CSS).matchAll(THEME_ENTRY)].map(
		(m) => [m[1] as string, m[2] as string] as const,
	),
);
const PUBLISHED = new Set(PUBLISHED_TARGET.keys());

/**
 * Every custom property declared anywhere in our CSS. The generated typography sheet is excluded from
 * the scans below (it is not hand-written) but still DECLARES the `--tr-*` tokens that Monaco, xterm
 * and mermaid read, so it counts here.
 */
const DECLARED_VARS = new Set(
	[...CSS_FILES, GENERATED_CSS, GENERATED_TYPE_CSS].flatMap((f) =>
		[...read(f).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
	),
);
/**
 * Every custom property the theme engine writes at runtime. The UI palette is DERIVED from the manifest
 * key list exactly as `runtime.ts` derives it, so a renamed key updates this guard for free; the ANSI
 * and syntax tables are still literals in `runtime.ts`.
 */
const PALETTE_VARS = new Set([
	...themeColorKeys().map(paletteVar),
	...[...read(join(SRC, "themes/runtime.ts")).matchAll(/"(--[a-z0-9-]+)"/g)].map(
		(m) => m[1] as string,
	),
]);
const ALL_VARS = new Set([...DECLARED_VARS, ...PALETTE_VARS]);

/**
 * Palette names that must never appear as a colour utility. `--primary` is both a palette entry and a
 * published role, so anything already published is excluded — `text-primary` is legal, `text-hint` is
 * not.
 */
const PALETTE_BARE = new Set(
	[...PALETTE_VARS].map((v) => (v as string).slice(2)).filter((n) => !PUBLISHED.has(n)),
);

/**
 * The COMPLETE set of non-colour values that legitimately share a colour-utility prefix: the CSS-wide
 * colour keywords, the directional border shorthands, and a handful of `text-*` / `outline-*` /
 * `ring-*` properties that are not colours at all. Everything else after a colour prefix must be a
 * published token — that is what makes the check below strict rather than heuristic.
 */
const NON_COLOR = new Set([
	"current",
	"transparent",
	"inherit",
	// directional border shorthands and widths: border-t, border-l-2, border-b-0, border-y
	"t",
	"r",
	"b",
	"l",
	"x",
	"y",
	"t-0",
	"b-0",
	"l-2",
	"l-4",
	"collapse",
	"separate",
	// text-align / text-wrap / text-overflow
	"center",
	"left",
	"right",
	"balance",
	"pretty",
	"ellipsis",
	"clip",
	// background-clip: `bg-clip-padding` renders a translucent border against the surrounding surface
	"clip-padding",
	// outline-none, ring-inset
	"none",
	"inset",
]);

// Longest alternative FIRST: with `border` ahead of `border-l`, `border-l-feedback-error` parsed as
// the token `l-feedback-error` and slipped past every check below.
const COLOR_PREFIX =
	"border-[trblxyse]{1,2}|bg|text|border|ring|fill|stroke|divide|outline|decoration|caret|accent|placeholder";
/** A colour-capable utility, with any variant chain stripped: captures the prefix and the token name. */
const UTILITY = new RegExp(
	`(?<![\\w-])(${COLOR_PREFIX})-([a-z][a-z0-9-]*)(/\\d+)?(?![\\w./[-])`,
	"g",
);

interface Use {
	readonly file: string;
	readonly name: string;
	readonly modifier: string | undefined;
	readonly text: string;
}

const USES: Use[] = TS_FILES.flatMap((f) =>
	[...code(f).matchAll(UTILITY)].map((m) => ({
		file: rel(f),
		name: m[2] as string,
		modifier: m[3],
		text: m[0] as string,
	})),
);

describe("the published token set", () => {
	it("points every utility at a variable that exists", () => {
		const dangling = [...PUBLISHED_TARGET.entries()]
			.filter(([, target]) => !ALL_VARS.has(target))
			.map(([name, target]) => `--color-${name} -> ${target}`);
		expect(dangling).toEqual([]);
	});

	it("declares nothing it does not use", () => {
		const used = new Set(USES.map((u) => u.name));
		expect([...PUBLISHED].filter((n) => !used.has(n)).sort()).toEqual([]);
	});

	it("gives every generated role a consumer", () => {
		// A role is either published as a utility or read directly by a non-CSS consumer
		// (Monaco/xterm/mermaid/Shiki/`global.css`). One that is neither is dead weight.
		const roles = [
			...(read(GENERATED_CSS).split("@theme inline")[0] as string).matchAll(
				/^\s*(--[a-z0-9-]+)\s*:/gm,
			),
		].map((m) => m[1] as string);
		const targets = new Set(PUBLISHED_TARGET.values());
		const consumers = FILES.map(code).join("");
		const orphans = roles.filter(
			(v) => !targets.has(v) && !consumers.includes(`var(${v})`) && !consumers.includes(`"${v}"`),
		);
		expect(orphans).toEqual([]);
	});

	it("is regenerated from `colors.json` — the committed output is not stale", () => {
		// The same assertion `bun run colors:check` makes, so a hand-edit of the generated CSS fails
		// here too rather than only at commit time.
		expect(validate(COLORS)).toEqual([]);
		expect(read(GENERATED_CSS)).toBe(renderCss(COLORS));
	});
});

describe("colour at a call site", () => {
	it("never names a palette entry", () => {
		const bad = USES.filter((u) => PALETTE_BARE.has(u.name)).map(
			(u) => `${u.file}: ${u.text} (${u.name} is a palette entry, not a role)`,
		);
		expect(bad).toEqual([]);
	});

	it("names a published token, or nothing that is a colour at all", () => {
		// The strict guard, and the one that matters most. Two failures hide here:
		//  - a token we do not publish (a typo, or a rename that missed a call site) — Tailwind emits
		//    NOTHING and the element renders unstyled while its class list claims otherwise;
		//  - one of Tailwind's own 250+ built-in colours (`bg-red-500`, `text-white`) — which used to
		//    compile into a hardcoded, un-themeable value that no theme could reach. `colors.json`
		//    now resets that namespace, and this check keeps the source honest about it too.
		const bad = USES.filter((u) => !PUBLISHED.has(u.name) && !NON_COLOR.has(u.name)).map(
			(u) => `${u.file}: ${u.text}`,
		);
		expect(bad).toEqual([]);
	});

	it("never reaches a palette entry through an arbitrary value", () => {
		const arbitrary = new RegExp(
			`(?<![\\w-])(?:${COLOR_PREFIX})-\\[[^\\]]*var\\((--[a-z0-9-]+)\\)`,
			"g",
		);
		const bad = TS_FILES.flatMap((f) =>
			[...code(f).matchAll(arbitrary)]
				.filter((m) => !PUBLISHED_TARGET.has((m[1] as string).slice(2)))
				.filter((m) => PALETTE_VARS.has(m[1] as string) || !DECLARED_VARS.has(m[1] as string))
				.map((m) => `${rel(f)}: ${m[0]}`),
		);
		expect(bad).toEqual([]);
	});

	it("never tints with an opacity modifier", () => {
		// Tailwind's `/40` mixes `in oklab` while the tokens mix `in srgb`, so the same nominal
		// percentage rendered two different colours. Tints are tokens on the four-step scale.
		const bad = USES.filter((u) => u.modifier && PUBLISHED.has(u.name)).map(
			(u) => `${u.file}: ${u.text}`,
		);
		expect(bad).toEqual([]);
	});
});

describe("raw colour values", () => {
	/**
	 * The COMPLETE allowlist, now one file: `lib/utils.ts` round-trips colours through a canvas and
	 * needs two literal probes. The effect scrims that used to sit in `themes/runtime.ts` are data in
	 * `colors.json`.
	 */
	const ALLOWLIST = new Set(["lib/utils.ts"]);

	it("appear in no component", () => {
		const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
		const bad = TS_FILES.filter((f) => !ALLOWLIST.has(rel(f)))
			.flatMap((f) =>
				code(f)
					.split("\n")
					.map((line, i) => ({ line, i }))
					.filter(({ line }) => literal.test(line))
					.map(({ line, i }) => `${rel(f)}:${i + 1}: ${line.trim().slice(0, 80)}`),
			)
			.filter((s) => !s.includes('replace("#"'));
		expect(bad).toEqual([]);
	});

	it("appear in no hand-written stylesheet", () => {
		// There is no exception any more: the roles are generated, so a literal in a .css file is a
		// colour that `colors.json` does not know about.
		const bad = CSS_FILES.flatMap((f) =>
			code(f)
				.split("\n")
				.map((line, i) => ({ line, i }))
				.filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line))
				.map(({ line, i }) => `${rel(f)}:${i + 1}: ${line.trim().slice(0, 80)}`),
		);
		expect(bad).toEqual([]);
	});
});

describe("variables read from JavaScript", () => {
	it("all exist", () => {
		// Monaco, xterm and mermaid resolve tokens through `getComputedStyle`; a name that does not
		// exist returns "" and silently takes whatever fallback the call site has.
		const reads = TS_FILES.flatMap((f) =>
			[...code(f).matchAll(/(?:cssVar|cssColorVar|token)\("(--[a-z0-9-]+)"\)/g)].map((m) => ({
				file: rel(f),
				name: m[1] as string,
			})),
		);
		expect(reads.length).toBeGreaterThan(0);
		const bad = reads.filter((r) => !ALL_VARS.has(r.name)).map((r) => `${r.file}: ${r.name}`);
		expect(bad).toEqual([]);
	});

	it("name the semantic layer, not the palette", () => {
		const reads = TS_FILES.filter((f) => rel(f) !== "themes/runtime.ts").flatMap((f) =>
			[...code(f).matchAll(/(?:cssVar|cssColorVar|token)\("(--[a-z0-9-]+)"\)/g)].map((m) => ({
				file: rel(f),
				name: m[1] as string,
			})),
		);
		// The syntax palette (`--code-*`) and the type tokens (`--tr-*`) are their own contracts.
		const bad = reads
			.filter((r) => PALETTE_VARS.has(r.name))
			.filter((r) => !/^--(code|tr)-/.test(r.name))
			.map((r) => `${r.file}: ${r.name}`);
		expect(bad).toEqual([]);
	});
});
