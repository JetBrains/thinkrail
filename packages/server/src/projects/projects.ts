import { randomUUID } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Project, ProjectPathStatus } from "@thinkrail/contracts";
import { canonicalPath, git } from "../git";
import { loadProjects, loadWorkspaces, saveProjects } from "../persistence";

type ProjectPublisher = (project: Project) => void;

let publishProject: ProjectPublisher | null = null;

export function setProjectPublisher(fn: ProjectPublisher | null): void {
	publishProject = fn;
}

function emit(project: Project): void {
	publishProject?.(project);
}

function resolveProjectPath(path: string): string {
	const expanded =
		path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	if (!isAbsolute(expanded)) {
		throw new Error(`Project path must be absolute or start with ~/: ${path}`);
	}
	return resolve(expanded);
}

function gitToplevel(path: string): string | null {
	const result = git(path, ["rev-parse", "--show-toplevel"]);
	return result.ok ? result.out || null : null;
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

function uniqueSlug(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

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

export function getProjects(): Project[] {
	const projects = loadProjects();
	if (ensureSlugs(projects)) saveProjects(projects);
	return projects;
}

export function openProject(inputPath: string): Project {
	const path = resolveProjectPath(inputPath);
	const root = gitToplevel(path);
	if (!root) throw new Error(`Not a git repository: ${path}`);

	const projects = getProjects();
	const existing = projects.find((p) => p.path === root);
	if (existing) {
		delete existing.closed;
		existing.lastOpened = Date.now();
		saveProjects(projects);
		emit(existing);
		return existing;
	}

	const wanted = canonicalPath(root);
	if (loadWorkspaces().some((ws) => canonicalPath(ws.worktreePath) === wanted))
		throw new Error(`This folder is already open in ThinkRail as a workspace: ${root}`);

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
	emit(project);
	return project;
}

function newestFirst(projects: Project[]): Project[] {
	return projects.sort((a, b) => b.lastOpened - a.lastOpened);
}

export function listProjects(): Project[] {
	return newestFirst(getProjects().filter((project) => project.closed !== true));
}

export function listRecentProjects(): Project[] {
	return newestFirst(getProjects());
}

export function closeProject(id: string): Project {
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.closed = true;
	saveProjects(projects);
	emit(project);
	return project;
}

export function setProjectTrust(
	id: string,
	trusted: boolean,
	acknowledgedSkills?: string[],
): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.trusted = trusted;
	if (acknowledgedSkills !== undefined) project.acknowledgedSkills = acknowledgedSkills;
	saveProjects(projects);
	return project;
}

export function acknowledgeProjectSkills(id: string, names: string[]): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.acknowledgedSkills = [...new Set([...(project.acknowledgedSkills ?? []), ...names])];
	saveProjects(projects);
	return project;
}

export function setProjectSkillEnabled(id: string, name: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const disabled = new Set(project.disabledSkills ?? []);
	if (enabled) disabled.delete(name);
	else disabled.add(name);
	project.disabledSkills = [...disabled];
	saveProjects(projects);
	return project;
}

export function setProjectGroupEnabled(id: string, group: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const groups = new Set(project.disabledGroups ?? []);
	if (enabled) groups.delete(group);
	else groups.add(group);
	project.disabledGroups = [...groups];
	saveProjects(projects);
	return project;
}

export function isProjectTrusted(id: string): boolean {
	return getProjects().find((p) => p.id === id)?.trusted === true;
}

function inspectResolvedProjectPath(path: string): ProjectPathStatus {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(path);
	} catch {
		return { kind: "missing" };
	}
	if (!stat.isDirectory()) return { kind: "notDirectory" };
	return { kind: gitToplevel(path) ? "repo" : "initable" };
}

export function inspectProjectPath(inputPath: string): ProjectPathStatus {
	return inspectResolvedProjectPath(resolveProjectPath(inputPath));
}

export function initProject(inputPath: string): Project {
	const path = resolveProjectPath(inputPath);
	const status = inspectResolvedProjectPath(path);
	if (status.kind === "missing") throw new Error(`No such folder: ${path}`);
	if (status.kind === "notDirectory") throw new Error(`Not a folder: ${path}`);
	if (status.kind === "repo") return openProject(path);

	const init = git(path, ["init", "-b", "main"]);
	if (!init.ok) throw new Error(`git init failed: ${path}`);
	try {
		const added = git(path, ["add", "-A"]);
		if (!added.ok) throw new Error(`git add failed: ${path}`);

		const identity: string[] = [];
		if (!git(path, ["config", "user.name"]).out) identity.push("-c", "user.name=ThinkRail");
		if (!git(path, ["config", "user.email"]).out)
			identity.push("-c", "user.email=thinkrail@localhost");
		const commit = git(path, [...identity, "commit", "--allow-empty", "-m", "Initial commit"]);
		if (!commit.ok) throw new Error(`git commit failed: ${path}`);
	} catch (err) {
		rmSync(join(path, ".git"), { recursive: true, force: true });
		throw err;
	}

	return openProject(path);
}
