import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	Project,
	Workspace,
	WorkspaceCreation,
	WorkspaceKickoff,
	WsErrorCode,
} from "@thinkrail/contracts";
import { CodedError, errorCodeOf } from "@thinkrail/shared/codedError";
import {
	git,
	gitAsync,
	gitRunHook,
	listRemotes,
	nonInteractiveGitEnv,
	remoteNameOf,
	remoteRefOid,
	remoteTrackingRef,
	resolveCommitOid,
	SLOW_GIT_TIMEOUT_MS,
} from "../git";
import { logger } from "../log";
import { dataDir, loadWorkspaces, type WorkspaceCreationRecord } from "../persistence";
import { getProjects } from "../projects";
import {
	addCreation,
	creationRecords,
	creationView,
	deleteCreation,
	emitCreation,
	findCreation,
	updateCreation,
} from "./creationRecords";
import {
	assertManagedPathFree,
	managedPathOwned,
	planManagedWorkspace,
	registerManagedWorkspace,
} from "./workspaces";
import { gitWorktreeEntries, samePath } from "./worktreeRegistry";

const log = logger("workspaces");

export const CHECKOUT_STALL_MS = 10 * 60_000;
const PROGRESS_PUSH_MS = 250;
const PROGRESS_LINE = /(?:Updating files|Filtering content):\s+(\d+)%\s+\((\d+)\/(\d+)\)/;

export type CreationHandoff = (
	workspace: Workspace,
	kickoff: WorkspaceKickoff | undefined,
) => Promise<{ sessionId?: string; kickoffError?: string }>;

let handoff: CreationHandoff | null = null;
let stallMs = CHECKOUT_STALL_MS;

export function setWorkspaceCreationHandoff(fn: CreationHandoff | null): void {
	handoff = fn;
}

export function setCheckoutStallForTests(ms: number | undefined): void {
	stallMs = ms ?? CHECKOUT_STALL_MS;
}

const running = new Map<string, { abort: AbortController; done: Promise<Workspace> }>();
const discarding = new Set<string>();

class CreationAborted extends Error {}

function fail(code: WsErrorCode, message: string): never {
	throw new CodedError(code, message);
}

function projectOf(record: WorkspaceCreationRecord): Project {
	const project = getProjects().find((candidate) => candidate.id === record.projectId);
	if (!project) throw new Error(`Unknown project: ${record.projectId}`);
	return project;
}

