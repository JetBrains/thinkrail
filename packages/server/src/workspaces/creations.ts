import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
	listRemotes,
	remoteNameOf,
	remoteRefOid,
	remoteTrackingRef,
	resolveCommitOid,
	SLOW_GIT_TIMEOUT_MS,
} from "../git";
import { logger } from "../log";
import { dataDir, loadWorkspaces, type WorkspaceCreationRecord } from "../persistence";
import { listProjects } from "../projects";
import {
	addCreation,
	creationRecords,
	creationView,
	deleteCreation,
	emitCreation,
	findCreation,
	updateCreation,
} from "./creationRecords";
import { planManagedWorkspace, registerManagedWorkspace } from "./workspaces";
import { gitWorktreeEntries, samePath } from "./worktreeRegistry";

const log = logger("workspaces");

export const CHECKOUT_STALL_MS = 10 * 60_000;
const PROGRESS_PUSH_MS = 250;
const PROGRESS_LINE = /Updating files:\s+(\d+)%\s+\((\d+)\/(\d+)\)/;

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

class CreationAborted extends Error {}

function fail(code: WsErrorCode, message: string): never {
	throw new CodedError(code, message);
}

function projectOf(record: WorkspaceCreationRecord): Project {
	const project = listProjects().find((candidate) => candidate.id === record.projectId);
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
		.filter((line) => line && !PROGRESS_LINE.test(line) && !line.startsWith("Updating files:"));
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
		const record = findCreation(id);
		if (!record || !last) return;
		emitCreation({ kind: "changed", creation: { ...creationView(record), progress: last } });
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
					updateCreation(
						id,
						(record) => {
							record.progress = progress;
						},
						{ emit: false },
					);
				}
				if (timer) continue;
				timer = setTimeout(push, Math.max(0, PROGRESS_PUSH_MS - (Date.now() - lastPush)));
				timer.unref();
			}
		},
		stop() {
			clearTimeout(timer);
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

async function cleanupCreation(
	projectPath: string,
	record: WorkspaceCreationRecord,
): Promise<boolean> {
	const timeout = { timeoutMs: SLOW_GIT_TIMEOUT_MS };
	let entries = await gitWorktreeEntries(projectPath);
	if (entries.some((entry) => samePath(entry.path, record.worktreePath))) {
		const removed = await gitAsync(
			projectPath,
			["worktree", "remove", "--force", "--force", record.worktreePath],
			timeout,
		);
		if (!removed.ok) {
			log.warn(`could not remove the partial worktree ${record.worktreePath}: ${removed.err}`);
			return false;
		}
		entries = await gitWorktreeEntries(projectPath);
	}
	if (existsSync(record.worktreePath) && isManagedPath(record.worktreePath))
		rmSync(record.worktreePath, { recursive: true, force: true });
	if (!record.baseOid || entries.some((entry) => entry.branch === record.branch)) return true;
	const ref = `refs/heads/${record.branch}`;
	const deleted = await gitAsync(projectPath, ["update-ref", "-d", ref, record.baseOid], timeout);
	if (!deleted.ok && branchStillExists(projectPath, ref))
		log.warn(`left branch ${record.branch} in place after a failed create: ${deleted.err}`);
	return true;
}

function branchStillExists(projectPath: string, ref: string): boolean {
	return git(projectPath, ["show-ref", "--verify", "--quiet", ref], { onTimeout: "return" }).ok;
}

function removeStaleIndexLock(worktreePath: string): void {
	const lock = git(worktreePath, ["rev-parse", "--git-path", "index.lock"], {
		action: "locate the worktree index",
	});
	if (lock.ok && lock.out) rmSync(resolve(worktreePath, lock.out), { force: true });
}

async function prepare(id: string, project: Project, signal: AbortSignal): Promise<void> {
	let record = findCreation(id);
	if (!record) throw new CreationAborted();
	if (record.baseOid && !(await cleanupCreation(project.path, record)))
		fail("WORKTREE_ADD_FAILED", `Could not clear the earlier attempt at ${record.worktreePath}`);
	const checkoutBase = await ensureBaseFetched(project, record.baseBranch, signal);
	const baseOid =
		resolveCommitOid(project.path, checkoutBase) ??
		fail("WORKTREE_ADD_FAILED", `Could not resolve ${checkoutBase} to a commit`);
	record = updateCreation(
		id,
		(r) => {
			r.baseOid = baseOid;
		},
		{ emit: false },
	);
	if (existsSync(record.worktreePath))
		fail("WORKTREE_ADD_FAILED", `The workspace folder already exists: ${record.worktreePath}`);
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
	if (!added.ok)
		fail(
			"WORKTREE_ADD_FAILED",
			`git worktree add failed: ${added.err || "git exited with an error"}`,
		);
	updateCreation(id, (r) => {
		r.phase = "checking-out";
		delete r.progress;
	});
}

async function checkOut(id: string, signal: AbortSignal): Promise<void> {
	const record = findCreation(id);
	if (!record) throw new CreationAborted();
	removeStaleIndexLock(record.worktreePath);
	const progress = progressFeed(id);
	const checkout = await gitAsync(
		record.worktreePath,
		["checkout", "--progress", "-f", record.branch, "--"],
		{
			timeoutMs: Number.POSITIVE_INFINITY,
			idleTimeoutMs: stallMs,
			onStderr: progress.feed,
			signal,
		},
	);
	progress.stop();
	if (signal.aborted) throw new CreationAborted();
	if (checkout.failure === "timeout")
		fail(
			"WORKTREE_CHECKOUT_STALLED",
			`git checkout made no progress for ${stallMs >= 60_000 ? `${Math.round(stallMs / 60_000)} minutes` : `${Math.round(stallMs / 1000)} seconds`} and was stopped`,
		);
	if (!checkout.ok)
		fail(
			"WORKTREE_CHECKOUT_FAILED",
			`git checkout failed: ${checkoutFailureText(checkout.err) || "git exited with an error"}`,
		);
}

async function execute(id: string, signal: AbortSignal): Promise<Workspace> {
	const initial = findCreation(id);
	if (!initial) throw new Error(`Unknown workspace creation: ${id}`);
	let project: Project | undefined;
	try {
		project = projectOf(initial);
		if (initial.phase === "preparing") await prepare(id, project, signal);
		await checkOut(id, signal);
		const done = findCreation(id);
		if (!done) throw new CreationAborted();
		let workspace: Workspace;
		try {
			workspace = registerManagedWorkspace(done);
		} catch (err) {
			project = undefined;
			throw new CodedError("WORKSPACE_PATH_TAKEN", (err as Error).message);
		}
		let outcome: { sessionId?: string; kickoffError?: string } = {};
		if (handoff) {
			try {
				outcome = await handoff(workspace, done.kickoff);
			} catch (err) {
				outcome = { kickoffError: err instanceof Error ? err.message : String(err) };
			}
		}
		deleteCreation(id);
		emitCreation({
			kind: "removed",
			removed: { id, projectId: workspace.projectId, workspace, ...outcome },
		});
		return workspace;
	} catch (err) {
		if (err instanceof CreationAborted || signal.aborted) throw err;
		const message = err instanceof Error ? err.message : String(err);
		log.warn(`workspace creation ${id} failed`, err);
		const record = findCreation(id);
		let cleaned = false;
		if (record && project) {
			try {
				cleaned = await cleanupCreation(project.path, record);
			} catch (cleanupErr) {
				log.warn(`cleanup after the failed workspace creation ${id} failed`, cleanupErr);
			}
		}
		if (record)
			updateCreation(id, (r) => {
				r.state = "failed";
				const code = errorCodeOf(err);
				r.failure = { message, ...(code ? { code } : {}) };
				delete r.progress;
				if (cleaned) {
					delete r.baseOid;
					r.phase = "preparing";
				}
			});
		throw err;
	}
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
	const kickoff =
		opts.kickoff && (opts.kickoff.text || opts.kickoff.images?.length) ? opts.kickoff : undefined;
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
		...(kickoff ? { kickoff } : {}),
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
		if (findCreation(creation.id)?.state === "failed") deleteCreation(creation.id);
		emitCreation({ kind: "removed", removed: { id: creation.id, projectId } });
		throw err;
	}
}

