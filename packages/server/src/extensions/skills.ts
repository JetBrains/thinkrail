import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import type { ServerExtensionEntry } from "./registry";

interface SkillPackageManifest {
	pi?: { skills?: string[] };
}

export function skillPackageRoots(extensionEntry: string, extension: ServerExtension): string[] {
	const skillPackages = extension.skillPackages ?? [];
	if (skillPackages.length === 0) return [];
	const requireFromExtension = createRequire(extensionEntry);
	return skillPackages.flatMap((specifier) => {
		const manifestPath = requireFromExtension.resolve(`${specifier}/package.json`);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillPackageManifest;
		const skills = manifest.pi?.skills ?? [];
		if (skills.length === 0) {
			throw new Error(
				`${extension.name}: skill package ${specifier} declares no pi.skills directories`,
			);
		}
		return skills.map((dir) => resolve(dirname(manifestPath), dir));
	});
}

export function resolveExtensionSkillRoots(entry: ServerExtensionEntry): string[] {
	if (entry.installed) return [...entry.installed.skillRoots];
	if ((entry.extension.skillPackages ?? []).length === 0) return [];
	return skillPackageRoots(
		createRequire(import.meta.url).resolve(entry.specifier),
		entry.extension,
	);
}

export const STAGED_HOST_SKILLS_ROUTE = "host";

export function stagedExtensionSkillRoute(name: string): string {
	return `extensions/${name}`;
}

export function extensionSkillRoots(
	entry: ServerExtensionEntry,
	stagedSkillsDir?: string,
): string[] {
	if (stagedSkillsDir === undefined || entry.installed) return resolveExtensionSkillRoots(entry);
	if ((entry.extension.skillPackages ?? []).length === 0) return [];
	return [join(stagedSkillsDir, ...stagedExtensionSkillRoute(entry.extension.name).split("/"))];
}
