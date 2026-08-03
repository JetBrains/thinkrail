import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load / validate / render the semantic colour layer. The single place a colour derivation is written:
 * `renderCss` emits the `:root` roles and the `@theme inline` utility map, and `paletteModule` emits the
 * palette-variable + effect tables the theme runtime applies. Nothing downstream restates a percentage,
 * a variable name or a mapping.
 */

export const STYLES_DIR = join(import.meta.dir, "..", "src", "styles");
export const SOURCE_PATH = join(STYLES_DIR, "colors.json");
export const GENERATED_CSS_PATH = join(STYLES_DIR, "generated", "colors.css");
export const THEMES_DIR = join(import.meta.dir, "..", "src", "themes");
/** The palette map + effects are the THEME ENGINE's data, so they are emitted inside that module:
 * `runtime.ts` must not reach into `styles/`, and the table must not reach back into `themes/`. */
export const GENERATED_TS_PATH = join(THEMES_DIR, "generated", "colors.ts");
/** Kept in step by `validate`: the manifest keys the theme schema declares. */
export const THEME_SCHEMA_PATH = join(THEMES_DIR, "schema.ts");

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
	readonly palette: Readonly<Record<string, readonly string[]>>;
	readonly roles: Readonly<Record<string, Role>>;
	readonly effects: Readonly<Record<string, Effect>>;
}

export function loadColors(path = SOURCE_PATH): Colors {
	return JSON.parse(readFileSync(path, "utf8")) as Colors;
}

/** The CSS custom property a role publishes. */
export const roleVar = (name: string) => `--${name}`;
/** The Tailwind theme key a published role publishes. */
export const themeVar = (name: string) => `--color-${name}`;

/** The single expression that turns a palette entry + a scale step into a colour. */
export function derive(colors: Colors, role: Role): string {
	const source = colors.palette[role.from];
	if (!source) return "";
	const base = `var(${source[0]}${role.fallback ? `, ${role.fallback}` : ""})`;
	if (!role.alpha) return base;
	return `color-mix(in srgb, var(${source[0]}) ${colors.scale[role.alpha]}%, transparent)`;
}

/**
 * The variable a published role resolves to. A plain alias whose own name IS its palette variable
 * (`primary` → `--primary`) must NOT be redeclared: `--primary: var(--primary)` is a self-reference,
 * invalid at computed-value time, which happens to be masked today only because the runtime writes the
 * palette as an inline style that outranks `:root`. Such a role publishes the palette variable directly
 * and emits no `:root` line of its own.
 */
export function aliasesPaletteVar(colors: Colors, name: string, role: Role): boolean {
	return colors.palette[role.from]?.[0] === roleVar(name) && !role.alpha && !role.fallback;
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
	for (const [name, role] of Object.entries(colors.roles)) {
		if (!colors.palette[role.from]) {
			issues.push(`roles.${name}.from is not a palette key: ${role.from}`);
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
	// The palette table IS the runtime's manifest→variable map, so it must match the theme schema's
	// key list exactly: a key here with no schema entry never receives a value, and a schema key
	// missing here is a manifest colour the app silently drops.
	const schema = readFileSync(THEME_SCHEMA_PATH, "utf8");
	const block = /export const THEME_COLOR_KEYS = \[([\s\S]*?)\] as const;/.exec(schema)?.[1] ?? "";
	const schemaKeys = [...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1] as string);
	const paletteKeys = Object.keys(colors.palette);
	for (const key of schemaKeys) {
		if (!paletteKeys.includes(key)) issues.push(`palette is missing the theme key "${key}"`);
	}
	for (const key of paletteKeys) {
		if (!schemaKeys.includes(key)) issues.push(`palette."${key}" is not a theme manifest key`);
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
		.filter(([name, role]) => !aliasesPaletteVar(colors, name, role))
		.map(([name, role]) => {
			const note = role.note ? ` /* ${role.note} */` : "";
			return `\t${roleVar(name)}: ${derive(colors, role)};${note}`;
		});

	const themeLines = [
		// Drop Tailwind's built-in palette FIRST, so `bg-red-500` / `text-white` are not utilities at
		// all. They compile happily otherwise — hardcoded, un-themeable, and invisible to review. This
		// has to precede our own entries: a reset in a later block would wipe them too.
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
		"@theme inline {",
		...themeLines,
		"}",
		"",
	].join("\n");
}

/** The palette-variable and effect tables the theme runtime applies, so neither is restated in code. */
export function renderTs(colors: Colors): string {
	const palette = Object.entries(colors.palette)
		.map(([key, vars]) => `\t${key}: [${vars.map((v) => `"${v}"`).join(", ")}],`)
		.join("\n");
	const effects = (appearance: "dark" | "light") =>
		Object.entries(colors.effects)
			.map(([name, e]) => `\t\t"--${name}": "${e[appearance]}",`)
			.join("\n");

	return `${HEADER(colors.metadata.version, "The manifest-key → CSS-variable map, and the per-appearance effect values.")}
import type { ThemeColorKey } from "../schema";

export const COLOR_VARIABLES: Record<ThemeColorKey, readonly string[]> = {
${palette}
};

export const EFFECTS = {
	dark: {
${effects("dark")}
	},
	light: {
${effects("light")}
	},
} as const;
`;
}
