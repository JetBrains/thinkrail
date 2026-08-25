import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";

// The radius + spacing adoption guard (sibling of colorUsage/typographyUsage). An off-scale length
// always RENDERS, so its drift is invisible in review and every other gate — hence this gate. The
// contract it enforces (canonical numeric scale, number=px, bans, sizing out of scope, handwritten-CSS
// rhythm coverage, bracket escape hatch) lives in src/styles/SPACING.md (web-spacing).

const SRC = new URL("..", import.meta.url).pathname;
const read = (p: string) => normalizeEol(readFileSync(p, "utf8"));
const rel = (p: string) => p.slice(SRC.length);
// Strip comments: they name utilities to explain them, which is not a usage.
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
const SPACING_JSON = join(SRC, "styles/spacing.json");

/** The canonical steps, read from the single source so the gate and the tokens cannot drift. */
const STEPS = new Set(
	Object.keys((JSON.parse(read(SPACING_JSON)) as { steps: Record<string, string> }).steps),
);
const TSHIRT = new Set(["xs", "sm", "md", "lg", "xl"]);

// The spacing (rhythm) utilities — NOT sizing, which shares the base. Longest-first so `gap-x` matches
// before `gap`. A responsive/state prefix (`sm:`, `hover:`) may precede any of them.
const SPACING_PREFIX =
	"px|py|pt|pb|pl|pr|ps|pe|p|mx|my|mt|mb|ml|mr|ms|me|m|gap-x|gap-y|gap|space-x|space-y";
const VARIANT = String.raw`(?:[a-z-]+(?:\[[^\]]*\])?:)*`;

function hits(pattern: RegExp): string[] {
	return TS_FILES.flatMap((f) =>
		code(f)
			.split("\n")
			.flatMap((line, i) => [...line.matchAll(pattern)].map((m) => `${rel(f)}:${i + 1}: ${m[0]}`)),
	);
}

// Strip block comments to spaces but KEEP newlines, so a reported CSS line stays true and prose
// (`A 6px status circle`) is never a false positive.
const cssCode = (p: string) =>
	read(p).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// Rhythm PROPERTIES only — the CSS twins of `p`/`m`/`gap`. Sizing/coordinates/box-shadow offsets are
// geometry, not rhythm, and excluded (as the utility scan excludes `w`/`h`). Must open the declaration.
const CSS_RHYTHM_PROP =
	/^\s*(gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?)\s*:\s*([^;{}]+)/;
const RAW_PX = /-?\d*\.?\d+px/;

// Documented non-rhythm geometry kept raw on a rhythm property (see SPACING.md): the `.review-region`
// rail pair, an equal-and-opposite optical offset that adds zero layout shift.
const CSS_RHYTHM_EXEMPT = new Set(["padding-left: 10px", "margin-left: -10px"]);

function cssRhythmHits(): string[] {
	return CSS_FILES.flatMap((f) =>
		cssCode(f)
			.split("\n")
			.flatMap((line, i) => {
				const m = CSS_RHYTHM_PROP.exec(line);
				if (!m) return [];
				const value = m[2].trim();
				if (!RAW_PX.test(value)) return [];
				const decl = `${m[1]}: ${value}`;
				return CSS_RHYTHM_EXEMPT.has(decl) ? [] : [`${rel(f)}:${i + 1}: ${decl}`];
			}),
	);
}

describe("radius at a call site", () => {
	it("names a --radius-* token, never a raw length", () => {
		// `rounded-full` (a pill, not a step) stays fine; `rounded-[9px]` does not.
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
		// Must EXCLUDE `tokens.css`, or each step's own declaration counts as its consumer and the check is
		// vacuous.
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
});

describe("spacing at a call site", () => {
	it("names a canonical spacing step, never a t-shirt alias or off-scale number", () => {
		// `p-8`/`gap-4` pass; t-shirt aliases and off-scale numbers (`p-6`, `py-1`, `gap-0.5`) do not.
		// Keyword suffixes (`auto`, `px`, `full`) and the bracket escape hatch are not bare suffixes here.
		const bad = hits(
			new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-([a-z0-9.]+)`, "g"),
		).filter((h) => {
			const suffix = h.slice(h.lastIndexOf("-") + 1);
			if (TSHIRT.has(suffix)) return true;
			if (/^\d/.test(suffix)) return !STEPS.has(suffix);
			return false;
		});
		expect(bad).toEqual([]);
	});

	it("never spells a spacing length as a raw pixel value", () => {
		// Bans only a bare `px` length in the brackets (`py-[3px]`); measured `rem`/`em`/`calc` stay.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[-?[\d.]+px\]`, "g")),
		).toEqual([]);
	});

	it("never re-spells a step through a --space arbitrary value", () => {
		// Bans only the DIRECT `-[var(--space…` re-spelling of a step; composed indents
		// (`pl-[calc(…+var(--space-8))]`) are fine.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[var\(--space`, "g")),
		).toEqual([]);
	});

	it("treats the scale as a DEFINED primitive set — a step may exist with no consumers", () => {
		// No orphan/reachability check on purpose: reserved primitives (`32`/`40`/`64`) exist ahead of use.
		for (const step of ["32", "40", "64"]) expect(STEPS.has(step)).toBe(true);
		expect([...STEPS].every((step) => /^\d+$/.test(step))).toBe(true);
	});
});

describe("spacing in handwritten CSS", () => {
	it("spends a --space-* token on every rhythm property, never a raw pixel length", () => {
		// A rhythm length in CSS must be a `--space-*` token (or `0`/`auto`); only `CSS_RHYTHM_EXEMPT` stays raw.
		expect(cssRhythmHits()).toEqual([]);
	});
});
