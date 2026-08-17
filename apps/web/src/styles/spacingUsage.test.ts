import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";

/**
 * The SHAPE + SPACING adoption guard — the third sibling of `colorUsage.test.ts` and
 * `typographyUsage.test.ts`. Colour, typography, radius and spacing each have a JSON/token source and a
 * usage guard that fails on drift; unlike a colour utility, an off-scale length always RENDERS, so its
 * drift is invisible in review and in every other gate.
 *
 * SPACING IS ONE CANONICAL NUMERIC VOCABULARY. `styles/spacing.json` declares the steps — `0`, `2`,
 * `4`, `8`, `12`, `16`, `24` — where the step name IS its pixel value. Every `p`/`m`/`gap` utility must
 * spend one of those steps (`p-8`, `gap-4`, `py-12`); the value flows from `--spacing: 1px` in
 * `generated/spacing.css`, which makes a bare number resolve to that many pixels and replaces Tailwind's
 * built-in 0.25rem base — so nothing falls back to Tailwind's own numeric scale.
 *
 * What is banned:
 *  - the legacy t-shirt aliases (`p-xs`, `gap-sm`, …) — they no longer exist;
 *  - any OFF-SCALE number on a spacing utility (`p-6`, `py-1`, `gap-0.5`) — it lands between steps, so
 *    the next person copies it instead of the step it was reaching for;
 *  - a raw pixel length at the call site (`py-[3px]`) — belongs to no scale;
 *  - re-spelling a step through an arbitrary value (`p-[var(--space-8)]` / `p-[8px]`) — the numeric
 *    utility is the one way to name it.
 *
 * SIZING IS OUT OF SCOPE HERE, deliberately. Tailwind v4 shares the `--spacing` base between spacing
 * and sizing, so `w`/`h`/`size`/inset/translate also resolve as number = px — but which px a box is is a
 * layout constraint, not rhythm, and is not policed by this gate.
 *
 * A LENGTH THAT IS NOT A SCALE STEP IS STILL ALLOWED on a spacing utility through the BRACKET escape
 * hatch, for measured/optical/geometry values that are not rhythm: `pr-[2rem]` (a close-button reserve),
 * `pl-[1.6em]` (an em-relative list indent) and `pl-[calc(0.875rem+var(--space-8))]` (an icon-aligned
 * indent) are constraints, not steps. Only the bare-suffix form of a spacing utility is policed, and the
 * two arbitrary forms that re-spell a step (`[<n>px]`, `[var(--space…)]`).
 */

const SRC = new URL("..", import.meta.url).pathname;
const read = (p: string) => normalizeEol(readFileSync(p, "utf8"));
const rel = (p: string) => p.slice(SRC.length);
/** Comments name utilities in order to explain them, which is not a usage. */
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
const TOKENS = join(SRC, "styles/tokens.css");
const SPACING_JSON = join(SRC, "styles/spacing.json");

/** The canonical steps, read from the single source so the gate and the tokens cannot drift. */
const STEPS = new Set(
	Object.keys((JSON.parse(read(SPACING_JSON)) as { steps: Record<string, string> }).steps),
);
/** The retired t-shirt names — rejected outright so they can never creep back. */
const TSHIRT = new Set(["xs", "sm", "md", "lg", "xl"]);

/**
 * `p`, `px`, `mt`, `gap-y`, … — the utilities that spend a step of the spacing scale (NOT the sizing
 * utilities, which share the base but are not rhythm). Ordered longest-first so alternation matches the
 * whole prefix (`gap-x`, not `gap` + a stray `x`).
 */
const SPACING_PREFIX =
	"px|py|pt|pb|pl|pr|ps|pe|p|mx|my|mt|mb|ml|mr|ms|me|m|gap-x|gap-y|gap|space-x|space-y";
/** A responsive/state prefix (`sm:`, `hover:`, `group-hover:`) may precede any of them. */
const VARIANT = String.raw`(?:[a-z-]+(?:\[[^\]]*\])?:)*`;

function hits(pattern: RegExp): string[] {
	return TS_FILES.flatMap((f) =>
		code(f)
			.split("\n")
			.flatMap((line, i) => [...line.matchAll(pattern)].map((m) => `${rel(f)}:${i + 1}: ${m[0]}`)),
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
		// The scan EXCLUDES `tokens.css`, or each step's own declaration counts as its consumer and the
		// check is vacuous — which is how the first draft of it passed while an orphan step was present.
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
		// `p-8` / `gap-4` (steps) pass; `p-xs` (legacy alias) and `p-6` / `py-1` / `gap-0.5` (off-scale)
		// do not. The bracket escape hatch (`pr-[2rem]`) is not a bare suffix, so it is not matched here.
		// Keyword suffixes (`auto`, `px` hairline, `full`, `reverse`) are not rhythm and stay fine; a bare
		// number must be a declared step, and the retired t-shirt names are rejected outright.
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
		// `py-[3px]` lands between steps; `pr-[2rem]` / `pl-[1.6em]` / `pl-[calc(…)]` are measured
		// constraints, not px rhythm, so only a bare `px` length in the brackets is banned.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[-?[\d.]+px\]`, "g")),
		).toEqual([]);
	});

	it("never re-spells a step through a --space arbitrary value", () => {
		// `p-[var(--space-8)]` re-spells `p-8` and hides the step behind a variable; the numeric utility
		// is the one way to name it. Composed measured indents (`pl-[calc(…+var(--space-8))]`) are fine —
		// the ban is only the DIRECT `-[var(--space…` re-spelling.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}-?(?:${SPACING_PREFIX})-\[var\(--space`, "g")),
		).toEqual([]);
	});

	it("declares no spacing step nothing consumes", () => {
		// A step earns its place by being spent — as a `p`/`m`/`gap` utility or a raw `--space-<n>` token
		// in hand-written CSS. The scan EXCLUDES `spacing.json`, or each step's own declaration would
		// count as its consumer and the check would be vacuous.
		const utility = new RegExp(String.raw`(?<![\w-])-?(?:${SPACING_PREFIX})-(\d+)\b`, "g");
		const used = new Set<string>();
		for (const f of FILES.filter((f) => f !== SPACING_JSON)) {
			const src = code(f);
			for (const m of src.matchAll(utility)) used.add(m[1] as string);
			for (const m of src.matchAll(/--space-(\d+)\b/g)) used.add(m[1] as string);
		}
		expect([...STEPS].filter((step) => !used.has(step))).toEqual([]);
	});
});
