import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The colour adoption guard, the sibling of `typographyUsage.test.ts`. Three failure modes shaped it,
 * and all three shipped once:
 *  - a colour class Tailwind never emits (`bg-green`, after its `@theme` entry was deleted). Tailwind
 *    drops an unknown utility SILENTLY, so the element renders with no colour while its class list
 *    claims otherwise — nothing in lint, typecheck or the test suite could see it;
 *  - a CSS variable read from JS that does not exist (`--text-text-muted`, the *class* name spelled
 *    into a `getComputedStyle` call) — it resolves to "" and slides into a fallback;
 *  - a component reaching around the semantic layer for a palette entry (`bg-[var(--input-bg)]`),
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

const FILES = sourceFiles();
const TS_FILES = FILES.filter((f) => /\.tsx?$/.test(f));
const CSS_FILES = FILES.filter((f) => f.endsWith(".css"));

const INDEX_CSS = join(SRC, "index.css");
const TOKENS_CSS = join(SRC, "styles/tokens.css");
const RUNTIME_TS = join(SRC, "themes/runtime.ts");

/** `--color-<name>` in `@theme inline` — exactly the colour utilities Tailwind will emit. */
const PUBLISHED = new Set(
	[...read(INDEX_CSS).matchAll(/^\s*--color-([a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/gm)].map(
		(m) => m[1] as string,
	),
);
/** …and the semantic variable each one points at. */
const PUBLISHED_TARGET = new Map(
	[...read(INDEX_CSS).matchAll(/^\s*--color-([a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/gm)].map(
		(m) => [m[1] as string, m[2] as string] as const,
	),
);

/**
 * Every custom property declared anywhere in our CSS. The generated typography sheet is excluded from
 * the scans below (it is not hand-written) but still DECLARES the `--tr-*` tokens that Monaco, xterm
 * and mermaid read, so it counts here.
 */
const GENERATED_CSS = join(SRC, "styles/generated/typography.css");
const DECLARED_VARS = new Set(
	[...CSS_FILES, GENERATED_CSS].flatMap((f) =>
		[...read(f).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
	),
);
/** Every custom property the theme engine writes at runtime (palette + ANSI + syntax + effects). */
const PALETTE_VARS = new Set([...read(RUNTIME_TS).matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]));
const ALL_VARS = new Set([...DECLARED_VARS, ...PALETTE_VARS]);

/**
 * Palette names that must never appear as a colour utility. `--primary` is both a palette entry and a
 * published role, so anything already published is excluded — `text-primary` is legal, `text-hint` is
 * not.
 */
const PALETTE_BARE = new Set(
	[...PALETTE_VARS].map((v) => (v as string).slice(2)).filter((n) => !PUBLISHED.has(n)),
);

/** The first segment of every published token — `text`, `container`, `feedback`, `primary`, … */
const FAMILIES = new Set([...PUBLISHED].map((n) => n.split("-")[0] as string));

const COLOR_PREFIX =
	"bg|text|border|border-[trblxyse]{1,2}|ring|fill|stroke|divide|outline|decoration|caret|accent|placeholder";
/** A colour-capable utility, with any variant chain stripped: captures the prefix and the token name. */
const UTILITY = new RegExp(
	`(?<![\\w-])(${COLOR_PREFIX})-([a-z][a-z0-9-]*)(/\\d+)?(?![\\w./-])`,
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

	it("keeps `tokens.css` and `@theme inline` in step", () => {
		// Every semantic token is either published as a utility or read by a non-CSS consumer
		// (Monaco/xterm/mermaid/Shiki/`global.css`). One that is neither is dead weight.
		const semantic = read(TOKENS_CSS).split("Semantic Color Tokens")[1] as string;
		const declared = [...semantic.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)]
			.map((m) => m[1] as string)
			.filter((v) => !/^--(space|radius|transition)/.test(v));
		const targets = new Set(PUBLISHED_TARGET.values());
		const consumers = FILES.filter((f) => f !== TOKENS_CSS)
			.map(code)
			.join("");
		const orphans = declared.filter(
			(v) => !targets.has(v) && !consumers.includes(`var(${v})`) && !consumers.includes(`"${v}"`),
		);
		expect(orphans).toEqual([]);
	});
});

describe("colour at a call site", () => {
	it("never names a palette entry", () => {
		const bad = USES.filter((u) => PALETTE_BARE.has(u.name)).map(
			(u) => `${u.file}: ${u.text} (${u.name} is a palette entry, not a role)`,
		);
		expect(bad).toEqual([]);
	});

	it("never names a token the theme does not publish", () => {
		// The silent-drop guard: a suffix inside one of our families must resolve exactly, or Tailwind
		// emits nothing and the element renders unstyled.
		const bad = USES.filter(
			(u) => FAMILIES.has(u.name.split("-")[0] as string) && !PUBLISHED.has(u.name),
		).map((u) => `${u.file}: ${u.text}`);
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
	 * The COMPLETE allowlist. `lib/utils.ts` round-trips colours through a canvas and needs two literal
	 * probes; `themes/runtime.ts` holds the appearance-level effect scrims.
	 */
	const ALLOWLIST = new Set(["lib/utils.ts", "themes/runtime.ts"]);

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

	it("appear in no stylesheet outside the token layer", () => {
		const bad = CSS_FILES.filter((f) => f !== TOKENS_CSS)
			.flatMap((f) =>
				code(f)
					.split("\n")
					.map((line, i) => ({ line, i }))
					.filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line))
					.map(({ line, i }) => `${rel(f)}:${i + 1}: ${line.trim().slice(0, 80)}`),
			)
			.filter((s) => !s.startsWith("styles/generated/"));
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
			.filter((r) => !/^--(code|tr)-/.test(r.name) && r.name !== "--primary")
			.map((r) => `${r.file}: ${r.name}`);
		expect(bad).toEqual([]);
	});
});
