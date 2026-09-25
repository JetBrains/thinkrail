import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionScope } from "@thinkrail/contracts";
import { WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";

export interface ProjectRoot {
	projectId: string;
	path: string;
}

export interface Candidate {
	name: string;
	dir: string;
	scope: ExtensionScope;
	projectId?: string;
}

export const projectExtensionsDir = (projectPath: string) =>
	join(projectPath, WORKSPACE_INTERNAL_DIR, "extensions");

const candidatesIn = async (root: string) => {
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "extension.json")))
		.map((entry) => ({ name: entry.name, dir: join(root, entry.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
};

export const discoverExtensions = async ({
	userDir,
	projectRoots,
}: {
	userDir: string;
	projectRoots: readonly ProjectRoot[];
}) => {
	const found: Candidate[] = (await candidatesIn(userDir)).map((c) => ({ ...c, scope: "user" }));
	for (const root of projectRoots) {
		const project = await candidatesIn(projectExtensionsDir(root.path));
		found.push(
			...project.map((c) => ({ ...c, scope: "project" as const, projectId: root.projectId })),
		);
	}
	const unique = new Map<string, Candidate>();
	const duplicates: Candidate[] = [];
	for (const candidate of found) {
		if (unique.has(candidate.name)) duplicates.push(candidate);
		else unique.set(candidate.name, candidate);
	}
	return { candidates: [...unique.values()], duplicates };
};
