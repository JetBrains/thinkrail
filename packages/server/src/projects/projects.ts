import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";
import type { Project, ProjectPathStatus } from "@thinkrail/contracts";
import { loadProjects, saveProjects } from "../persistence";

/**
 * Run a git command in `cwd`, capturing success + trimmed stdout. Local (not the `git` sub-module) to keep
 * `projects` a leaf. `env` is passed explicitly so the child honours the process's *current* `process.env`
 * (Bun snapshots the OS environ at startup and otherwise ignores later mutations) — no prod effect, but it
 * lets git config overrides take effect deterministically.
 */
function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "ignore",
		env: process.env,
	});
	return { ok: result.success, out: new TextDecoder().decode(result.stdout).trim() };
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
 * real global identity is never overridden.
 */
export function initProject(path: string): Project {
	const status = inspectProjectPath(path);
	if (status.kind === "missing") throw new Error(`No such folder: ${path}`);
	if (status.kind === "notDirectory") throw new Error(`Not a folder: ${path}`);
	if (status.kind === "repo") return openProject(path);

	const init = git(path, ["init"]);
	if (!init.ok) throw new Error(`git init failed: ${path}`);
	git(path, ["add", "-A"]);

	const identity: string[] = [];
	if (!git(path, ["config", "user.name"]).out) identity.push("-c", "user.name=ThinkRail");
	if (!git(path, ["config", "user.email"]).out)
		identity.push("-c", "user.email=thinkrail@localhost");
	const commit = git(path, [...identity, "commit", "--allow-empty", "-m", "Initial commit"]);
	if (!commit.ok) throw new Error(`git commit failed: ${path}`);

	return openProject(path);
}
