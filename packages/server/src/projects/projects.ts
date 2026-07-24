import { randomUUID } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Project, ProjectPathStatus } from "@thinkrail/contracts";
import { git as runGit } from "../git";
import { loadProjects, saveProjects } from "../persistence";

/** The shared `git` runner, bound to the live `process.env` so runtime config overrides apply. */
function git(cwd: string, args: string[]) {
	return runGit(cwd, args, { env: process.env });
}

/** The git repo root for a path, or null if it isn't inside a git work tree. */
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

/**
 * Record the user's trust decision for a project and persist it. Trust gates loading the repo's committed
 * cross-agent skill aliases (`.claude/skills` etc.) — attacker-controlled for a cloned repo. Granting trust
 * passes the names present at that moment as `acknowledgedSkills`, so a skill that appears *later* (a pull /
 * branch) stays gated until separately confirmed. Returns the updated project so the wire can echo it back.
 * Throws on an unknown id.
 */
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

/** Add skill names to a project's acknowledged set (union; used to confirm skills that appeared later). */
export function acknowledgeProjectSkills(id: string, names: string[]): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.acknowledgedSkills = [...new Set([...(project.acknowledgedSkills ?? []), ...names])];
	saveProjects(projects);
	return project;
}

/** Set a skill's project-baseline enabled state (persisted in `disabledSkills`). */
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

/**
 * Turn a whole group on/off at the project baseline (`group` = a plugin name, a source tier, or the special
 * `@plugins`). A disabled group withholds all its skills — including ones added later — until re-enabled.
 */
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

/** Whether a project (by id) is trusted. Unknown or undecided → false (fail closed). */
export function isProjectTrusted(id: string): boolean {
	return getProjects().find((p) => p.id === id)?.trusted === true;
}

/**
 * Classify a candidate path so the UI can decide how to open it: an existing git repo (open directly),
 * a plain directory that can be `git init`ed (offer to initialise), a path that doesn't exist, or one
 * that exists but isn't a directory. Read-only — touches nothing.
 */
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

/**
 * Initialise a plain directory as a git repo, then open it as a project. The whole app is worktree-based
 * (a workspace is a `git worktree`, which needs a HEAD), so bootstrapping is `git init` + `git add -A` +
 * an **allow-empty** initial commit: it commits the folder's current contents when there are any, and
 * produces an empty commit when the folder is empty — either way the repo gets a HEAD so `worktree add`
 * works afterwards. Already-a-repo folders short-circuit to `openProject` (dedupe). Throws on a path that
 * is missing or not a directory (the UI guards this via `inspectProjectPath`, but the server is strict).
 *
 * **Identity fallback:** a fresh machine may have no `user.name`/`user.email`, which would make `commit`
 * fail. Each field is supplied as a one-off `-c` override **only when it isn't already configured**, so a
 * real global identity is never overridden. On any failure after `git init`, the half-created `.git` is
 * rolled back so a retry re-inits cleanly instead of opening a HEAD-less repo.
 */
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
		// Remove the `.git` we just created (path was `initable`) so a retry re-inits cleanly.
		rmSync(join(path, ".git"), { recursive: true, force: true });
		throw err;
	}

	return openProject(path);
}
