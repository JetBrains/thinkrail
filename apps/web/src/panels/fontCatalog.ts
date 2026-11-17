import {
	FONT_ROLES,
	type FontFamilyRef,
	type FontRole,
	fontFamilyRefKey,
	type InstalledFontFamily,
	type UserFontsSnapshot,
} from "@thinkrail/contracts";
import type { BundledAlternates, BundledFaces, FontProbe } from "@/fonts";

export type FontSource = "builtin" | "custom" | "installed";

export interface FontOption {
	key: string;
	ref: FontFamilyRef;
	family: string;
	label: string;
	source: FontSource;
	monospace: boolean;
	defaultFor: FontRole | null;
	renders: boolean;
}

export type InstalledFonts =
	| { status: "idle" | "loading" | "failed" }
	| { status: "ready"; families: readonly InstalledFontFamily[] };

export function displayFamily(family: string): string {
	return family.replace(/ Variable$/, "");
}

export function choiceKey(ref: FontFamilyRef | null, role: FontRole): string {
	return ref === null ? fontFamilyRefKey({ builtin: role }) : fontFamilyRefKey(ref);
}

export function isRoleDefault(ref: FontFamilyRef, role: FontRole): boolean {
	return "builtin" in ref && ref.builtin === role;
}

const byLabel = (a: FontOption, b: FontOption) =>
	a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

export interface CustomFamily {
	files: string[];
	monospace: boolean;
}

export function customFamilies(snapshot: UserFontsSnapshot | null): Map<string, CustomFamily> {
	const families = new Map<string, CustomFamily>();
	for (const file of snapshot?.files ?? []) {
		if (!file.ok) continue;
		const previous = families.get(file.face.family);
		families.set(file.face.family, {
			files: [...(previous?.files ?? []), file.fileName],
			monospace: (previous?.monospace ?? false) || file.face.monospace,
		});
	}
	return families;
}

export function fontOptions({
	faces,
	alternates,
	custom,
	installed,
	probe,
}: {
	faces: BundledFaces;
	alternates?: BundledAlternates;
	custom: ReadonlyMap<string, CustomFamily>;
	installed: InstalledFonts;
	probe: (family: string) => FontProbe;
}): FontOption[] {
	const roleDefaults: FontOption[] = FONT_ROLES.map((role) => ({
		key: fontFamilyRefKey({ builtin: role }),
		ref: { builtin: role },
		family: faces[role],
		label: displayFamily(faces[role]),
		source: "builtin",
		monospace: role === "code",
		defaultFor: role,
		renders: true,
	}));
	const alternateOptions: FontOption[] = FONT_ROLES.flatMap((role) =>
		(alternates?.[role] ?? [])
			.filter((family) => family !== faces[role])
			.map((family) => ({
				key: fontFamilyRefKey({ name: family }),
				ref: { name: family },
				family,
				label: displayFamily(family),
				source: "builtin" as const,
				monospace: role === "code",
				defaultFor: null,
				renders: true,
			})),
	);
	const builtin = [...roleDefaults, ...alternateOptions];
	const customOptions: FontOption[] = [...custom]
		.filter(([family]) => !alternateOptions.some((option) => option.family === family))
		.map(([family, { monospace }]) => ({
			key: fontFamilyRefKey({ name: family }),
			ref: { name: family },
			family,
			label: family,
			source: "custom",
			monospace,
			defaultFor: null,
			renders: true,
		}));
	const taken = new Set([...builtin.map((option) => option.family), ...custom.keys()]);
	const system: FontOption[] =
		installed.status === "ready"
			? installed.families
					.filter((family) => !taken.has(family.name))
					.map((family) => {
						const probed = probe(family.name);
						return {
							key: fontFamilyRefKey({ name: family.name }),
							ref: { name: family.name },
							family: family.name,
							label: family.name,
							source: "installed",
							monospace: probed.renders ? probed.monospace : family.monospaceHint,
							defaultFor: null,
							renders: probed.renders,
						};
					})
			: [];
	return [...builtin, ...customOptions.sort(byLabel), ...system];
}

export function mainFontOptions(
	options: readonly FontOption[],
	role: FontRole,
	sharesHostFonts: boolean,
): FontOption[] {
	return options.filter(
		(option) =>
			(role === "interface" || option.monospace) &&
			!(option.source === "installed" && sharesHostFonts && !option.renders),
	);
}

export function fallbackFontOptions(
	options: readonly FontOption[],
	taken: readonly FontFamilyRef[],
): FontOption[] {
	const keys = new Set(taken.map(fontFamilyRefKey));
	return options.filter((option) => !keys.has(option.key));
}
