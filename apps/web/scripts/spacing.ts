/**
 * The spacing pipeline: load → validate → render CSS.
 *
 * `styles/spacing.json` is the ONLY source of layout-spacing values. This module derives the raw
 * `--space-<n>` custom properties and the Tailwind base from it; nothing downstream may invent a
 * padding, margin or gap length. The scale is CANONICAL and NUMERIC — a step's name IS its pixel value
 * (`4` → `4px`), so a design instruction ("use spacing 8") maps to exactly one token (`--space-8`) and
 * one family of utilities (`p-8`, `gap-8`, `py-8`).
 *
 * NUMBER = PX, UNIFORMLY. Tailwind v4 powers spacing (`p`/`m`/`gap`) AND sizing (`w`/`h`/`size`/inset/
 * translate) from one `--spacing` base, so the two cannot be split by theme. We set `--spacing: 1px`,
 * which makes every bare number resolve to that many pixels (`p-4`=4px, `w-16`=16px) and REPLACES
 * Tailwind's built-in 0.25rem base — so nothing falls back to Tailwind's own numeric scale. The
 * canonical `--space-<n>` steps below are the vocabulary the `spacingUsage` gate enforces at `p`/`m`/
 * `gap` call sites, and the tokens hand-written CSS reads directly; sizing utilities are exact px.
 *
 * Spacing is deliberately independent of typography, colour and radius: a change to the type scale or a
 * theme must never move layout.
 *
 * Entry point: `generate-spacing.ts` (write / --check).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STYLES_DIR = join(import.meta.dir, "..", "src", "styles");
export const SOURCE_PATH = join(STYLES_DIR, "spacing.json");
export const GENERATED_PATH = join(STYLES_DIR, "generated", "spacing.css");

export interface Spacing {
	readonly $schema?: string;
	readonly metadata: { readonly version: string; readonly note?: string };
	/** step name → CSS length. The step name is the canonical pixel value (`"8"` → `"8px"`). */
	readonly steps: Readonly<Record<string, string>>;
}

export function loadSpacing(path = SOURCE_PATH): Spacing {
	return JSON.parse(readFileSync(path, "utf8")) as Spacing;
}

/** The raw custom property a step declares — consumed directly by hand-written CSS. */
export const spaceVar = (step: string) => `--space-${step}`;

export function validate(spacing: Spacing): string[] {
	const issues: string[] = [];
	if (!/^\d+\.\d+\.\d+$/.test(spacing.metadata?.version ?? "")) {
		issues.push("metadata.version must be semver");
	}
	if (!spacing.steps || Object.keys(spacing.steps).length === 0) {
		issues.push("steps must declare at least one step");
	}
	for (const [step, value] of Object.entries(spacing.steps ?? {})) {
		// A step name IS its pixel value: `"8"` must be `"8px"`. This is what lets an instruction name a
		// number and reach exactly one token — a `"8": "10px"` step would break that contract silently.
		if (!/^[0-9]+$/.test(step)) {
			issues.push(`steps.${step} must be a bare integer (the canonical pixel value)`);
			continue;
		}
		if (value !== `${step}px`) {
			issues.push(`steps.${step} must equal "${step}px" (name is the value), got "${value}"`);
		}
	}
	return issues;
}

const HEADER = (version: string) => `/*
 * GENERATED — do not edit. Source: \`src/styles/spacing.json\` (v${version}).
 * Regenerate with \`bun run spacing:generate\`; \`spacing:check\` fails when this file is stale.
 *
 * The canonical numeric spacing tokens, then the Tailwind base. Hand-written CSS reads the raw
 * \`--space-<n>\` tokens; component call sites use the numeric \`p-<n>\` / \`gap-<n>\` / \`py-<n>\`
 * utilities, which resolve to N pixels through the \`--spacing: 1px\` base below.
 */
`;

export function renderCss(spacing: Spacing): string {
	const steps = Object.entries(spacing.steps);

	const rootLines = steps.map(([step, value]) => `\t${spaceVar(step)}: ${value};`);

	return [
		HEADER(spacing.metadata.version),
		":root {",
		...rootLines,
		"}",
		"",
		"@theme inline {",
		"\t/*",
		"\t * NUMBER = PX. Tailwind v4 shares one `--spacing` base between spacing (`p`/`m`/`gap`) and sizing",
		"\t * (`w`/`h`/`size`/inset/translate), so they cannot be split by theme. Setting it to 1px makes every",
		"\t * bare number resolve to that many pixels (`p-4`=4px, `w-16`=16px) and REPLACES Tailwind's built-in",
		"\t * 0.25rem base, so no length falls back to Tailwind's own numeric scale. The canonical spacing",
		"\t * VOCABULARY (which of these numbers `p`/`m`/`gap` may use) is enforced by `spacingUsage.test.ts`.",
		"\t */",
		"\t--spacing: 1px;",
		"}",
		"",
	].join("\n");
}
