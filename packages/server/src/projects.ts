import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Project } from "@thinkrail-pi/contracts";
import { loadProjects, saveProjects } from "./persistence";

/** The git repo root for a path, or null if it isn't inside a git work tree. */
function gitToplevel(path: string): string | null {
	const result = Bun.spawnSync(["git", "-C", path, "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (!result.success) return null;
	return new TextDecoder().decode(result.stdout).trim() || null;
}

/** Open a folder as a project (must be a git repo). Dedupes by repo root; bumps lastOpened. */
export function openProject(path: string): Project {
	const root = gitToplevel(path);
	if (!root) throw new Error(`Not a git repository: ${path}`);

	const projects = loadProjects();
	const existing = projects.find((p) => p.path === root);
	if (existing) {
		existing.lastOpened = Date.now();
		saveProjects(projects);
		return existing;
	}

	const project: Project = {
		id: randomUUID(),
		name: basename(root),
		path: root,
		lastOpened: Date.now(),
	};
	projects.push(project);
	saveProjects(projects);
	return project;
}

export function listProjects(): Project[] {
	return loadProjects().sort((a, b) => b.lastOpened - a.lastOpened);
}

export function closeProject(id: string): void {
	saveProjects(loadProjects().filter((p) => p.id !== id));
}
