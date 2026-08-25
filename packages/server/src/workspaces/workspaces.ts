import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
	DiffStats,
	ExistingWorktreeCandidate,
	Project,
	Workspace,
} from "@thinkrail/contracts";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	assertSafeRef,
	canonicalPath,
	changedFileArgs,
	currentBranch,
	git,
	gitAsync,
	remoteRefOid,
	remoteTrackingRef,
	resolveDefaultBranch,
	resolveDiffRange,
	tryCurrentBranch,
} from "../git";
import { logger } from "../log";
import { dataDir, loadProjects, loadWorkspaces, saveWorkspaces } from "../persistence";
import { getProjects, listProjects } from "../projects";

const log = logger("workspaces");

export type WorkspaceLifecycleEvent =
	| { kind: "created"; workspace: Workspace }
	| { kind: "updated"; workspace: Workspace }
	| { kind: "removed"; projectId: string; id: string };

type WorkspacePublisher = (event: WorkspaceLifecycleEvent) => void;

let publishLifecycle: WorkspacePublisher | null = null;

export function setWorkspacePublisher(fn: WorkspacePublisher | null): void {
	publishLifecycle = fn;
}

function emit(event: WorkspaceLifecycleEvent): void {
	publishLifecycle?.(event);
}

function toBranch(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "workspace"
	);
}

const MAX_DISPLAY_NAME = 60;

function toDisplayName(raw: string): string | null {
	const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME).trimEnd();
	return name.length > 0 ? name : null;
}

