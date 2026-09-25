import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	EXT_NAME_PATTERN,
	type ExtensionSurface,
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
});

type RawManifest = Static<typeof ManifestSchema>;

interface ExtensionManifest extends Omit<RawManifest, "surfaces" | "title" | "permissions"> {
	title: string;
	surfaces: ExtensionSurface[];
	permissions: string[];
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

export const parseManifest = (input: unknown): ManifestResult => {
	if (!Value.Check(ManifestSchema, input)) {
		const errors = [...Value.Errors(ManifestSchema, input)]
			.filter((error) => error.keyword !== "boolean")
			.map((error) => `${pathLabel(error.instancePath)}: ${error.message}`);
		return { ok: false, errors: errors.length > 0 ? errors : ["manifest: invalid"] };
	}
	const errors = surfaceErrors(input.surfaces);
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		manifest: {
			name: input.name,
			title: input.title ?? input.name,
			surfaces: input.surfaces.flatMap((surface) => toSurface(surface) ?? []),
			permissions: input.permissions ?? [],
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
	return errors.length > 0 ? { ok: false, errors } : parsed;
};
