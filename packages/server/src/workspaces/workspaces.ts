import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
	DiffStats,
	ExistingWorktreeCandidate,
	OpenBranchReview,
	Project,
	SettledRemovalPreview,
	SettledRemovalRefusal,
	SettledRemovalTarget,
	SubagentOverride,
	Workspace,
} from "@thinkrail/contracts";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	assertSafeRef,
	canonicalPath,
	changedFileArgs,
	countPushDivergence,
	currentBranch,
	git,
	gitAsync,
	gitHeadSha,
	listRemotes,
	remoteNameOf,
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

const MAX_BRANCH_SLUG = 60;

function branchSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, MAX_BRANCH_SLUG)
		.replace(/-+$/, "");
}

function toBranch(name: string): string {
	return branchSlug(name) || "workspace";
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

async function gitWorktreeEntries(repoPath: string): Promise<GitWorktreeEntry[]> {
	const listed = await gitAsync(repoPath, ["worktree", "list", "--porcelain", "-z"], { raw: true });
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

export async function listExistingWorktrees(
	projectId: string,
): Promise<ExistingWorktreeCandidate[]> {
	const project = openProjectById(projectId);
	const entries = await gitWorktreeEntries(project.path);
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

export async function openExistingWorktree(
	projectId: string,
	requestedPath: string,
): Promise<Workspace> {
	const project = openProjectById(projectId);
	if (!requestedPath) throw new Error("An existing worktree path is required");
	const wantedPath = canonicalPath(requestedPath);
	const projectPath = canonicalPath(project.path);
	if (wantedPath === projectPath) return ensureDefaultWorkspace(project);

	const entries = await gitWorktreeEntries(project.path);
	const entry = entries.find(
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
		initialTerminalPending: true,
		lastActiveAt: Date.now(),
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
	if (ws.branch !== truth.branch) delete ws.review;
	ws.branch = truth.branch;
	ws.baseBranch = truth.baseBranch;
	return true;
}

async function diffStats(ws: Workspace): Promise<DiffStats | undefined> {
	try {
		const result = await gitAsync(
			ws.worktreePath,
			changedFileArgs(await resolveDiffRange(ws), "--shortstat"),
		);
		if (!result.ok) throw new Error(result.err);
		if (!result.out) return { added: 0, removed: 0 };
		return {
			added: Number(/(\d+) insertion/.exec(result.out)?.[1] ?? 0),
			removed: Number(/(\d+) deletion/.exec(result.out)?.[1] ?? 0),
		};
	} catch {
		log.warn(`git diff --shortstat failed for workspace ${ws.id}`);
		return undefined;
	}
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
	const remotes = listRemotes(project.path);
	const remoteName = remoteNameOf(baseBranch, remotes);
	const remoteBase = remoteTrackingRef(baseBranch, remotes);
	const baseMissing = () => remoteRefOid(project.path, baseBranch) === null;
	if (remoteName && baseMissing()) {
		const fetched = await gitAsync(
			project.path,
			["fetch", remoteName, "--", baseBranch.slice(`${remoteName}/`.length)],
			{ network: true },
		);
		if (baseMissing())
			throw new Error(
				fetched.ok
					? `Could not fetch ${baseBranch}: ${remoteName} does not map it into refs/remotes — check remote.${remoteName}.fetch`
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
		initialTerminalPending: true,
		lastActiveAt: Date.now(),
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
		initialTerminalPending: true,
	};
	all.push(workspace);
	saveWorkspaces(all);
	emit({ kind: "created", workspace });
	return workspace;
}

export function completeInitialTerminalReservation(workspaceId: string): Workspace {
	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	if (!workspace.initialTerminalPending) return workspace;
	delete workspace.initialTerminalPending;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace });
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
	opts: { branch?: string } = {},
): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const project = getProjects().find((p) => p.id === ws.projectId);
	if (!project) throw new Error(`Unknown project: ${ws.projectId}`);

	if (ws.kind === "default") throw new Error("The Default workspace cannot be renamed");
	if (ws.kind === "external")
		throw new Error("An existing worktree cannot be renamed by ThinkRail");
	const displayName = toDisplayName(requestedName);
	if (!displayName) throw new Error(`Invalid workspace name: ${requestedName}`);
	const wanted = opts.branch === undefined ? "" : branchSlug(opts.branch);
	const branch = !wanted || wanted === ws.branch ? ws.branch : uniqueBranch(project, wanted);
	const branchChanged = branch !== ws.branch;
	if (branchChanged) {
		const moved = git(project.path, ["branch", "-m", ws.branch, branch]);
		if (!moved.ok) throw new Error(`git branch -m failed: ${moved.err}`);
	}

	const all = loadWorkspaces();
	const target = all.find((w) => w.id === id);
	if (!target) throw new Error(`Unknown workspace: ${id}`);
	const repointed: Workspace[] = [];
	if (branchChanged) {
		for (const w of all) {
			if (w.projectId !== target.projectId || w.id === target.id) continue;
			const changed = w.baseBranch === ws.branch || w.diffBase === ws.branch;
			if (w.baseBranch === ws.branch) w.baseBranch = branch;
			if (w.diffBase === ws.branch) w.diffBase = branch;
			if (changed) repointed.push(w);
		}
		if (target.baseBranch === ws.branch) target.baseBranch = branch;
		if (target.diffBase === ws.branch) target.diffBase = branch;
	}
	target.name = displayName;
	target.branch = branch;
	target.renamed = true;
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

export function setWorkspaceSubagentsOverride(
	id: string,
	override: SubagentOverride | null,
): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	if (override !== null && override !== "on" && override !== "off") {
		throw new Error("Invalid subagent override");
	}
	if (override === null) delete ws.subagentsOverride;
	else ws.subagentsOverride = override;
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

const ACTIVITY_COALESCE_MS = 60_000;
const observedHeadSha = new Map<string, string>();

export function recordWorkspaceActivity(id: string, at: number = Date.now()): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) return null;
	const previous = ws.lastActiveAt ?? 0;
	const overridden = ws.settledOverride !== undefined;
	const changedAt =
		ws.review?.state === "merged" || ws.review?.state === "closed"
			? ws.review.changedAt
			: undefined;
	const reviewSettles = changedAt !== undefined && previous <= changedAt;
	if (!overridden && !reviewSettles && at - previous < ACTIVITY_COALESCE_MS) return ws;
	if (at > previous) ws.lastActiveAt = at;
	if (overridden) {
		delete ws.settledOverride;
		delete ws.settledAt;
	}
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function backfillWorkspaceActivity(id: string, at: number): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) return null;
	if (ws.lastActiveAt !== undefined) return ws;
	ws.lastActiveAt = at;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function recordWorkspaceHead(id: string): void {
	if (!loadWorkspaces().some((workspace) => workspace.id === id)) return;
	const sha = gitHeadSha(id);
	if (!sha) return;
	const previous = observedHeadSha.get(id);
	observedHeadSha.set(id, sha);
	if (previous !== undefined && previous !== sha) recordWorkspaceActivity(id);
}

export function seedWorkspaceHead(id: string): void {
	if (observedHeadSha.has(id)) return;
	if (!loadWorkspaces().some((workspace) => workspace.id === id)) return;
	const sha = gitHeadSha(id);
	if (sha) observedHeadSha.set(id, sha);
}

function setSettledOverride(id: string, override: "settled" | "active"): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	if (ws.kind === "default") throw new Error("The Default workspace cannot be settled");
	ws.settledOverride = override;
	ws.settledAt = Date.now();
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function settleWorkspace(id: string): Workspace {
	return setSettledOverride(id, "settled");
}

export function unsettleWorkspace(id: string): Workspace {
	return setSettledOverride(id, "active");
}

function reviewSnapshot(review: OpenBranchReview): OpenBranchReview {
	return {
		kind: review.kind,
		number: review.number,
		...(review.url ? { url: review.url } : {}),
		...(review.state ? { state: review.state } : {}),
		...(review.changedAt !== undefined ? { changedAt: review.changedAt } : {}),
	};
}

function sameReview(a: OpenBranchReview | undefined, b: OpenBranchReview | undefined): boolean {
	if (!a || !b) return a === b;
	return (
		a.kind === b.kind &&
		a.number === b.number &&
		a.url === b.url &&
		a.state === b.state &&
		a.changedAt === b.changedAt
	);
}

export function setWorkspaceReview(
	id: string,
	review: OpenBranchReview | null,
	branch: string,
): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws || ws.branch !== branch) return null;
	const next = review ? reviewSnapshot(review) : undefined;
	if (sameReview(ws.review, next)) return ws;
	if (next) ws.review = next;
	else delete ws.review;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

