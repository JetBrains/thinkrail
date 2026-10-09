import { randomUUID } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { McpProjectOverride, Project, ProjectPathStatus } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
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
	const home =
		(process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME) || homedir();
	const expanded = path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
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

/** pi's saved decision for a path: trusted, denied, `null` when it has none, `undefined` when unreadable. */
export type PiTrustSeed = (path: string) => boolean | null | undefined;
let piTrustSeed: PiTrustSeed | null = null;

export function setPiTrustSeed(seed: PiTrustSeed | null): void {
	piTrustSeed = seed;
}

export function migratePiResourceTrust(projects: Project[], seed: PiTrustSeed): boolean {
	let changed = false;
	for (const project of projects) {
		if (project.piResourceTrust !== undefined) continue;
		const decision = seed(project.path);
		if (decision === undefined) continue;
		project.piResourceTrust = decision === false ? "untrusted" : "granted";
		changed = true;
	}
	return changed;
}

export function getProjects(): Project[] {
	const projects = loadProjects();
	const slugged = ensureSlugs(projects);
	const migrated = piTrustSeed ? migratePiResourceTrust(projects, piTrustSeed) : false;
	if (slugged || migrated) saveProjects(projects);
	return projects;
}

export function openProject(inputPath: string): Project {
	const path = resolveProjectPath(inputPath);
	const root = gitToplevel(path);
	if (!root) throw new CodedError("NOT_GIT", `Not a git repository: ${path}`);

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
		throw new CodedError(
			"ALREADY_OPEN",
			`This folder is already open in ThinkRail as a workspace: ${root}`,
		);

	const taken = new Set(projects.map((p) => p.slug));
	const project: Project = {
		id: randomUUID(),
		name: basename(root),
		path: root,
		slug: uniqueSlug(slugify(basename(root)), taken),
		lastOpened: Date.now(),
		piResourceTrust: piTrustSeed?.(root) === true ? "granted" : "untrusted",
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
	options: { resources?: boolean } = {},
): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.trusted = trusted;
	if (!trusted) project.piResourceTrust = "untrusted";
	else if (options.resources === true) project.piResourceTrust = "granted";
	if (acknowledgedSkills !== undefined) project.acknowledgedSkills = acknowledgedSkills;
	saveProjects(projects);
	return project;
}

export function approveProjectMcpServer(id: string, name: string, fingerprint: string): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.mcpApprovals = { ...project.mcpApprovals, [name]: fingerprint };
	saveProjects(projects);
	return project;
}

export function setProjectMcpOverride(
	id: string,
	name: string,
	override: McpProjectOverride | null,
): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const overrides: Record<string, McpProjectOverride> = { ...project.mcpOverrides };
	if (override === null || (override.enabled === undefined && override.exposure === undefined)) {
		delete overrides[name];
	} else {
		// A server may be named `__proto__`: store it as an own property, never through the prototype.
		Object.defineProperty(overrides, name, {
			value: override,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	if (Object.keys(overrides).length === 0) delete project.mcpOverrides;
	else project.mcpOverrides = overrides;
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
