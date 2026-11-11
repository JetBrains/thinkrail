import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
	DEFAULT_WORKSPACE_NAME,
	type DiffStats,
	type ExistingWorktreeCandidate,
	isSubagentMaxConcurrent,
	type OpenBranchReview,
	type Project,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	assertSafeRef,
	canonicalPath,
	changedFileArgs,
	currentBranch,
	git,
	gitAsync,
	headBranchAt,
	headShaAt,
	resolveDefaultBranch,
	resolveDiffRange,
	SLOW_GIT_TIMEOUT_MS,
	tryCurrentBranch,
} from "../git";
import { logger } from "../log";
import {
	dataDir,
	landsInChatsRoot,
	loadProjects,
	loadWorkspaces,
	saveWorkspaces,
} from "../persistence";
import { assertOutsideChatsRoot, getProjects, listProjects } from "../projects";
import {
	assertNotChatsContainer,
	assertNotChatWorkspace,
	isChatsContainer,
	isChatWorkspace,
} from "./chats";
import { creationBranchReserved, creationRecords, repointCreationBases } from "./creationRecords";
import { gitWorktreeEntries } from "./worktreeRegistry";

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

function existingHeads(project: Project): Set<string> {
	const result = git(
		project.path,
		["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads/"],
		{
			action: "list the project's branches",
		},
	);
	const heads = new Set<string>();
	if (result.ok) {
		for (const name of result.out.split("\n")) {
			if (name !== "") heads.add(name.toLowerCase());
		}
	}
	return heads;
}

function nameTakenAmong(heads: ReadonlySet<string>, project: Project, candidate: string): boolean {
	return (
		heads.has(candidate.toLowerCase()) ||
		existsSync(managedWorktreePath(project, candidate)) ||
		creationBranchReserved(project.id, candidate)
	);
}