function branchExists(repoPath: string, branch: string): boolean {
	return git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

function nameTaken(project: Project, candidate: string): boolean {
	return (
		branchExists(project.path, candidate) ||
		existsSync(join(dataDir(), "worktrees", project.slug, candidate))
	);
}

function uniqueBranch(project: Project, base: string): string {
	if (!nameTaken(project, base)) return base;
	let n = 2;
	while (nameTaken(project, `${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

function nextAutoBranch(project: Project): string {
	let n = 1;
	while (nameTaken(project, `workspace-${n}`)) n += 1;
	return `workspace-${n}`;
}

function openProjectById(projectId: string): Project {
	const project = listProjects().find((candidate) => candidate.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	return project;
}

interface GitWorktreeEntry {
	path: string;
	branch?: string;
	prunable: boolean;
}

function gitWorktreeEntries(repoPath: string): GitWorktreeEntry[] {
	const listed = git(repoPath, ["worktree", "list", "--porcelain", "-z"], { raw: true });
	if (!listed.ok) throw new Error(`git worktree list failed: ${listed.err}`);
	const entries: GitWorktreeEntry[] = [];
	for (const record of listed.out.split("\0\0")) {
		if (!record) continue;
		let path: string | undefined;
		let branch: string | undefined;
		let prunable = false;
		for (const field of record.split("\0")) {
			if (field.startsWith("worktree ")) path = field.slice("worktree ".length);
			else if (field.startsWith("branch refs/heads/")) {
				branch = field.slice("branch refs/heads/".length);
			} else if (field === "prunable" || field.startsWith("prunable ")) prunable = true;
		}
		if (path) entries.push({ path, prunable, ...(branch ? { branch } : {}) });
	}
	return entries;
}

export function listExistingWorktrees(projectId: string): ExistingWorktreeCandidate[] {
	const project = openProjectById(projectId);
	const entries = gitWorktreeEntries(project.path);
	const projectPath = canonicalPath(project.path);
	const representedPaths = new Set([
		...loadProjects().map((knownProject) => canonicalPath(knownProject.path)),
		...loadWorkspaces().map((workspace) => canonicalPath(workspace.worktreePath)),
	]);
	return entries.flatMap((entry): ExistingWorktreeCandidate[] => {
		const path = canonicalPath(entry.path);
		if (entry.prunable || path === projectPath || representedPaths.has(path)) return [];
		return entry.branch
			? [{ path: entry.path, branch: entry.branch, status: "available" }]
			: [{ path: entry.path, status: "detached" }];
	});
}

export function openExistingWorktree(projectId: string, requestedPath: string): Workspace {
	const project = openProjectById(projectId);
	if (!requestedPath) throw new Error("An existing worktree path is required");
	const wantedPath = canonicalPath(requestedPath);
	const projectPath = canonicalPath(project.path);
	if (wantedPath === projectPath) return ensureDefaultWorkspace(project);

	const entry = gitWorktreeEntries(project.path).find(
		(candidate) => !candidate.prunable && canonicalPath(candidate.path) === wantedPath,
	);
	if (!entry) throw new Error("The selected path is not a registered worktree of this project");
	if (!entry.branch)
		throw new Error("Detached HEAD worktrees cannot be opened; create a branch first");
	const baseBranch = resolveDefaultBranch(project.path);

	const projectOwner = loadProjects().find(
		(candidate) => candidate.id !== projectId && canonicalPath(candidate.path) === wantedPath,
	);
	if (projectOwner)
		throw new Error("This worktree is already open under another ThinkRail project");

	const all = loadWorkspaces();
	const existing = all.find((workspace) => canonicalPath(workspace.worktreePath) === wantedPath);
	if (existing) {
		if (existing.projectId === projectId) return existing;
		throw new Error("This worktree is already open under another ThinkRail project");
	}

	const displayName =
		toDisplayName(basename(entry.path)) ?? toDisplayName(entry.branch) ?? "Existing worktree";
	const workspace: Workspace = {
		id: randomUUID(),
		projectId,
		kind: "external",
		name: displayName,
		branch: entry.branch,
		worktreePath: entry.path,
		baseBranch,
		renamed: true,
		initialTerminalEligible: true,
	};
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

function folderTruth(repoPath: string): { branch: string; baseBranch: string } {
	return { branch: currentBranch(repoPath), baseBranch: resolveDefaultBranch(repoPath) };
}

function applyFolderTruth(ws: Workspace, truth: { branch: string; baseBranch: string }): boolean {
	if (ws.branch === truth.branch && ws.baseBranch === truth.baseBranch) return false;
	ws.branch = truth.branch;
	ws.baseBranch = truth.baseBranch;
	return true;
}

async function diffStats(ws: Workspace): Promise<DiffStats | undefined> {
	const result = await gitAsync(
		ws.worktreePath,
		changedFileArgs(await resolveDiffRange(ws), "--shortstat"),
	);
	if (!result.ok) {
		log.warn(`git diff --shortstat failed for workspace ${ws.id}`);
		return undefined;
	}
	if (!result.out) return { added: 0, removed: 0 };
	return {
		added: Number(/(\d+) insertion/.exec(result.out)?.[1] ?? 0),
		removed: Number(/(\d+) deletion/.exec(result.out)?.[1] ?? 0),
	};
}

export async function createWorkspace(
	projectId: string,
	name?: string,
	baseRef?: string,
): Promise<Workspace> {
	const project = openProjectById(projectId);

	const displayName = name ? toDisplayName(name) : null;
	const branch = displayName
		? uniqueBranch(project, toBranch(displayName))
		: nextAutoBranch(project);
	const wsName = displayName ?? branch;

	const base = baseRef?.trim();
	let baseBranch: string;
	if (base) baseBranch = base;
	else {
		const head = git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
		baseBranch = head.ok ? head.out : "HEAD";
	}
	assertSafeRef(baseBranch);
	const remoteBase = remoteTrackingRef(baseBranch);
	const baseMissing = () => remoteRefOid(project.path, baseBranch) === null;
	if (remoteBase && baseMissing()) {
		const fetched = await gitAsync(project.path, [
			"fetch",
			"origin",
			"--",
			baseBranch.slice("origin/".length),
		]);
		if (baseMissing())
			throw new Error(
				fetched.ok
					? `Could not fetch ${baseBranch}: origin does not map it into refs/remotes — check remote.origin.fetch`
					: `Could not fetch ${baseBranch}: ${fetched.err || "git wrote no error output"}`,
			);
	}

	const worktreePath = join(dataDir(), "worktrees", project.slug, branch);
	mkdirSync(dirname(worktreePath), { recursive: true });
	const added = git(project.path, [
		"worktree",
		"add",
		worktreePath,
		"-b",
		branch,
		"--no-track",
		"--end-of-options",
		remoteBase ?? baseBranch,
	]);
	if (!added.ok) throw new Error(`git worktree add failed: ${added.err}`);

	const workspace: Workspace = {
		id: randomUUID(),
		projectId,
		name: wsName,
		branch,
		worktreePath,
		baseBranch,
		initialTerminalEligible: true,
		...(displayName ? { renamed: true } : {}),
	};
	ensureWorkspaceScratchDir(workspace);
	const all = loadWorkspaces();
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

export function ensureWorkspaceScratchDir(ws: Workspace): void {
	if (!statSync(ws.worktreePath, { throwIfNoEntry: false })?.isDirectory())
		throw new Error(`Workspace directory is missing: ${ws.worktreePath}`);
	let dir = ws.worktreePath;
	for (const part of WORKSPACE_CONTEXT_DIR.split("/")) {
		dir = join(dir, part);
		const entry = lstatSync(dir, { throwIfNoEntry: false });
		if (!entry) mkdirSync(dir);
		else if (!entry.isDirectory())
			throw new Error(`Refusing to seed the scratch dir: not a real directory: ${dir}`);
	}
	try {
		writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
	}
}

function ensureDefaultWorkspace(project: Project): Workspace {
	const truth = folderTruth(project.path);
	const { branch, baseBranch } = truth;
	const all = loadWorkspaces();
	const defaults = all.filter((w) => w.projectId === project.id && w.kind === "default");

	const existing = defaults[0];
	if (existing) {
		const extras = defaults.slice(1);
		if (extras.length > 0) {
			const keep = all.filter((w) => !extras.includes(w));
			all.length = 0;
			all.push(...keep);
		}
		const drifted = applyFolderTruth(existing, truth);
		if (extras.length > 0 || drifted) saveWorkspaces(all);
		for (const extra of extras) emit({ kind: "removed", projectId: project.id, id: extra.id });
		if (drifted) emit({ kind: "updated", workspace: existing });
		return existing;
	}

	const workspace: Workspace = {
		id: randomUUID(),
		projectId: project.id,
		kind: "default",
		name: "Default",
		branch,
		worktreePath: project.path,
		baseBranch,
		renamed: true,
		initialTerminalEligible: true,
	};
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

export function refreshUserOwnedWorkspace(workspaceId: string): void {
	const peek = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (peek?.kind !== "default" && peek?.kind !== "external") return;
	const truth =
		peek.kind === "default"
			? { kind: "default" as const, ...folderTruth(peek.worktreePath) }
			: (() => {
					const branch = tryCurrentBranch(peek.worktreePath);
					return branch === null ? null : { kind: "external" as const, branch };
				})();
	if (!truth) return;

	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === workspaceId);
	if (workspace?.kind !== truth.kind) return;
	if (truth.kind === "default") {
		if (!applyFolderTruth(workspace, truth)) return;
	} else {
		if (workspace.branch === truth.branch) return;
		workspace.branch = truth.branch;
	}
	saveWorkspaces(all);
	emit({ kind: "updated", workspace });
}

export function renameWorkspace(
	id: string,
	requestedName: string,
	opts: { lock?: boolean } = {},
): Workspace {
	const lock = opts.lock ?? true;
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const project = getProjects().find((p) => p.id === ws.projectId);
	if (!project) throw new Error(`Unknown project: ${ws.projectId}`);

	if (ws.kind === "default") throw new Error("The Default workspace cannot be renamed");
	if (ws.kind === "external")
		throw new Error("An existing worktree cannot be renamed by ThinkRail");
	const displayName = toDisplayName(requestedName);
	if (!displayName) throw new Error(`Invalid workspace name: ${requestedName}`);
	const wanted = toBranch(displayName);
	const branch = wanted === ws.branch ? ws.branch : uniqueBranch(project, wanted);
	if (branch !== ws.branch) {
		const moved = git(project.path, ["branch", "-m", ws.branch, branch]);
		if (!moved.ok) throw new Error(`git branch -m failed: ${moved.err}`);
	}

	const all = loadWorkspaces();
	const target = all.find((w) => w.id === id);
	if (!target) throw new Error(`Unknown workspace: ${id}`);
	const repointed: Workspace[] = [];
	for (const w of all) {
		if (w.projectId !== target.projectId || w.id === target.id) continue;
		const changed = w.baseBranch === ws.branch || w.diffBase === ws.branch;
		if (w.baseBranch === ws.branch) w.baseBranch = branch;
		if (w.diffBase === ws.branch) w.diffBase = branch;
		if (changed) repointed.push(w);
	}
	if (target.baseBranch === ws.branch) target.baseBranch = branch;
	if (target.diffBase === ws.branch) target.diffBase = branch;
	target.name = displayName;
	target.branch = branch;
	if (lock) target.renamed = true;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: target });
	for (const w of repointed) emit({ kind: "updated", workspace: w });
	return target;
}

export function setWorkspaceSkillOverride(
	id: string,
	name: string,
	override: "on" | "off" | null,
): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const overrides = { ...(ws.skillOverrides ?? {}) };
	if (override === null) delete overrides[name];
	else overrides[name] = override;
	if (Object.keys(overrides).length > 0) ws.skillOverrides = overrides;
	else delete ws.skillOverrides;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function setWorkspaceDiffBase(id: string, ref: string | null): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const wanted = ref?.trim();
	if (ref !== null && !wanted) throw new Error("A diff base must be a ref or null");
	if (wanted) assertSafeRef(wanted);
	if (!wanted || wanted === ws.baseBranch) delete ws.diffBase;
	else ws.diffBase = wanted;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export async function listWorkspaces(
	projectId: string,
	opts: { includeDiffStats?: boolean } = {},
): Promise<Workspace[]> {
	const project = getProjects().find((p) => p.id === projectId);
	if (project) ensureDefaultWorkspace(project);
	for (const workspace of loadWorkspaces()) {
		if (workspace.projectId === projectId && workspace.kind === "external") {
			refreshUserOwnedWorkspace(workspace.id);
		}
	}
	const rows = projectRows(projectId);
	if (opts.includeDiffStats === false) return rows;
	const statsByKey = new Map(
		await Promise.all(rows.map(async (w) => [diffStatsKey(w), await diffStats(w)] as const)),
	);
	return projectRows(projectId).map((w) => {
		const stats = statsByKey.get(diffStatsKey(w));
		return stats ? { ...w, diffStats: stats } : w;
	});
}

function projectRows(projectId: string): Workspace[] {
	const rows = loadWorkspaces().filter((w) => w.projectId === projectId);
	rows.sort((a, b) => (a.kind === "default" ? -1 : 0) - (b.kind === "default" ? -1 : 0));
	return rows;
}

function diffStatsKey(ws: Workspace): string {
	return `${ws.id}\u0000${ws.worktreePath}\u0000${ws.baseBranch}\u0000${ws.diffBase ?? ""}`;
}

export function listWorkspaceRecords(projectId: string): Workspace[] {
	return loadWorkspaces().filter((w) => w.projectId === projectId);
}

export function forgetWorkspace(id: string): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) return null;
	if (ws.kind === "default") throw new Error("The Default workspace cannot be removed");
	saveWorkspaces(all.filter((w) => w.id !== id));
	emit({ kind: "removed", projectId: ws.projectId, id: ws.id });
	return ws;
}

export function reclaimWorktree(ws: Workspace): void {
	if (ws.kind === "default" || ws.kind === "external") return;
	const project = loadProjects().find((p) => p.id === ws.projectId);
	if (!project) return;
	if (resolve(ws.worktreePath) === resolve(project.path)) return;
	const removed = git(project.path, ["worktree", "remove", "--force", ws.worktreePath]);
	if (!removed.ok) {
		rmSync(ws.worktreePath, { recursive: true, force: true });
		git(project.path, ["worktree", "prune"]);
	}
}

export function removeWorkspace(id: string): void {
	const ws = forgetWorkspace(id);
	if (ws) reclaimWorktree(ws);
}

export async function workspaceDiffStats(id: string): Promise<DiffStats> {
	const ws = getWorkspace(id);
	const stats = await diffStats(ws);
	if (!stats) throw new Error(`Could not read the diff stats of ${ws.name}`);
	return stats;
}

export function getWorkspace(id: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	return ws;
}
