import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";

const SRC = new URL("..", import.meta.url).pathname;
const read = (p: string) => normalizeEol(readFileSync(p, "utf8"));
const rel = (p: string) => p.slice(SRC.length);
const code = (p: string) =>
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
const CSS_FILES = FILES.filter((f) => /\.css$/.test(f));
const TOKENS = join(SRC, "styles/tokens.css");

const SPACING_PREFIX =
	"p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y";
const VARIANT = String.raw`(?:[a-z-]+(?:\[[^\]]*\])?:)*`;

function hits(pattern: RegExp): string[] {
	return TS_FILES.flatMap((f) =>
		code(f)
			.split("\n")
			.flatMap((line, i) => [...line.matchAll(pattern)].map((m) => `${rel(f)}:${i + 1}: ${m[0]}`)),
	);
}

function spaceNominals(): Set<number> {
	const src = read(TOKENS);
	const base = Number.parseFloat(/--space-base:\s*([\d.]+)px/.exec(src)?.[1] ?? "");
	const set = new Set<number>();
	for (const m of src.matchAll(
		/--space-[a-z0-9]+:\s*calc\(\s*var\(--space-base\)\s*\*\s*([\d.]+)\s*\)/g,
	)) {
		set.add(Math.round(base * Number.parseFloat(m[1])));
	}
	return set;
}

const CSS_SPACING_PROP = "(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?";
const CSS_EXEMPT = "space-exempt";

function cssSpacing(): { onScale: string[]; unmarkedOffScale: string[] } {
	const nominals = spaceNominals();
	const declRe = new RegExp(String.raw`(?<![\w-])(${CSS_SPACING_PROP})\s*:\s*([^;{}]+)`, "g");
	const onScale: string[] = [];
	const unmarkedOffScale: string[] = [];
	for (const f of CSS_FILES) {
		read(f)
			.split("\n")
			.forEach((line, i) => {
				const marked = line.includes(CSS_EXEMPT);
				for (const decl of line.matchAll(declRe)) {
					for (const px of decl[2].matchAll(/(-?\d*\.?\d+)px/g)) {
						const n = Math.abs(Number.parseFloat(px[1]));
						const where = `${rel(f)}:${i + 1}: ${decl[1]}: ${px[1]}px`;
						if (nominals.has(n)) onScale.push(where);
						else if (!marked) unmarkedOffScale.push(where);
					}
				}
			});
	}
	return { onScale, unmarkedOffScale };
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

	it("declares no radius step nothing consumes", () => {
		const used = new Set(
			FILES.filter((f) => f !== TOKENS).flatMap((f) =>
				[...code(f).matchAll(/--radius-([a-z0-9]+)/g)].map((m) => m[1] as string),
			),
		);
		const orphans = [...read(TOKENS).matchAll(/^\s*--radius-([a-z0-9]+)\s*:/gm)]
			.map((m) => m[1] as string)
			.filter((step) => !used.has(step));
		expect(orphans).toEqual([]);
	});

	it("declares exactly xs/sm/md/lg, none above 8px", () => {
		const steps = [...read(TOKENS).matchAll(/^\s*--radius-([a-z0-9]+)\s*:\s*(\d+)px\s*;/gm)].map(
			(m) => [m[1] as string, Number(m[2])] as const,
		);
		expect(steps.map(([name]) => name).sort()).toEqual(["lg", "md", "sm", "xs"]);
		expect(steps.filter(([, px]) => px > 8)).toEqual([]);
	});
});

describe("spacing at a call site", () => {
	it("names a scale step, never a raw pixel length", () => {
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}(?:${SPACING_PREFIX})-\[-?[\d.]+px\]`, "g")),
		).toEqual([]);
	});

	it("never reaches a spacing token through an arbitrary value", () => {
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}(?:${SPACING_PREFIX})-\[var\(--space`, "g")),
		).toEqual([]);
	});
});

describe("spacing in handwritten CSS", () => {
	it("names a --space-* token for any value on the scale, never a bare px", () => {
		expect(cssSpacing().onScale).toEqual([]);
	});

	it("allows an off-scale rhythm px only with a documented `space-exempt` marker", () => {
		expect(cssSpacing().unmarkedOffScale).toEqual([]);
	});
});
