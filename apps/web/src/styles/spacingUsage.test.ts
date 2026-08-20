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