async function unpushedCommits(ws: Workspace): Promise<number | null> {
	const divergence = await countPushDivergence(ws.worktreePath, ws.branch);
	if (divergence) return divergence.ahead;
	const tracking = await gitAsync(ws.worktreePath, ["for-each-ref", "--count=1", "refs/remotes"]);
	if (!tracking.ok) return null;
	if (!tracking.out) return 0;
	const counted = await gitAsync(ws.worktreePath, [
		"rev-list",
		"--count",
		"HEAD",
		"--not",
		"--remotes",
		"--",
	]);
	if (!counted.ok) return null;
	const parsed = Number.parseInt(counted.out, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

const REMOVAL_PREVIEW_CONCURRENCY = 4;

function nulCount(output: string): number {
	return output.split("\0").filter((field) => field.length > 0).length;
}

async function uncommittedCount(ws: Workspace): Promise<number | null> {
	const [tracked, untracked] = await Promise.all([
		gitAsync(
			ws.worktreePath,
			["diff", "--name-only", "-z", "--no-ext-diff", "--end-of-options", "HEAD", "--"],
			{ raw: true },
		),
		gitAsync(ws.worktreePath, ["ls-files", "-z", "--others", "--exclude-standard"], { raw: true }),
	]);
	if (!tracked.ok || !untracked.ok) return null;
	return nulCount(tracked.out) + nulCount(untracked.out);
}

export async function settledRemovalPreview(ids: string[]): Promise<SettledRemovalPreview[]> {
	const byId = new Map(loadWorkspaces().map((workspace) => [workspace.id, workspace]));
	const results: SettledRemovalPreview[] = new Array(ids.length);
	const queue = ids.map((id, index) => ({ id, index }));
	await Promise.all(
		Array.from({ length: Math.min(REMOVAL_PREVIEW_CONCURRENCY, queue.length) }, async () => {
			for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
				const ws = byId.get(next.id);
				if (!ws) {
					results[next.index] = { id: next.id, dirty: null, unpushed: null };
					continue;
				}
				const [dirty, unpushed] = await Promise.all([
					uncommittedCount(ws).catch(() => null),
					unpushedCommits(ws).catch(() => null),
				]);
				results[next.index] = { id: next.id, dirty, unpushed };
			}
		}),
	);
	return results;
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
		await Promise.all(rows.map(async (w) => [workspaceDiffKey(w), await diffStats(w)] as const)),
	);
	return projectRows(projectId).map((w) => {
		const stats = statsByKey.get(workspaceDiffKey(w));
		return stats ? { ...w, diffStats: stats } : w;
	});
}

