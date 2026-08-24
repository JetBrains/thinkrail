import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STYLES_DIR = join(import.meta.dir, "..", "src", "styles");
export const SOURCE_PATH = join(STYLES_DIR, "colors.json");
export const GENERATED_CSS_PATH = join(STYLES_DIR, "generated", "colors.css");
export const THEMES_DIR = join(import.meta.dir, "..", "src", "themes");
export const THEME_SCHEMA_PATH = join(THEMES_DIR, "schema.ts");

export const paletteVar = (key: string) =>
	`--${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

export function themeColorKeys(): string[] {
	const schema = readFileSync(THEME_SCHEMA_PATH, "utf8");
	const block = /export const THEME_COLOR_KEYS = \[([\s\S]*?)\] as const;/.exec(schema)?.[1] ?? "";
	return [...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1] as string);
}

export interface Role {
	readonly from: string;
	readonly alpha?: string;
	readonly fallback?: string;
	readonly publish: boolean;
	readonly note?: string;
}

export interface Effect {
	readonly dark: string;
	readonly light: string;
	readonly publish: boolean;
	readonly note?: string;
}

export interface Colors {
	readonly metadata: { readonly version: string; readonly note?: string };
	readonly scale: Readonly<Record<string, number>>;
	readonly roles: Readonly<Record<string, Role>>;
	readonly effects: Readonly<Record<string, Effect>>;
}

export function loadColors(path = SOURCE_PATH): Colors {
	return JSON.parse(readFileSync(path, "utf8")) as Colors;
}

export const roleVar = (name: string) => `--${name}`;
export const themeVar = (name: string) => `--color-${name}`;

export function derive(colors: Colors, role: Role): string {
	const source = paletteVar(role.from);
	if (!role.alpha) return `var(${source}${role.fallback ? `, ${role.fallback}` : ""})`;
	return `color-mix(in srgb, var(${source}) ${colors.scale[role.alpha]}%, transparent)`;
}

function aliasesPaletteVar(name: string, role: Role): boolean {
	return paletteVar(role.from) === roleVar(name) && !role.alpha && !role.fallback;
}

export function validate(colors: Colors): string[] {
	const issues: string[] = [];
	if (!/^\d+\.\d+\.\d+$/.test(colors.metadata?.version ?? "")) {
		issues.push("metadata.version must be semver");
	}
	for (const [step, pct] of Object.entries(colors.scale)) {
		if (!Number.isInteger(pct) || pct <= 0 || pct >= 100) {
			issues.push(`scale.${step} must be an integer percentage in (0, 100)`);
		}
	}
	const keys = themeColorKeys();
	for (const [name, role] of Object.entries(colors.roles)) {
		if (!keys.includes(role.from)) {
			issues.push(`roles.${name}.from is not a theme manifest key: ${role.from}`);
		}
		if (role.alpha !== undefined && colors.scale[role.alpha] === undefined) {
			issues.push(
				`roles.${name}.alpha must be a scale step (${Object.keys(colors.scale).join(", ")}), got ${role.alpha}`,
			);
		}
		if (role.alpha !== undefined && role.fallback !== undefined) {
			issues.push(`roles.${name} cannot combine alpha with fallback`);
		}
		if (typeof role.publish !== "boolean") issues.push(`roles.${name}.publish must be a boolean`);
		if (!/^[a-z][a-z0-9-]*$/.test(name)) issues.push(`roles.${name} must be a kebab-case slug`);
	}
	for (const [name, effect] of Object.entries(colors.effects)) {
		for (const appearance of ["dark", "light"] as const) {
			if (typeof effect[appearance] !== "string" || effect[appearance].length === 0) {
				issues.push(`effects.${name}.${appearance} must be a non-empty string`);
			}
		}
		if (typeof effect.publish !== "boolean")
			issues.push(`effects.${name}.publish must be a boolean`);
	}
	const used = new Set(Object.values(colors.roles).map((r) => r.from));
	for (const key of keys) {
		if (!used.has(key)) issues.push(`no role reads the theme manifest key "${key}"`);
	}
	return issues;
}

const HEADER = (version: string, kind: string) => `/*
 * GENERATED — do not edit. Source: \`src/styles/colors.json\` (v${version}).
 * Regenerate with \`bun run colors:generate\`; \`colors:check\` fails when this file is stale.
 *
 * ${kind}
 */
`;

export function renderCss(colors: Colors): string {
	const roles = Object.entries(colors.roles);
	const effects = Object.entries(colors.effects).filter(([, e]) => e.publish);

	const rootLines = roles
		.filter(([name, role]) => !aliasesPaletteVar(name, role))
		.map(([name, role]) => {
			const note = role.note ? ` /* ${role.note} */` : "";
			return `\t${roleVar(name)}: ${derive(colors, role)};${note}`;
		});

	const effectBlocks = ["dark", "light"].map((appearance) =>
		[
			`:root[data-theme-appearance="${appearance}"] {`,
			...Object.entries(colors.effects).map(
				([n, e]) => `\t--${n}: ${e[appearance as "dark" | "light"]};`,
			),
			"}",
		].join("\n"),
	);

	const themeLines = [
		// The built-in-palette reset must precede our entries — a reset in a later block would wipe them too (see scripts/SPEC.md).
		"\t--color-*: initial;",
		...roles.filter(([, r]) => r.publish).map(([n]) => `\t${themeVar(n)}: var(${roleVar(n)});`),
		...effects.map(([n]) => `\t${themeVar(n)}: var(--${n});`),
	];

	return [
		HEADER(
			colors.metadata.version,
			"The semantic roles, then the Tailwind utility map. The palette they read is written to the\n * document root by `themes/runtime.ts` before React mounts.",
		),
		":root {",
		...rootLines,
		"}",
		"",
		"/* Appearance-level effects. The theme engine stamps `data-theme-appearance` before React mounts, so",
		" * these need no JavaScript — they are constants, not palette derivations. */",
		...effectBlocks,
		"",
		"@theme inline {",
		...themeLines,
		"}",
		"",
	].join("\n");
}
