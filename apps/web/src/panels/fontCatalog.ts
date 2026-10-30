import {
	FONT_ROLES,
	type FontFamilyRef,
	type FontRole,
	fontFamilyRefKey,
	type InstalledFontFamily,
	type UserFontFile,
	type UserFontFileOk,
	type UserFontsSnapshot,
} from "@thinkrail/contracts";
import type { BundledFaces, FontProbe } from "@/fonts";

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

export function refFamilyName(
	ref: FontFamilyRef | null,
	role: FontRole,
	faces: BundledFaces,
): string {
	if (ref === null) return faces[role];
	return "builtin" in ref ? faces[ref.builtin] : ref.name;
}

export function choiceKey(ref: FontFamilyRef | null, role: FontRole): string {
	return ref === null ? fontFamilyRefKey({ builtin: role }) : fontFamilyRefKey(ref);
}

export function isRoleDefault(ref: FontFamilyRef, role: FontRole): boolean {
	return "builtin" in ref && ref.builtin === role;
}

const byLabel = (a: FontOption, b: FontOption) =>
	a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

export function customFontFiles(snapshot: UserFontsSnapshot | null): UserFontFileOk[] {
	return (snapshot?.files ?? []).filter((file): file is UserFontFileOk => file.ok);
}

export function fontOptions({
	faces,
	userFonts,
	installed,
	probe,
}: {
	faces: BundledFaces;
	userFonts: UserFontsSnapshot | null;
	installed: InstalledFonts;
	probe: (family: string) => FontProbe;
}): FontOption[] {
	const builtin: FontOption[] = FONT_ROLES.map((role) => ({
		key: fontFamilyRefKey({ builtin: role }),
		ref: { builtin: role },
		family: faces[role],
		label: displayFamily(faces[role]),
		source: "builtin",
		monospace: role === "code",
		defaultFor: role,
		renders: true,
	}));
	const custom = new Map<string, FontOption>();
	for (const file of customFontFiles(userFonts)) {
		const { family, monospace } = file.face;
		custom.set(family, {
			key: fontFamilyRefKey({ name: family }),
			ref: { name: family },
			family,
			label: family,
			source: "custom",
			monospace: (custom.get(family)?.monospace ?? false) || monospace,
			defaultFor: null,
			renders: true,
		});
	}
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
	return [...builtin, ...[...custom.values()].sort(byLabel), ...system];
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

export function usedFamilies(
	files: readonly UserFontFile[],
	refs: readonly FontFamilyRef[],
): Set<string> {
	const names = new Set(refs.flatMap((ref) => ("name" in ref ? [ref.name] : [])));
	return new Set(
		files.flatMap((file) => (file.ok && names.has(file.face.family) ? [file.face.family] : [])),
	);
}
