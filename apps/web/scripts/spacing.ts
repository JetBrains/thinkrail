import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STYLES_DIR = join(import.meta.dir, "..", "src", "styles");
export const SOURCE_PATH = join(STYLES_DIR, "spacing.json");
export const GENERATED_PATH = join(STYLES_DIR, "generated", "spacing.css");

export interface Spacing {
	readonly $schema?: string;
	readonly metadata: { readonly version: string; readonly note?: string };
	readonly steps: Readonly<Record<string, string>>;
}

export function loadSpacing(path = SOURCE_PATH): Spacing {
	return JSON.parse(readFileSync(path, "utf8")) as Spacing;
}

export const spaceVar = (step: string) => `--space-${step}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function reportUnknownProperties(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	label: string,
	issues: string[],
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) issues.push(`unknown ${label} property "${key}"`);
	}
}

export function validate(spacing: unknown): string[] {
	const issues: string[] = [];
	if (!isObject(spacing)) return ["spacing must be an object"];

	reportUnknownProperties(spacing, new Set(["$schema", "metadata", "steps"]), "spacing", issues);
	if (spacing.$schema !== undefined && typeof spacing.$schema !== "string") {
		issues.push("$schema must be a string");
	}

	if (!isObject(spacing.metadata)) {
		issues.push("metadata must be an object");
	} else {
		reportUnknownProperties(spacing.metadata, new Set(["version", "note"]), "metadata", issues);
		if (
			typeof spacing.metadata.version !== "string" ||
			!/^\d+\.\d+\.\d+$/.test(spacing.metadata.version)
		) {
			issues.push("metadata.version must be semver");
		}
		if (spacing.metadata.note !== undefined && typeof spacing.metadata.note !== "string") {
			issues.push("metadata.note must be a string");
		}
	}

	if (!isObject(spacing.steps)) {
		issues.push("steps must be an object");
		return issues;
	}
	if (Object.keys(spacing.steps).length === 0) {
		issues.push("steps must declare at least one step");
	}
	for (const [step, value] of Object.entries(spacing.steps)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(step)) {
			issues.push(`steps.${step} must be a canonical non-negative integer without leading zeros`);
			continue;
		}
		if (typeof value !== "string") {
			issues.push(`steps.${step} must be a string`);
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
		"\t--spacing: 1px;",
		"}",
		"",
	].join("\n");
}
