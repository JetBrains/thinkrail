import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";

/**
 * The SHAPE + SPACING adoption guard — the third sibling of `colorUsage.test.ts` and
 * `typographyUsage.test.ts`, and the one that was missing. Colour and typography each have a JSON
 * source, a generator and a usage guard; radius and spacing had a source (`styles/tokens.css`) and
 * nothing watching the call sites, so 15 hand-written pixel values had already drifted in — including a
 * `rounded-[7px]` and a `rounded-[10px]` sitting 1–2px off `--radius-md` and `--radius-lg`. Nothing
 * could see them: unlike a colour utility, an arbitrary length always renders, so the drift is invisible
 * in review and in every gate.
 *
 * Two scales are legitimate here, and both are token-backed:
 *  - the PROJECT steps — `--radius-xs/sm/md/lg` (as `rounded-[var(--radius-md)]`, because `--radius-*`
 *    collides with a Tailwind namespace) and the `--space-*` family (as `p-md`, `gap-sm`, via the
 *    `--spacing-*` aliases in `index.css`);
 *  - Tailwind's own NUMERIC steps (`py-0.5`, `px-1`, `gap-1.5`) — a 4px-based scale, already the
 *    established idiom for the sub-`--space-xs` tier where the project family has no step.
 * What is banned is the third option: a raw pixel length written at the call site, which belongs to
 * neither scale and can sit anywhere between two steps.
 *
 * A LENGTH THAT IS NOT A SCALE STEP IS STILL ALLOWED, deliberately: `max-w-[78ch]`, `w-[320px]`,
 * `max-h-[40vh]` and `pl-[calc(0.875rem+var(--spacing-sm))]` are layout constraints and measured
 * indents, not rhythm. Only the utilities whose whole job is a step off the scale are policed, and only
 * when they carry a bare pixel value.
 *
 * HANDWRITTEN CSS is policed the same way, from the declaration side. A rhythm property (`padding`,
 * `margin`, `gap`, `row/column-gap`) may not carry a bare pixel length that lands on the scale — it must
 * name the `--space-*` token, exactly as `p-md` does at a call site. `inset`/`top`/`left` and non-rhythm
 * geometry (`width`, `height`, `border`, `box-shadow`, `transform`, `min-height`, `max-width`, …) are NOT
 * rhythm and stay out entirely, the declaration-side twin of leaving `w-[320px]` alone. An OFF-scale
 * rhythm value (a 2px sub-step inset, a 6px tight gap, a 10px optical indent) has no token, so it stays a
 * raw px — but must carry a `space-exempt` marker saying why; an ON-scale value may never carry it (it
 * has a token). The nominal step pixels are derived from the token file, so the guard tracks the scale.
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
const CSS_FILES = FILES.filter((f) => /\.css$/.test(f));
const TOKENS = join(SRC, "styles/tokens.css");

/** `p`, `px`, `mt`, `gap-y`, … — the utilities that spend a step of the spacing scale. */
const SPACING_PREFIX =
	"p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y";
/** A responsive/state prefix (`sm:`, `hover:`, `group-hover:`) may precede any of them. */
const VARIANT = String.raw`(?:[a-z-]+(?:\[[^\]]*\])?:)*`;

function hits(pattern: RegExp): string[] {
	return TS_FILES.flatMap((f) =>
		code(f)
			.split("\n")
			.flatMap((line, i) => [...line.matchAll(pattern)].map((m) => `${rel(f)}:${i + 1}: ${m[0]}`)),
	);
}

/** The nominal px each `--space-*` step resolves to (`--space-base` × factor, rounded) — the values a
 *  handwritten length "duplicates" when it re-types the scale by hand. Read from the token file so the
 *  guard tracks the scale, never a copied table. */
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

/** The rhythm properties — the declaration-side analog of `SPACING_PREFIX`. `inset`/`top`/`left` are
 *  positioning geometry, not rhythm, and stay out (exactly as the call-site guard omits them). */
const CSS_SPACING_PROP = "(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?";
/** A declaration opts out of the raw-px ban for a DOCUMENTED off-scale/optical value; on-scale values
 *  can never carry it — they must name the token. */
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

	// The scale is a small primitive geometry, capped at 8px: exactly `xs`/`sm`/`md`/`lg` (2/4/6/8px).
	// `sm` (4px) is the default corner; `md` (6px) is the outer corner for surfaces nesting 4px children;
	// `lg` (8px) is the exception for large standalone elevated surfaces. Nothing above 8px. `rounded-full`
	// (a pill/circle) is not a scale step, so it is exempt — the 8px cap governs normal UI surfaces only.
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
		// `p-md` (project family) and `py-0.5` (Tailwind numeric) are both steps. `py-[3px]` is neither:
		// it lands between them, so the next person copies 3px instead of the step it was reaching for.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}(?:${SPACING_PREFIX})-\[-?[\d.]+px\]`, "g")),
		).toEqual([]);
	});

	it("never reaches a spacing token through an arbitrary value", () => {
		// `p-[var(--space-md)]` re-spells `p-md` and hides the step behind a variable; the aliases in
		// `index.css` exist precisely so the utility can name it.
		expect(
			hits(new RegExp(String.raw`(?<![\w-])${VARIANT}(?:${SPACING_PREFIX})-\[var\(--space`, "g")),
		).toEqual([]);
	});
});

describe("spacing in handwritten CSS", () => {
	it("names a --space-* token for any value on the scale, never a bare px", () => {
		// `padding: 8px` re-types `--space-sm` by hand and drifts free the moment the base moves;
		// `padding: var(--space-sm)` tracks it. On-scale values can't be exempted — they have a token.
		expect(cssSpacing().onScale).toEqual([]);
	});

	it("allows an off-scale rhythm px only with a documented `space-exempt` marker", () => {
		// Sub-step insets and optical indents (2px, 6px, 10px) have no scale step; they stay raw px but must
		// say why, so an undocumented off-scale length can't quietly re-appear as fake rhythm.
		expect(cssSpacing().unmarkedOffScale).toEqual([]);
	});
});
