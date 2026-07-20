import type { ThemeId } from "@thinkrail/contracts";

export const THEME_COLOR_KEYS = [
	"accent",
	"onAccent",
	"bubbleAccent",
	"background",
	"content",
	"sidebar",
	"input",
	"elevated",
	"hover",
	"border",
	"borderStrong",
	"text",
	"muted",
	"hint",
	"selection",
	"selectionForeground",
	"editorSelection",
	"editorSelectionForeground",
	"info",
	"success",
	"danger",
	"warning",
] as const;

export const ANSI_COLOR_KEYS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;

export const SYNTAX_COLOR_KEYS = [
	"foreground",
	"comment",
	"commentDoc",
	"keyword",
	"string",
	"number",
	"regexp",
	"annotation",
	"tag",
	"attributeName",
	"attributeValue",
	"property",
	"function",
	"type",
	"variable",
	"constant",
	"operator",
	"punctuation",
	"inserted",
	"deleted",
	"changed",
] as const;

export const NULLABLE_THEME_COLOR_KEYS = [
	"selectionForeground",
	"editorSelectionForeground",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type NullableThemeColorKey = (typeof NULLABLE_THEME_COLOR_KEYS)[number];
export type AnsiColorKey = (typeof ANSI_COLOR_KEYS)[number];
export type SyntaxColorKey = (typeof SYNTAX_COLOR_KEYS)[number];
export type ThemeAppearance = "light" | "dark";
export type ThemeContrast = "normal" | "high";
export type HexColor = `#${string}`;
export type ThemeColors = Readonly<
	Record<Exclude<ThemeColorKey, NullableThemeColorKey>, HexColor> &
		Record<NullableThemeColorKey, HexColor | null>
>;

export interface ThemeManifest {
	readonly $schema?: string;
	readonly schemaVersion: 1;
	readonly id: ThemeId;
	readonly label: string;
	readonly order: number;
	readonly appearance: ThemeAppearance;
	readonly contrast: ThemeContrast;
	readonly colors: ThemeColors;
	readonly ansi: Readonly<Record<AnsiColorKey, HexColor>>;
	readonly syntax: Readonly<Record<SyntaxColorKey, HexColor>>;
}

export type ThemeManifestParseResult =
	| { readonly ok: true; readonly value: ThemeManifest }
	| { readonly ok: false; readonly issues: readonly string[] };

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const THEME_ID = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const NULLABLE_KEYS: ReadonlySet<string> = new Set(NULLABLE_THEME_COLOR_KEYS);

export function isThemeIdSlug(value: string): boolean {
	return THEME_ID.test(value);
}
const ROOT_KEYS = new Set([
	"$schema",
	"schemaVersion",
	"id",
	"label",
	"order",
	"appearance",
	"contrast",
	"colors",
	"ansi",
	"syntax",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noteUnexpectedKeys(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
	issues: string[],
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`);
	}
}

function parseThemeColors(value: unknown, issues: string[]): ThemeColors | null {
	if (!isRecord(value)) {
		issues.push("theme.colors must be an object");
		return null;
	}
	const allowed = new Set<string>(THEME_COLOR_KEYS);
	noteUnexpectedKeys(value, allowed, "theme.colors", issues);
	const palette = {} as Record<ThemeColorKey, HexColor | null>;
	for (const key of THEME_COLOR_KEYS) {
		const color = value[key];
		const nullable = NULLABLE_KEYS.has(key);
		if (nullable && color === null) {
			palette[key] = null;
			continue;
		}
		if (typeof color !== "string" || !HEX_COLOR.test(color)) {
			issues.push(
				`theme.colors.${key} must be a canonical lowercase #rrggbb or #rrggbbaa color${nullable ? " or null" : ""}`,
			);
			continue;
		}
		palette[key] = color as HexColor;
	}
	return Object.freeze(palette) as ThemeColors;
}

function parsePalette<K extends string>(
	value: unknown,
	keys: readonly K[],
	path: string,
	issues: string[],
): Readonly<Record<K, HexColor>> | null {
	if (!isRecord(value)) {
		issues.push(`${path} must be an object`);
		return null;
	}
	const allowed = new Set<string>(keys);
	noteUnexpectedKeys(value, allowed, path, issues);
	const palette = {} as Record<K, HexColor>;
	for (const key of keys) {
		const color = value[key];
		if (typeof color !== "string" || !HEX_COLOR.test(color)) {
			issues.push(`${path}.${key} must be a canonical lowercase #rrggbb or #rrggbbaa color`);
			continue;
		}
		palette[key] = color as HexColor;
	}
	return Object.freeze(palette);
}

/** Parse untrusted theme data. A manifest is accepted all-or-nothing; no partial palette is returned. */
export function parseThemeManifest(value: unknown): ThemeManifestParseResult {
	const issues: string[] = [];
	if (!isRecord(value)) return { ok: false, issues: ["theme manifest must be an object"] };

	noteUnexpectedKeys(value, ROOT_KEYS, "theme", issues);
	if (value.schemaVersion !== 1) issues.push("theme.schemaVersion must be 1");
	if (typeof value.id !== "string" || !isThemeIdSlug(value.id)) {
		issues.push("theme.id must be a lowercase slug (1-64 characters; letters, numbers, ., _, -)");
	}
	if (
		typeof value.label !== "string" ||
		value.label.length < 1 ||
		value.label.length > 80 ||
		value.label.trim() !== value.label
	) {
		issues.push("theme.label must be a trimmed string between 1 and 80 characters");
	}
	if (
		!Number.isInteger(value.order) ||
		Number(value.order) < -10_000 ||
		Number(value.order) > 10_000
	) {
		issues.push("theme.order must be an integer between -10000 and 10000");
	}
	if (value.appearance !== "light" && value.appearance !== "dark") {
		issues.push('theme.appearance must be "light" or "dark"');
	}
	if (value.contrast !== "normal" && value.contrast !== "high") {
		issues.push('theme.contrast must be "normal" or "high"');
	}
	if (
		value.$schema !== undefined &&
		(typeof value.$schema !== "string" || value.$schema.length < 1 || value.$schema.length > 256)
	) {
		issues.push("theme.$schema must be a non-empty string no longer than 256 characters");
	}

	const colors = parseThemeColors(value.colors, issues);
	const ansi = parsePalette(value.ansi, ANSI_COLOR_KEYS, "theme.ansi", issues);
	const syntax = parsePalette(value.syntax, SYNTAX_COLOR_KEYS, "theme.syntax", issues);
	if (issues.length > 0 || !colors || !ansi || !syntax) return { ok: false, issues };

	const manifest: ThemeManifest = Object.freeze({
		...(typeof value.$schema === "string" ? { $schema: value.$schema } : {}),
		schemaVersion: 1,
		id: value.id as ThemeId,
		label: value.label as string,
		order: value.order as number,
		appearance: value.appearance as ThemeAppearance,
		contrast: value.contrast as ThemeContrast,
		colors,
		ansi,
		syntax,
	});
	return { ok: true, value: manifest };
}

export class InvalidThemeManifestError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Invalid theme manifest:\n- ${issues.join("\n- ")}`);
		this.name = "InvalidThemeManifestError";
		this.issues = issues;
	}
}

export function assertThemeManifest(value: unknown): ThemeManifest {
	const parsed = parseThemeManifest(value);
	if (!parsed.ok) throw new InvalidThemeManifestError(parsed.issues);
	return parsed.value;
}