export function listWorkspaceCreations(): WorkspaceCreation[] {
	return creationRecords().map(creationView);
}

export function resumeWorkspaceCreation(id: string): WorkspaceCreation {
	const record = findCreation(id);
	if (!record) throw new Error(`Unknown workspace creation: ${id}`);
	if (record.state === "running") return creationView(record);
	const updated = updateCreation(id, (r) => {
		r.state = "running";
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
	const project = listProjects().find((candidate) => candidate.id === record.projectId);
	if (project && record.state === "interrupted") await cleanupCreation(project.path, record);
	deleteCreation(id);
	emitCreation({ kind: "removed", removed: { id, projectId: record.projectId } });
	return record.kickoff ? { kickoff: record.kickoff } : {};
}

export function interruptWorkspaceCreations(): void {
	const workspaces = new Set(loadWorkspaces().map((workspace) => workspace.id));
	for (const record of creationRecords()) {
		if (record.state !== "running" || running.has(record.id)) continue;
		if (workspaces.has(record.id)) {
			deleteCreation(record.id);
			continue;
		}
		const project = listProjects().find((candidate) => candidate.id === record.projectId);
		if (!project) {
			deleteCreation(record.id);
			continue;
		}
		updateCreation(record.id, (r) => {
			r.state = "interrupted";
		});
	}
}

export async function dropProjectCreations(projectId: string): Promise<void> {
	for (const record of creationRecords()) {
		if (record.projectId !== projectId) continue;
		const job = running.get(record.id);
		if (job) {
			job.abort.abort();
			await job.done.catch(() => {});
		}
		const project = listProjects().find((candidate) => candidate.id === projectId);
		const current = findCreation(record.id);
		if (project && current) await cleanupCreation(project.path, current).catch(() => {});
		deleteCreation(record.id);
		emitCreation({ kind: "removed", removed: { id: record.id, projectId } });
	}
}

export async function stopWorkspaceCreations(): Promise<void> {
	const jobs = [...running.values()];
	for (const job of jobs) job.abort.abort();
	await Promise.all(jobs.map((job) => job.done.catch(() => {})));
}
