import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ServerExtensionEntry } from "./registry";

interface SkillPackageManifest {
	pi?: { skills?: string[] };
}

export function resolveExtensionSkillRoots(entry: ServerExtensionEntry): string[] {
	const skillPackages = entry.extension.skillPackages ?? [];
	if (skillPackages.length === 0) return [];
	const extensionEntry = createRequire(import.meta.url).resolve(entry.specifier);
	const requireFromExtension = createRequire(extensionEntry);
	return skillPackages.flatMap((specifier) => {
		const manifestPath = requireFromExtension.resolve(`${specifier}/package.json`);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillPackageManifest;
		const skills = manifest.pi?.skills ?? [];
		if (skills.length === 0) {
			throw new Error(
				`${entry.extension.name}: skill package ${specifier} declares no pi.skills directories`,
			);
		}
		return skills.map((dir) => resolve(dirname(manifestPath), dir));
	});
}
