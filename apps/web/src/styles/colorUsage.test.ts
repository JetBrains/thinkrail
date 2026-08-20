import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadColors, paletteVar, renderCss, themeColorKeys, validate } from "../../scripts/colors";
import { normalizeEol } from "../../scripts/generatedFiles";

const SRC = new URL("..", import.meta.url).pathname;
const read = (path: string) => normalizeEol(readFileSync(path, "utf8"));
const rel = (path: string) => path.slice(SRC.length);
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
const PUBLISHED_TARGET = new Map(
	[...read(GENERATED_CSS).matchAll(THEME_ENTRY)].map(
		(m) => [m[1] as string, m[2] as string] as const,
	),
);
const PUBLISHED = new Set(PUBLISHED_TARGET.keys());

const DECLARED_VARS = new Set(
	[...CSS_FILES, GENERATED_CSS, GENERATED_TYPE_CSS].flatMap((f) =>
		[...read(f).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
	),
);
const PALETTE_VARS = new Set([
	...themeColorKeys().map(paletteVar),
	...[...read(join(SRC, "themes/runtime.ts")).matchAll(/"(--[a-z0-9-]+)"/g)].map(
		(m) => m[1] as string,
	),
]);
const ALL_VARS = new Set([...DECLARED_VARS, ...PALETTE_VARS]);

const PALETTE_BARE = new Set(
	[...PALETTE_VARS].map((v) => (v as string).slice(2)).filter((n) => !PUBLISHED.has(n)),
);

const NON_COLOR = new Set([
	"current",
	"transparent",
	"inherit",
	"t",
	"r",
	"b",
	"l",
	"x",
	"y",
	"t-0",
	"b-0",
	"l-2",
	"r-2",
	"l-4",
	"collapse",
	"separate",
	"center",
	"left",
	"right",
	"balance",
	"pretty",
	"ellipsis",
	"clip",
	"clip-padding",
	"none",
	"inset",
]);

const COLOR_PREFIX =
	"border-[trblxyse]{1,2}|bg|text|border|ring|fill|stroke|divide|outline|decoration|caret|accent|placeholder";
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
		const bad = USES.filter((u) => u.modifier && PUBLISHED.has(u.name)).map(
			(u) => `${u.file}: ${u.text}`,
		);
		expect(bad).toEqual([]);
	});
});

describe("raw colour values", () => {
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
		const bad = reads
			.filter((r) => PALETTE_VARS.has(r.name))
			.filter((r) => !/^--(code|tr)-/.test(r.name))
			.map((r) => `${r.file}: ${r.name}`);
		expect(bad).toEqual([]);
	});
});