function isManagedPath(path: string): boolean {
	const rel = relative(join(dataDir(), "worktrees"), resolve(path));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function checkoutFailureText(stderr: string): string {
	const lines = stderr
		.split(/[\r\n]+/)
		.map((line) => line.trim())
		.filter(
			(line) =>
				line &&
				!PROGRESS_LINE.test(line) &&
				!line.startsWith("Updating files:") &&
				!line.startsWith("Filtering content:"),
		);
	return lines.slice(-6).join("\n");
}

function progressFeed(id: string) {
	let pending = "";
	let last: { done: number; total: number } | undefined;
	let lastPercent = -1;
	let lastSavedDecile = -1;
	let lastPush = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const push = () => {
		timer = undefined;
		lastPush = Date.now();
		try {
			const record = findCreation(id);
			if (!record || !last) return;
			emitCreation({ kind: "changed", creation: { ...creationView(record), progress: last } });
		} catch (err) {
			log.warn(`could not publish the progress of workspace creation ${id}`, err);
		}
	};
	return {
		feed(text: string) {
			pending += text;
			const parts = pending.split(/[\r\n]/);
			pending = parts.pop() ?? "";
			for (const line of parts) {
				const match = PROGRESS_LINE.exec(line);
				if (!match) continue;
				const percent = Number(match[1]);
				last = { done: Number(match[2]), total: Number(match[3]) };
				if (percent === lastPercent) continue;
				lastPercent = percent;
				const decile = Math.floor(percent / 10);
				if (decile !== lastSavedDecile) {
					lastSavedDecile = decile;
					const progress = last;
					try {
						updateCreation(
							id,
							(record) => {
								record.progress = progress;
							},
							{ emit: false },
						);
					} catch (err) {
						log.warn(`could not save the progress of workspace creation ${id}`, err);
					}
				}
				if (timer) continue;
				timer = setTimeout(push, Math.max(0, PROGRESS_PUSH_MS - (Date.now() - lastPush)));
				timer.unref();
			}
		},
		stop() {
			if (!timer) return;
			clearTimeout(timer);
			push();
		},
	};
}

async function ensureBaseFetched(project: Project, baseBranch: string, signal: AbortSignal) {
	const remotes = listRemotes(project.path);
	const remoteName = remoteNameOf(baseBranch, remotes);
	const baseMissing = () => remoteRefOid(project.path, baseBranch) === null;
	if (remoteName && baseMissing()) {
		const fetched = await gitAsync(
			project.path,
			["fetch", remoteName, "--", baseBranch.slice(`${remoteName}/`.length)],
			{ network: true, signal },
		);
		if (signal.aborted) throw new CreationAborted();
		if (baseMissing())
			throw new Error(
				fetched.ok
					? `Could not fetch ${baseBranch}: ${remoteName} does not map it into refs/remotes — check remote.${remoteName}.fetch`
					: `Could not fetch ${baseBranch}: ${fetched.err || "git wrote no error output"}`,
			);
	}
	return remoteTrackingRef(baseBranch, remotes) ?? baseBranch;
}

interface CleanupResult {
	clean: boolean;
	removed: boolean;
}

async function deleteOwnBranch(
	projectPath: string,
	branch: string,
	baseOid: string,
	entries: { branch?: string }[],
): Promise<boolean> {
	const ref = `refs/heads/${branch}`;
	if (!branchStillExists(projectPath, ref)) return true;
	if (entries.some((entry) => entry.branch === branch)) return false;
	const deleted = await gitAsync(projectPath, ["update-ref", "-d", ref, baseOid], {
		timeoutMs: SLOW_GIT_TIMEOUT_MS,
	});
	if (deleted.ok || !branchStillExists(projectPath, ref)) return true;
	log.warn(`left branch ${branch} in place after a failed create: ${deleted.err}`);
	return false;
}

async function cleanupCreation(
	projectPath: string,
	record: WorkspaceCreationRecord,
): Promise<CleanupResult> {
	const untouched = { clean: true, removed: false };
	const taken = () => {
		if (!managedPathOwned(record.worktreePath)) return false;
		log.warn(`left ${record.worktreePath} alone: ThinkRail has it open now`);
		return true;
	};
	if (taken()) return untouched;
	let removed = false;
	let entries = await gitWorktreeEntries(projectPath);
	if (taken()) return untouched;
	if (entries.some((entry) => samePath(entry.path, record.worktreePath))) {
		const removal = await gitAsync(
			projectPath,
			["worktree", "remove", "--force", "--force", record.worktreePath],
			{ timeoutMs: SLOW_GIT_TIMEOUT_MS },
		);
		if (!removal.ok) {
			log.warn(`could not remove the partial worktree ${record.worktreePath}: ${removal.err}`);
			return { clean: false, removed: false };
		}
		removed = true;
		entries = await gitWorktreeEntries(projectPath);
	}
	if (taken()) return { clean: true, removed };
	if (existsSync(record.worktreePath) && isManagedPath(record.worktreePath)) {
		await rm(record.worktreePath, { recursive: true, force: true });
		removed = true;
	}
	if (!record.baseOid) return { clean: true, removed };
	const branchExisted = branchStillExists(projectPath, `refs/heads/${record.branch}`);
	const branchGone = await deleteOwnBranch(projectPath, record.branch, record.baseOid, entries);
	return { clean: branchGone, removed: removed || (branchExisted && branchGone) };
}

function branchStillExists(projectPath: string, ref: string): boolean {
	return git(projectPath, ["show-ref", "--verify", "--quiet", ref], { onTimeout: "return" }).ok;
}

async function prepare(id: string, project: Project, signal: AbortSignal): Promise<void> {
	let record = findCreation(id);
	if (!record) throw new CreationAborted();
	assertManagedPathFree(record.worktreePath);
	if (record.baseOid && !(await cleanupCreation(project.path, record)).clean)
		fail("WORKTREE_ADD_FAILED", `Could not clear the earlier attempt at ${record.worktreePath}`);
	if (record.baseOid)
		record = updateCreation(
			id,
			(r) => {
				delete r.baseOid;
			},
			{ emit: false },
		);
	const checkoutBase = await ensureBaseFetched(project, record.baseBranch, signal);
	const baseOid =
		resolveCommitOid(project.path, checkoutBase) ??
		fail("WORKTREE_ADD_FAILED", `Could not resolve ${checkoutBase} to a commit`);
	if (existsSync(record.worktreePath))
		fail("WORKTREE_ADD_FAILED", `The workspace folder already exists: ${record.worktreePath}`);
	record = updateCreation(
		id,
		(r) => {
			r.baseOid = baseOid;
		},
		{ emit: false },
	);
	mkdirSync(dirname(record.worktreePath), { recursive: true });
	const added = await gitAsync(
		project.path,
		[
			"worktree",
			"add",
			"--no-checkout",
			record.worktreePath,
			"-b",
			record.branch,
			"--no-track",
			"--end-of-options",
			baseOid,
		],
		{ timeoutMs: SLOW_GIT_TIMEOUT_MS, signal },
	);
	if (signal.aborted) throw new CreationAborted();
	if (!added.ok) {
		await deleteOwnBranch(
			project.path,
			record.branch,
			baseOid,
			await gitWorktreeEntries(project.path),
		).catch(() => false);
		updateCreation(
			id,
			(r) => {
				delete r.baseOid;
			},
			{ emit: false },
		);
		fail(
			"WORKTREE_ADD_FAILED",
			`git worktree add failed: ${added.err || "git exited with an error"}`,
		);
	}
	updateCreation(id, (r) => {
		r.phase = "checking-out";
		delete r.progress;
	});
}

function stallText(): string {
	return stallMs >= 60_000
		? `${Math.round(stallMs / 60_000)} minutes`
		: `${Math.round(stallMs / 1000)} seconds`;
}

function noHooksDir(): string {
	const dir = join(dataDir(), "no-hooks");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function checkoutConfig(projectPath: string): string[] {
	const config = ["-c", `core.hooksPath=${noHooksDir()}`];
	const workers = git(projectPath, ["config", "--get", "checkout.workers"], {
		onTimeout: "return",
	});
	if (!workers.ok) config.push("-c", "checkout.workers=0");
	return config;
}

async function checkOut(id: string, projectPath: string, signal: AbortSignal): Promise<void> {
	const record = findCreation(id);
	if (!record?.baseOid) throw new CreationAborted();
	assertManagedPathFree(record.worktreePath);
	const progress = progressFeed(id);
	const checkout = await gitAsync(
		record.worktreePath,
		[
			...checkoutConfig(projectPath),
			"checkout",
			"--progress",
			"--no-recurse-submodules",
			"-f",
			record.branch,
			"--",
		],
		{
			timeoutMs: Number.POSITIVE_INFINITY,
			idleTimeoutMs: stallMs,
			onStderr: progress.feed,
			env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
			signal,
		},
	);
	progress.stop();
	if (signal.aborted) throw new CreationAborted();
	if (checkout.failure === "timeout")
		fail(
			"WORKTREE_CHECKOUT_STALLED",
			`git checkout made no progress for ${stallText()} and was stopped`,
		);
	if (!checkout.ok)
		fail(
			"WORKTREE_CHECKOUT_FAILED",
			`git checkout failed: ${checkoutFailureText(checkout.err) || "git exited with an error"}`,
		);
	const hook = await gitRunHook(
		record.worktreePath,
		"post-checkout",
		["0".repeat(record.baseOid.length), record.baseOid, "1"],
		{ timeoutMs: Number.POSITIVE_INFINITY, idleTimeoutMs: stallMs, signal },
	);
	if (signal.aborted) throw new CreationAborted();
	if (hook.failure === "timeout")
		fail(
			"WORKTREE_CHECKOUT_STALLED",
			`The post-checkout hook made no progress for ${stallText()} and was stopped`,
		);
	if (!hook.ok)
		fail(
			"WORKTREE_CHECKOUT_FAILED",
			`The post-checkout hook failed: ${hook.err || "it exited with an error"}`,
		);
}

async function execute(id: string, signal: AbortSignal): Promise<Workspace> {
	const initial = findCreation(id);
	if (!initial) throw new Error(`Unknown workspace creation: ${id}`);
	let project: Project | undefined;
	try {
		project = projectOf(initial);
		await prepare(id, project, signal);
		await checkOut(id, project.path, signal);
		const done = findCreation(id);
		if (!done) throw new CreationAborted();
		return await handOff(registerManagedWorkspace(done), done.kickoff);
	} catch (err) {
		if (err instanceof CreationAborted || signal.aborted) throw err;
		const message = err instanceof Error ? err.message : String(err);
		log.warn(`workspace creation ${id} failed`, err);
		const record = findCreation(id);
		let cleanup: CleanupResult = { clean: false, removed: false };
		if (record?.baseOid && project && errorCodeOf(err) !== "WORKSPACE_PATH_TAKEN") {
			try {
				cleanup = await cleanupCreation(project.path, record);
			} catch (cleanupErr) {
				log.warn(`cleanup after the failed workspace creation ${id} failed`, cleanupErr);
			}
		}
		if (record)
			updateCreation(id, (r) => {
				r.state = "failed";
				const code = errorCodeOf(err);
				r.failure = {
					message,
					...(code ? { code } : {}),
					...(cleanup.clean && cleanup.removed ? { cleanedUp: true as const } : {}),
				};
				delete r.progress;
				if (cleanup.clean) delete r.baseOid;
			});
		throw err;
	}
}

function holdsLeftovers(record: WorkspaceCreationRecord): boolean {
	return record.baseOid !== undefined && record.failure?.code !== "WORKSPACE_PATH_TAKEN";
}

async function discard(record: WorkspaceCreationRecord): Promise<void> {
	if (discarding.has(record.id))
		throw new Error("This workspace creation is already being dismissed");
	discarding.add(record.id);
	try {
		const project = getProjects().find((candidate) => candidate.id === record.projectId);
		if (project && holdsLeftovers(record) && !(await cleanupCreation(project.path, record)).clean)
			throw new Error(`Could not remove the partial workspace at ${record.worktreePath}`);
		deleteCreation(record.id);
		emitCreation({ kind: "removed", removed: { id: record.id, projectId: record.projectId } });
	} finally {
		discarding.delete(record.id);
	}
}

async function handOff(workspace: Workspace, kickoff: WorkspaceKickoff | undefined) {
	let outcome: { sessionId?: string; kickoffError?: string } = {};
	if (handoff) {
		try {
			outcome = await handoff(workspace, kickoff);
		} catch (err) {
			outcome = { kickoffError: err instanceof Error ? err.message : String(err) };
		}
	}
	const latest = loadWorkspaces().find((candidate) => candidate.id === workspace.id) ?? workspace;
	deleteCreation(workspace.id);
	emitCreation({
		kind: "removed",
		removed: { id: workspace.id, projectId: latest.projectId, workspace: latest, ...outcome },
	});
	return latest;
}

function run(id: string): Promise<Workspace> {
	const abort = new AbortController();
	const done = execute(id, abort.signal).finally(() => running.delete(id));
	done.catch(() => {});
	running.set(id, { abort, done });
	return done;
}

export function startWorkspaceCreation(
	projectId: string,
	opts: { name?: string; baseRef?: string; kickoff?: WorkspaceKickoff } = {},
): WorkspaceCreation {
	const plan = planManagedWorkspace(projectId, opts.name, opts.baseRef);
	const record: WorkspaceCreationRecord = {
		id: randomUUID(),
		projectId,
		name: plan.name,
		branch: plan.branch,
		worktreePath: plan.worktreePath,
		baseBranch: plan.baseBranch,
		state: "running",
		phase: "preparing",
		startedAt: Date.now(),
		...(plan.renamed ? { renamed: true as const } : {}),
		...(opts.kickoff ? { kickoff: opts.kickoff } : {}),
	};
	addCreation(record);
	run(record.id);
	return creationView(record);
}

export function awaitWorkspaceCreation(id: string): Promise<Workspace> {
	const job = running.get(id);
	if (!job) throw new Error(`Workspace creation ${id} is not running`);
	return job.done;
}

export async function createWorkspace(
	projectId: string,
	name?: string,
	baseRef?: string,
): Promise<Workspace> {
	const creation = startWorkspaceCreation(projectId, {
		...(name ? { name } : {}),
		...(baseRef ? { baseRef } : {}),
	});
	try {
		return await awaitWorkspaceCreation(creation.id);
	} catch (err) {
		const record = findCreation(creation.id);
		if (record?.state === "failed") await discard(record).catch(() => {});
		throw err;
	}
}

export function listWorkspaceCreations(): WorkspaceCreation[] {
	return creationRecords().map(creationView);
}

export function retryWorkspaceCreation(id: string): WorkspaceCreation {
	const record = findCreation(id);
	if (!record) throw new Error(`Unknown workspace creation: ${id}`);
	if (record.state === "running") return creationView(record);
	if (discarding.has(id)) throw new Error("This workspace creation is being dismissed");
	if (record.failure?.code === "WORKSPACE_PATH_TAKEN")
		throw new Error("The workspace folder is now open elsewhere in ThinkRail; use Edit & retry");
	const updated = updateCreation(id, (r) => {
		r.state = "running";
		r.phase = "preparing";
		delete r.failure;
		delete r.progress;
	});
	run(id);
	return creationView(updated);
}

export async function dismissWorkspaceCreation(
	id: string,
): Promise<{ kickoff?: WorkspaceKickoff }> {
	const record = findCreation(id);
	if (!record) return {};
	if (record.state === "running")
		throw new Error("A running workspace creation cannot be dismissed");
	await discard(record);
	return record.kickoff ? { kickoff: record.kickoff } : {};
}

export function interruptWorkspaceCreations(): void {
	const workspaces = new Set(loadWorkspaces().map((workspace) => workspace.id));
	for (const record of creationRecords()) {
		if (record.state !== "running" || running.has(record.id)) continue;
		if (workspaces.has(record.id)) continue;
		const project = getProjects().find((candidate) => candidate.id === record.projectId);
		if (!project) {
			deleteCreation(record.id);
			continue;
		}
		updateCreation(record.id, (r) => {
			r.state = "interrupted";
		});
	}
}

export async function replayPendingHandoffs(): Promise<void> {
	const workspaces = new Map(loadWorkspaces().map((workspace) => [workspace.id, workspace]));
	for (const record of creationRecords()) {
		const workspace = workspaces.get(record.id);
		if (!workspace || running.has(record.id)) continue;
		await handOff(workspace, record.kickoff);
	}
}

export async function stopWorkspaceCreations(): Promise<void> {
	const jobs = [...running.values()];
	for (const job of jobs) job.abort.abort();
	await Promise.all(jobs.map((job) => job.done.catch(() => {})));
}
