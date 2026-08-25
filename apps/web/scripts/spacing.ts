// The spacing pipeline: load → validate → render CSS. Design + rationale: src/styles/SPACING.md
// (web-spacing); pipeline shape: scripts/SPEC.md (module-web-scripts). Entry point: generate-spacing.ts.
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
		// A step name IS its pixel value (`"8"` → `"8px"`).
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
 * See src/styles/SPACING.md (web-spacing).
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
		"\t/* NUMBER = PX: one base drives spacing AND sizing (see SPACING.md). Replaces Tailwind's 0.25rem. */",
		"\t--spacing: 1px;",
		"}",
		"",
	].join("\n");
}