function projectRows(projectId: string): Workspace[] {
	const rows = loadWorkspaces().filter((w) => w.projectId === projectId);
	rows.sort((a, b) => (a.kind === "default" ? -1 : 0) - (b.kind === "default" ? -1 : 0));
	return rows;
}

export function workspaceDiffKey(
	ws: Pick<Workspace, "id" | "worktreePath" | "baseBranch" | "diffBase">,
): string {
	return `${ws.id}\u0000${ws.worktreePath}\u0000${ws.baseBranch}\u0000${ws.diffBase ?? ""}`;
}

export function listWorkspaceRecords(projectId: string): Workspace[] {
	return loadWorkspaces().filter((w) => w.projectId === projectId);
}

export function listAllWorkspaceRecords(): Workspace[] {
	return loadWorkspaces();
}

function dropWorkspaceRecord(all: Workspace[], ws: Workspace): void {
	saveWorkspaces(all.filter((w) => w.id !== ws.id));
	observedHeadSha.delete(ws.id);
	emit({ kind: "removed", projectId: ws.projectId, id: ws.id });
}

export function forgetWorkspace(id: string): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) return null;
	if (ws.kind === "default") throw new Error("The Default workspace cannot be removed");
	dropWorkspaceRecord(all, ws);
	return ws;
}

export type ForgetQuietOutcome =
	| { ok: true; workspace: Workspace }
	| { ok: false; reason: Exclude<SettledRemovalRefusal, "running"> | "missing" };

/** Forgets the row only while the facts the client judged it settled from still hold. */
export function forgetQuietWorkspace(target: SettledRemovalTarget): ForgetQuietOutcome {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === target.id);
	if (!ws || ws.kind === "default") return { ok: false, reason: "missing" };
	if (ws.settledOverride === "active") return { ok: false, reason: "active" };
	if (ws.lastActiveAt !== target.lastActiveAt || ws.review?.state !== target.reviewState) {
		return { ok: false, reason: "changed" };
	}
	dropWorkspaceRecord(all, ws);
	return { ok: true, workspace: ws };
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
