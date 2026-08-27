import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join, sep } from "node:path";
import type { Project, ProjectPathStatus } from "@thinkrail/contracts";
import { canonicalPath, git } from "../git";
import {
	dataDir,
	loadProjects,
	loadWorkspaces,
	saveProjects,
	saveWorkspaces,
} from "../persistence";

function createdProjectsRoot(): string {
	return join(dataDir(), "projects");
}

const DRAFT_PROVISIONAL_NAME = "Project draft";

type ProjectPublisher = (project: Project) => void;
type ProjectRemovedPublisher = (id: string) => void;

let publishProject: ProjectPublisher | null = null;
let publishProjectRemoved: ProjectRemovedPublisher | null = null;

export function setProjectPublisher(fn: ProjectPublisher | null): void {
	publishProject = fn;
}

export function setProjectRemovedPublisher(fn: ProjectRemovedPublisher | null): void {
	publishProjectRemoved = fn;
}

function emit(project: Project): void {
	publishProject?.(project);
}

function emitRemoved(id: string): void {
	publishProjectRemoved?.(id);
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

export function openProject(path: string): Project {
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

export function inspectProjectPath(path: string): ProjectPathStatus {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(path);
	} catch {
		return { kind: "missing" };
	}
	if (!stat.isDirectory()) return { kind: "notDirectory" };
	return { kind: gitToplevel(path) ? "repo" : "initable" };
}

export function createDraftProject(): Project {
	const root = createdProjectsRoot();
	const dir = join(root, randomUUID());
	mkdirSync(dir, { recursive: true });
	try {
		const project = initProject(dir);
		const projects = getProjects();
		const record = projects.find((candidate) => candidate.id === project.id);
		if (!record) throw new Error(`Draft project vanished after init: ${dir}`);
		record.draft = true;
		record.name = DRAFT_PROVISIONAL_NAME;
		record.slug = uniqueSlug(
			slugify(DRAFT_PROVISIONAL_NAME),
			new Set(projects.filter((p) => p.id !== record.id).map((p) => p.slug)),
		);
		saveProjects(projects);
		emit(record);
		return record;
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

export function finalizeProjectByPath(cwd: string, name: string): Project {
	const wanted = canonicalPath(cwd);
	const projects = getProjects();
	const project = projects.find((candidate) => canonicalPath(candidate.path) === wanted);
	if (!project) throw new Error(`No project found for ${cwd}`);
	if (project.draft !== true) throw new Error(`Project is not a draft: ${project.name}`);
	return applyFinalize(projects, project, name);
}

export function finalizeProject(id: string, name: string): Project {
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	if (project.draft !== true) throw new Error(`Project is not a draft: ${project.name}`);
	return applyFinalize(projects, project, name);
}

function applyFinalize(projects: Project[], project: Project, name: string): Project {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("A project name is required");
	project.name = trimmed;
	project.slug = uniqueSlug(
		slugify(trimmed),
		new Set(projects.filter((p) => p.id !== project.id).map((p) => p.slug)),
	);
	delete project.draft;
	commitProjectBrief(project.path);
	saveProjects(projects);
	emit(project);
	return project;
}

const PROJECT_BRIEF = "goal-and-requirements.md";

function commitProjectBrief(path: string): void {
	if (!existsSync(join(path, PROJECT_BRIEF))) return;
	if (!git(path, ["add", "--", PROJECT_BRIEF]).ok) return;
	const identity: string[] = [];
	if (!git(path, ["config", "user.name"]).out) identity.push("-c", "user.name=ThinkRail");
	if (!git(path, ["config", "user.email"]).out)
		identity.push("-c", "user.email=thinkrail@localhost");
	git(path, [...identity, "commit", "-m", "Capture initial project concept"]);
}

export function discardDraftProject(id: string): Project | null {
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) return null;
	if (project.draft !== true) throw new Error(`Project is not a draft: ${project.name}`);
	const root = createdProjectsRoot();
	if (canonicalPath(project.path).startsWith(canonicalPath(root) + sep)) {
		rmSync(project.path, { recursive: true, force: true });
	}
	saveProjects(projects.filter((candidate) => candidate.id !== id));
	const workspaces = loadWorkspaces();
	const remaining = workspaces.filter((ws) => ws.projectId !== id);
	if (remaining.length !== workspaces.length) saveWorkspaces(remaining);
	emitRemoved(id);
	return project;
}

export function initProject(path: string): Project {
	const status = inspectProjectPath(path);
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
