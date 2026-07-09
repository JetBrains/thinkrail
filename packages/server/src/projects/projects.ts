import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Project } from "@thinkrail/contracts";
import { loadProjects, saveProjects } from "../persistence";

/** The git repo root for a path, or null if it isn't inside a git work tree. */
function gitToplevel(path: string): string | null {
	const result = Bun.spawnSync(["git", "-C", path, "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (!result.success) return null;
	return new TextDecoder().decode(result.stdout).trim() || null;
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

/** A slug not already taken — `base`, else `base-2`, `base-3`, … (distinct projects can share a name). */
function uniqueSlug(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

/** Backfill slugs for any project missing one (older data). Returns true if anything changed. */
function ensureSlugs(projects: Project[]): boolean {
	const taken = new Set(projects.map((p) => p.slug).filter(Boolean));
	let changed = false;
	for (const project of projects) {
		if (!project.slug) {
			project.slug = uniqueSlug(slugify(project.name), taken);
			taken.add(project.slug);
			changed = true;
		}
	}
	return changed;
}

/** Projects with slugs guaranteed — backfills + persists older entries once. */
export function getProjects(): Project[] {
	const projects = loadProjects();
	if (ensureSlugs(projects)) saveProjects(projects);
	return projects;
}

/** Open a folder as a project (must be a git repo). Dedupes by repo root; bumps lastOpened. */
export function openProject(path: string): Project {
	const root = gitToplevel(path);
	if (!root) throw new Error(`Not a git repository: ${path}`);

	const projects = getProjects();
	const existing = projects.find((p) => p.path === root);
	if (existing) {
		existing.lastOpened = Date.now();
		saveProjects(projects);
		return existing;
	}

	const taken = new Set(projects.map((p) => p.slug));
	const project: Project = {
		id: randomUUID(),
		name: basename(root),
		path: root,
		slug: uniqueSlug(slugify(basename(root)), taken),
		lastOpened: Date.now(),
	};
	projects.push(project);
	saveProjects(projects);
	return project;
}

export function listProjects(): Project[] {
	return getProjects().sort((a, b) => b.lastOpened - a.lastOpened);
}

export function closeProject(id: string): void {
	saveProjects(loadProjects().filter((p) => p.id !== id));
}
