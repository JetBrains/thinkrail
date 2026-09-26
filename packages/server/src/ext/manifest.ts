import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import {
	EXT_NAME_PATTERN,
	EXT_THEME_MODES,
	type ExtensionSurface,
	type ExtensionTheme,
	type ExtThemeTokens,
	extThemeTokensErrors,
	isExtThemeMode,
	SURFACE_SLOTS,
	type SurfaceSlot,
} from "@thinkrail/contracts";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { errorMessage } from "./util";

const NAME_PATTERN = `^${EXT_NAME_PATTERN}$`;

const ManifestSchema = Type.Object({
	name: Type.String({ pattern: NAME_PATTERN }),
	title: Type.Optional(Type.String({ minLength: 1 })),
	surfaces: Type.Array(
		Type.Object({
			id: Type.String({ pattern: NAME_PATTERN }),
			slot: Type.String(),
			title: Type.Optional(Type.String()),
			tool: Type.Optional(Type.String({ minLength: 1 })),
			customType: Type.Optional(Type.String({ minLength: 1 })),
		}),
	),
	permissions: Type.Optional(Type.Array(Type.String())),
	themes: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.String({ pattern: NAME_PATTERN }),
				title: Type.Optional(Type.String({ minLength: 1 })),
				mode: Type.String(),
				tokens: Type.Record(Type.String(), Type.Unknown()),
				css: Type.Optional(Type.String({ minLength: 1 })),
			}),
		),
	),
});

type RawManifest = Static<typeof ManifestSchema>;

type RawTheme = NonNullable<RawManifest["themes"]>[number];

export interface ManifestTheme extends ExtensionTheme {
	cssFile?: string;
}

interface ExtensionManifest
	extends Omit<RawManifest, "surfaces" | "title" | "permissions" | "themes"> {
	title: string;
	surfaces: ExtensionSurface[];
	permissions: string[];
	themes: ManifestTheme[];
}

type ManifestResult = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] };

const pathLabel = (instancePath: string) =>
	instancePath
		.split("/")
		.filter(Boolean)
		.reduce(
			(acc, part) => (/^\d+$/.test(part) ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part),
			"",
		) || "manifest";

const isSlot = (slot: string): slot is SurfaceSlot => SURFACE_SLOTS.some((known) => known === slot);

const surfaceErrors = (surfaces: RawManifest["surfaces"]) => {
	const errors: string[] = [];
	const seen = new Set<string>();
	surfaces.forEach((surface, index) => {
		const at = `surfaces[${index}]`;
		if (seen.has(surface.id)) errors.push(`${at}.id "${surface.id}" is duplicated`);
		seen.add(surface.id);
		if (!isSlot(surface.slot)) {
			errors.push(`${at}.slot "${surface.slot}" unknown; allowed: ${SURFACE_SLOTS.join(", ")}`);
			return;
		}
		if (surface.slot === "toolCard" && !surface.tool)
			errors.push(`${at}.tool is required for slot "toolCard" (the tool name it renders)`);
		if (surface.slot === "message" && !surface.customType)
			errors.push(
				`${at}.customType is required for slot "message" (the custom message type it renders)`,
			);
	});
	return errors;
};

const toSurface = (surface: RawManifest["surfaces"][number]): ExtensionSurface | undefined => {
	if (!isSlot(surface.slot)) return undefined;
	return {
		id: surface.id,
		slot: surface.slot,
		...(surface.title !== undefined ? { title: surface.title } : {}),
		...(surface.tool !== undefined ? { tool: surface.tool } : {}),
		...(surface.customType !== undefined ? { customType: surface.customType } : {}),
	};
};

const CSS_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.css$/;

const themeErrors = (themes: readonly RawTheme[]) => {
	const errors: string[] = [];
	const seen = new Set<string>();
	themes.forEach((theme, index) => {
		const at = `themes[${index}]`;
		if (seen.has(theme.id)) errors.push(`${at}.id "${theme.id}" is duplicated`);
		seen.add(theme.id);
		if (!isExtThemeMode(theme.mode))
			errors.push(`${at}.mode "${theme.mode}" unknown; allowed: ${EXT_THEME_MODES.join(", ")}`);
		for (const { token, error } of extThemeTokensErrors(theme.tokens))
			errors.push(`${at}.tokens["${token}"] ${error}`);
		if (
			theme.css !== undefined &&
			(!CSS_FILE.test(theme.css) || normalize(theme.css) !== theme.css)
		)
			errors.push(`${at}.css "${theme.css}" must be a relative .css path inside the extension`);
	});
	return errors;
};

const toTheme = (theme: RawTheme): ManifestTheme => ({
	id: theme.id,
	title: theme.title ?? theme.id,
	mode: isExtThemeMode(theme.mode) ? theme.mode : "dark",
	tokens: theme.tokens as ExtThemeTokens,
	css: theme.css !== undefined,
	...(theme.css !== undefined ? { cssFile: theme.css } : {}),
});

export const parseManifest = (input: unknown): ManifestResult => {
	if (!Value.Check(ManifestSchema, input)) {
		const errors = [...Value.Errors(ManifestSchema, input)]
			.filter((error) => error.keyword !== "boolean")
			.map((error) => `${pathLabel(error.instancePath)}: ${error.message}`);
		return { ok: false, errors: errors.length > 0 ? errors : ["manifest: invalid"] };
	}
	const errors = [...surfaceErrors(input.surfaces), ...themeErrors(input.themes ?? [])];
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		manifest: {
			name: input.name,
			title: input.title ?? input.name,
			surfaces: input.surfaces.flatMap((surface) => toSurface(surface) ?? []),
			permissions: input.permissions ?? [],
			themes: (input.themes ?? []).map(toTheme),
		},
	};
};

export const readManifest = async (dir: string): Promise<ManifestResult> => {
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(join(dir, "extension.json"), "utf8"));
	} catch (error) {
		return { ok: false, errors: [`extension.json: ${errorMessage(error)}`] };
	}
	const parsed = parseManifest(raw);
	if (!parsed.ok) return parsed;
	const { manifest } = parsed;
	const errors: string[] = [];
	if (manifest.name !== basename(dir))
		errors.push(`name "${manifest.name}" must equal the directory name "${basename(dir)}"`);
	if (!existsSync(join(dir, "index.ts"))) errors.push("index.ts is missing (the host half)");
	manifest.surfaces.forEach((surface, index) => {
		if (!existsSync(join(dir, `${surface.id}.tsx`)))
			errors.push(`surfaces[${index}]: view file ${surface.id}.tsx is missing`);
	});
	manifest.themes.forEach((theme, index) => {
		if (theme.cssFile !== undefined && !existsSync(join(dir, theme.cssFile)))
			errors.push(`themes[${index}]: css file ${theme.cssFile} is missing`);
	});
	return errors.length > 0 ? { ok: false, errors } : parsed;
};