function uniqueBranch(project: Project, base: string): string {
	const heads = existingHeads(project);
	if (!nameTakenAmong(heads, project, base)) return base;
	let n = 2;
	while (nameTakenAmong(heads, project, `${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

function nextAutoBranch(project: Project): string {
	const heads = existingHeads(project);
	let n = 1;
	while (nameTakenAmong(heads, project, `workspace-${n}`)) n += 1;
	return `workspace-${n}`;
}

function managedWorktreePath(project: Project, branch: string): string {
	return join(dataDir(), "worktrees", project.slug, branch);
}

function creationPaths(): Set<string> {
	return new Set(creationRecords().map((record) => canonicalPath(record.worktreePath)));
}

function openProjectById(projectId: string): Project {
	const project = listProjects().find((candidate) => candidate.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	assertNotChatsContainer(project);
	return project;
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
		...creationPaths(),
	]);
	return entries.flatMap((entry): ExistingWorktreeCandidate[] => {
		const path = canonicalPath(entry.path);
		if (entry.prunable || path === projectPath || representedPaths.has(path)) return [];
		if (landsInChatsRoot(entry.path)) return [];
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
	assertOutsideChatsRoot(requestedPath, "attached as a workspace");
	const wantedPath = canonicalPath(requestedPath);
	const projectPath = canonicalPath(project.path);
	if (wantedPath === projectPath) return ensureDefaultWorkspace(project);
	const assertNotCreating = () => {
		if (creationPaths().has(wantedPath))
			throw new Error("This worktree is still being created by ThinkRail");
	};
	assertNotCreating();

	const entries = await gitWorktreeEntries(project.path);
	assertNotCreating();
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

function adoptBranch(ws: Workspace, branch: string | null): boolean {
	return branch !== null && applyFolderTruth(ws, { branch, baseBranch: ws.baseBranch });
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

export interface ManagedWorkspacePlan {
	project: Project;
	name: string;
	branch: string;
	worktreePath: string;
	baseBranch: string;
	renamed?: true;
}

export function planManagedWorkspace(
	projectId: string,
	name?: string,
	baseRef?: string,
): ManagedWorkspacePlan {
	const project = openProjectById(projectId);
	const displayName = name ? toDisplayName(name) : null;
	const branch = displayName
		? uniqueBranch(project, toBranch(displayName))
		: nextAutoBranch(project);
	const base = baseRef?.trim();
	let baseBranch: string;
	if (base) baseBranch = base;
	else {
		const head = git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"], {
			action: "read the current branch",
		});
		baseBranch = head.ok ? head.out : "HEAD";
	}
	assertSafeRef(baseBranch);
	return {
		project,
		name: displayName ?? branch,
		branch,
		worktreePath: managedWorktreePath(project, branch),
		baseBranch,
		...(displayName ? { renamed: true as const } : {}),
	};
}

export function managedPathOwned(path: string): boolean {
	const wanted = canonicalPath(path);
	const within = (candidate: string) => {
		const rel = relative(wanted, canonicalPath(candidate));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	};
	return (
		loadWorkspaces().some((workspace) => canonicalPath(workspace.worktreePath) === wanted) ||
		loadProjects().some((project) => within(project.path))
	);
}

export function assertManagedPathFree(path: string): void {
	if (managedPathOwned(path))
		throw new CodedError(
			"WORKSPACE_PATH_TAKEN",
			`The workspace folder is already open in ThinkRail: ${path}`,
		);
}

export function registerManagedWorkspace(
	entry: Pick<Workspace, "id" | "projectId" | "name" | "branch" | "worktreePath" | "baseBranch"> & {
		renamed?: true;
	},
): Workspace {
	assertManagedPathFree(entry.worktreePath);
	const all = loadWorkspaces();
	const workspace: Workspace = {
		id: entry.id,
		projectId: entry.projectId,
		name: entry.name,
		branch: entry.branch,
		worktreePath: entry.worktreePath,
		baseBranch: entry.baseBranch,
		initialTerminalPending: true,
		lastActiveAt: Date.now(),
		...(entry.renamed ? { renamed: true } : {}),
	};
	ensureWorkspaceScratchDir(workspace);
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
	const gitignore = join(dir, ".gitignore");
	if (lstatSync(gitignore, { throwIfNoEntry: false })) return;
	try {
		writeFileSync(gitignore, "*\n", { flag: "wx" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
	}
}

function ensureDefaultWorkspace(project: Project): Workspace {
	const all = loadWorkspaces();
	const defaults = all.filter((w) => w.projectId === project.id && w.kind === "default");

	const existing = defaults[0];
	let truth: ReturnType<typeof folderTruth>;
	try {
		truth = folderTruth(project.path);
	} catch (err) {
		if (!existing) throw err;
		log.warn(`kept the stored branch of workspace ${existing.id}`, err);
		return existing;
	}
	const { branch, baseBranch } = truth;
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
		name: DEFAULT_WORKSPACE_NAME,
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

function readUserOwnedTruth(peek: Workspace) {
	if (peek.kind === "default")
		return { kind: "default" as const, ...folderTruth(peek.worktreePath) };
	const branch = tryCurrentBranch(peek.worktreePath);
	return branch === null ? null : { kind: "external" as const, branch };
}

function adoptManagedBranches(projectId: string): void {
	const all = loadWorkspaces();
	const changed: Workspace[] = [];
	for (const workspace of all) {
		if (workspace.kind !== undefined || workspace.projectId !== projectId) continue;
		if (adoptBranch(workspace, headBranchAt(workspace.worktreePath))) changed.push(workspace);
	}
	if (changed.length === 0) return;
	saveWorkspaces(all);
	for (const workspace of changed) emit({ kind: "updated", workspace });
}

function syncManagedBranch(workspaceId: string, strict = false): string | null {
	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === workspaceId);
	if (!workspace || workspace.kind !== undefined) return null;
	const live = headBranchAt(workspace.worktreePath, { strict });
	if (adoptBranch(workspace, live)) {
		saveWorkspaces(all);
		emit({ kind: "updated", workspace });
	}
	return live;
}

export function syncWorkspaceBranch(workspaceId: string, opts: { strict?: boolean } = {}): void {
	const peek = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!peek) return;
	if (peek.kind === undefined) {
		syncManagedBranch(workspaceId, opts.strict);
		return;
	}
	let truth: ReturnType<typeof readUserOwnedTruth>;
	try {
		truth = readUserOwnedTruth(peek);
	} catch (err) {
		if (opts.strict) throw err;
		log.warn(`kept the stored branch of workspace ${workspaceId}`, err);
		return;
	}
	if (!truth) return;

	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === workspaceId);
	const drifted =
		workspace?.kind === truth.kind &&
		(truth.kind === "default"
			? applyFolderTruth(workspace, truth)
			: adoptBranch(workspace, truth.branch));
	if (!drifted) return;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace });
}

function onOwnBranch(workspace: Pick<Workspace, "branch" | "worktreePath">): boolean {
	return workspace.branch === basename(workspace.worktreePath);
}

export function branchMoveOwed(
	workspace: Pick<Workspace, "renamed" | "branchNamePending">,
	by: string | undefined,
): boolean {
	return !workspace.renamed || (by !== undefined && workspace.branchNamePending === by);
}

function keptBranchReason(workspace: Workspace, live: string | null) {
	if (live === null) return "detached" as const;
	if (!onOwnBranch(workspace)) return "not-own" as const;
	return undefined;
}

export function renameWorkspace(
	id: string,
	requestedName: string,
	opts: { branch?: string; by?: string } = {},
) {
	const peek = loadWorkspaces().find((w) => w.id === id);
	if (peek?.kind === "default") throw new Error("The Default workspace cannot be renamed");
	if (peek?.kind === "external")
		throw new Error("An existing worktree cannot be renamed by ThinkRail");
	if (peek) assertNotChatWorkspace(peek, "renamed");
	const live = syncManagedBranch(id);
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	const project = getProjects().find((p) => p.id === ws.projectId);
	if (!project) throw new Error(`Unknown project: ${ws.projectId}`);

	const displayName = toDisplayName(requestedName);
	if (!displayName) throw new Error(`Invalid workspace name: ${requestedName}`);
	const requested = opts.branch?.trim() ? opts.branch : undefined;
	const movable = requested !== undefined && branchMoveOwed(ws, opts.by);
	const branchKept = movable ? keptBranchReason(ws, live) : undefined;
	const wanted = movable && !branchKept ? branchSlug(requested) : "";
	const branch = !wanted || wanted === ws.branch ? ws.branch : uniqueBranch(project, wanted);
	const branchChanged = branch !== ws.branch;
	if (branchChanged) {
		const moved = git(project.path, ["branch", "-m", ws.branch, branch], { timeoutMs: null });
		if (!moved.ok) throw new Error(`git branch -m failed: ${moved.err}`);
		repointCreationBases(project.id, ws.branch, branch);
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
	if (branchChanged) delete target.review;
	target.branch = branch;
	target.renamed = true;
	if (branchKept && opts.by) target.branchNamePending = opts.by;
	else delete target.branchNamePending;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: target });
	for (const w of repointed) emit({ kind: "updated", workspace: w });
	return { workspace: target, branchKept };
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

export function setWorkspaceSubagentMaxConcurrent(id: string, value: number | null): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	if (value !== null && !isSubagentMaxConcurrent(value)) {
		throw new Error("Subagent limit must be a whole number from 1 to 16");
	}
	if (value === null) delete ws.subagentMaxConcurrentOverride;
	else ws.subagentMaxConcurrentOverride = value;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export function setWorkspaceDiffBase(id: string, ref: string | null): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	assertNotChatWorkspace(ws, "given a diff base");
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
const observedActivityAt = new Map<string, number>();
const observedHeadSha = new Map<string, string>();

export function recordWorkspaceActivity(id: string, at: number = Date.now()): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) return null;
	const previous = ws.lastActiveAt ?? 0;
	const observed = Math.max(observedActivityAt.get(id) ?? 0, at);
	observedActivityAt.set(id, observed);
	const overridden = ws.settledOverride !== undefined;
	const changedAt =
		ws.review?.state === "merged" || ws.review?.state === "closed"
			? ws.review.changedAt
			: undefined;
	const reviewSettles = changedAt !== undefined && previous <= changedAt;
	if (!overridden && !reviewSettles && observed - previous < ACTIVITY_COALESCE_MS) return ws;
	if (observed > previous) ws.lastActiveAt = observed;
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
	const workspace = loadWorkspaces().find((candidate) => candidate.id === id);
	if (!workspace || isChatWorkspace(workspace)) return;
	const sha = headShaAt(workspace.worktreePath, { onTimeout: "return" });
	if (!sha) return;
	const previous = observedHeadSha.get(id);
	observedHeadSha.set(id, sha);
	if (previous !== undefined && previous !== sha) recordWorkspaceActivity(id);
}

export function seedWorkspaceHead(id: string): void {
	recordWorkspaceHead(id);
}

function setSettledOverride(id: string, override: "settled" | "active"): Workspace {
	const all = loadWorkspaces();
	const ws = all.find((workspace) => workspace.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	if (ws.kind === "default") throw new Error("The Default workspace cannot be settled");
	assertNotChatWorkspace(ws, "settled");
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
	if (!ws || ws.branch !== branch || isChatWorkspace(ws)) return null;
	const next = review ? reviewSnapshot(review) : undefined;
	const observed = observedActivityAt.get(id) ?? 0;
	const activityChanged = observed > (ws.lastActiveAt ?? 0);
	if (sameReview(ws.review, next) && !activityChanged) return ws;
	if (activityChanged) ws.lastActiveAt = observed;
	if (next) ws.review = next;
	else delete ws.review;
	saveWorkspaces(all);
	emit({ kind: "updated", workspace: ws });
	return ws;
}

export async function listWorkspaces(
	projectId: string,
	opts: { includeDiffStats?: boolean } = {},
): Promise<Workspace[]> {
	const project = getProjects().find((p) => p.id === projectId);
	if (project && isChatsContainer(project)) return projectRows(projectId);
	if (project) ensureDefaultWorkspace(project);
	for (const workspace of loadWorkspaces()) {
		if (workspace.projectId === projectId && workspace.kind === "external") {
			syncWorkspaceBranch(workspace.id);
		}
	}
	adoptManagedBranches(projectId);
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

export function forgetWorkspace(id: string): Workspace | null {
	const all = loadWorkspaces();
	const ws = all.find((w) => w.id === id);
	if (!ws) return null;
	if (ws.kind === "default") throw new Error("The Default workspace cannot be removed");
	assertNotChatWorkspace(ws, "removed here; delete the chat instead");
	saveWorkspaces(all.filter((w) => w.id !== id));
	observedActivityAt.delete(id);
	observedHeadSha.delete(id);
	emit({ kind: "removed", projectId: ws.projectId, id: ws.id });
	return ws;
}

export async function reclaimWorktree(ws: Workspace): Promise<void> {
	if (ws.kind === "default" || ws.kind === "external" || isChatWorkspace(ws)) return;
	const project = loadProjects().find((p) => p.id === ws.projectId);
	if (!project) return;
	if (resolve(ws.worktreePath) === resolve(project.path)) return;
	const removed = await gitAsync(project.path, ["worktree", "remove", "--force", ws.worktreePath], {
		timeoutMs: SLOW_GIT_TIMEOUT_MS,
	});
	if (!removed.ok) {
		await rm(ws.worktreePath, { recursive: true, force: true });
		await gitAsync(project.path, ["worktree", "prune"]);
	}
}

export async function removeWorkspace(id: string): Promise<void> {
	const ws = forgetWorkspace(id);
	if (ws) await reclaimWorktree(ws);
}

export async function workspaceDiffStats(id: string): Promise<DiffStats> {
	const ws = getWorkspace(id);
	assertNotChatWorkspace(ws, "diffed");
	const stats = await diffStats(ws);
	if (!stats) throw new Error(`Could not read the diff stats of ${ws.name}`);
	return stats;
}

export function getWorkspace(id: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === id);
	if (!ws) throw new Error(`Unknown workspace: ${id}`);
	return ws;
}
