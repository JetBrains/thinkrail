import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	type IssueReference,
	type IssueSessionLaunch,
	isIssueReference,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export interface WorkspaceHandle {
	id: string;
	projectId: string;
	worktreePath: string;
	branch: string;
	/** Existing Workspace records omit kind for managed worktrees. */
	kind?: "default" | "external";
}

interface PendingWorkspace {
	state: "pending";
	worktreePath: string;
	branch: string;
}
interface CompletedWorkspace extends Omit<PendingWorkspace, "state"> {
	state: "completed";
	workspaceId: string;
	session?: { id: string };
}
export interface IssueWorkspaceRecord {
	projectId: string;
	reference: IssueReference;
	/** Durable uncertainty fence; only provable reconciliation of the recorded stage may clear it. */
	sessionPending?: { stage: "design" | "implementation"; workspaceId: string };
	design?: { workspaceId: string; sessionId?: string };
	implementation?: PendingWorkspace | CompletedWorkspace;
}

type Awaitable<T> = T | Promise<T>;
export interface IssueWorkspaceOptions {
	/** Local project id, not the provider project id. */
	projectId: string;
	projectPath(projectId: string): Awaitable<string>;
	load(key: string): Awaitable<IssueWorkspaceRecord | null>;
	/** Atomic, durable per-key replacement. This coordinator serializes within one host process. */
	save(key: string, record: IssueWorkspaceRecord): Awaitable<void>;
	/** The host's fresh proof that this issue may start implementation: it already ran the workflow
	 * start gate, so the issue's current label is in-progress or in-review. Never caller input. */
	findWorkspace(
		query: { workspaceId: string } | { worktreePath: string },
	): Awaitable<WorkspaceHandle | null>;
	/** Authoritative Git registry, including occupied/detached/prunable paths; branch is short. */
	listGitWorktrees(
		projectId: string,
	): Awaitable<readonly { path: string; branch: string | null; prunable?: boolean }[]>;
	/** Register a managed workspace at exactly this path and branch, or fail without choosing a suffix. */
	createWorkspaceAtPath(
		projectId: string,
		path: string,
		branch: string,
		/** Human-readable workspace name; the branch stays the exact reserved ref. */
		name: string,
	): Awaitable<WorkspaceHandle>;
	defaultWorkspace(projectId: string): Awaitable<WorkspaceHandle>;
	/** Look up the session in this workspace; do not hydrate or prompt it. */
	sessionExists(sessionId: string, workspaceId: string): Awaitable<false | "idle" | "busy">;
	/** Create an empty session only. Prompting is outside this coordinator. */
	createSession(workspaceId: string): Awaitable<string>;
	/** The session this Issue already bound for that stage and workspace; the recovery evidence. */
	boundSession?(
		stage: "design" | "implementation",
		workspaceId: string,
	): Awaitable<string | undefined>;
}

// Different remote bindings can contend for the same numeric path in a local project.
const tails = new Map<string, Promise<unknown>>();

function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue workspace requires reconciliation.");
}

function keyFor(projectId: string, ref: IssueReference): string {
	return JSON.stringify([projectId, ref.provider, ref.instanceUrl, ref.projectId, ref.number]);
}

function samePath(path: string, expected: string): boolean {
	return isAbsolute(path) && resolve(path) === expected;
}

async function directoryAt(path: string): Promise<boolean> {
	try {
		if (!(await lstat(path)).isDirectory()) stop();
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export function createIssueWorkspaceCoordinator(options: IssueWorkspaceOptions) {
	const { projectId } = options;

	async function run<T>(
		input: IssueReference,
		action: (key: string, record: IssueWorkspaceRecord) => Promise<T>,
		recover = false,
	): Promise<T> {
		if (!isIssueReference(input) || !projectId) stop();
		const reference = {
			provider: input.provider,
			instanceUrl: input.instanceUrl,
			projectId: input.projectId,
			number: input.number,
		};
		const key = keyFor(projectId, reference);
		const slot = JSON.stringify([projectId, reference.number]);
		const task = (tails.get(slot) ?? Promise.resolve())
			.catch(() => {})
			.then(async () => {
				const record = (await options.load(key)) ?? { projectId, reference };
				if (
					!isIssueReference(record.reference) ||
					keyFor(record.projectId, record.reference) !== key
				)
					stop();
				return action(key, recover ? await recoverPending(key, record) : rejectPending(record));
			});
		tails.set(slot, task);
		try {
			return await task;
		} catch {
			return stop();
		} finally {
			if (tails.get(slot) === task) tails.delete(slot);
		}
	}

	function rejectPending(record: IssueWorkspaceRecord): IssueWorkspaceRecord {
		if (record.sessionPending !== undefined) stop();
		return record;
	}

	/**
	 * A pending marker records that a session may have been created. The binding the host writes
	 * immediately after creation is the only proof of which session it was: adopt it when it exists,
	 * otherwise nothing bound this stage and the marker is cleared so the action can try again.
	 */
	async function recoverPending(
		key: string,
		record: IssueWorkspaceRecord,
	): Promise<IssueWorkspaceRecord> {
		const pending = record.sessionPending;
		if (!pending) return record;
		if (!options.boundSession) stop();
		const sessionId = await options.boundSession(pending.stage, pending.workspaceId);
		const recovered: IssueWorkspaceRecord = {
			projectId: record.projectId,
			reference: record.reference,
		};
		if (record.design) recovered.design = { ...record.design };
		if (record.implementation) recovered.implementation = { ...record.implementation };
		if (sessionId) {
			if (pending.stage === "design") {
				recovered.design = { workspaceId: pending.workspaceId, sessionId };
			} else {
				const implementation = recovered.implementation;
				if (
					implementation?.state !== "completed" ||
					implementation.workspaceId !== pending.workspaceId
				)
					stop();
				recovered.implementation = { ...implementation, session: { id: sessionId } };
			}
		}
		await options.save(key, recovered);
		return recovered;
	}

	async function projectRoot(): Promise<string> {
		const path = await options.projectPath(projectId);
		if (!isAbsolute(path)) stop();
		return realpath(path);
	}

	async function sessionStatus(workspaceId: string, sessionId?: string) {
		const status = sessionId ? await options.sessionExists(sessionId, workspaceId) : false;
		if (status === "busy") stop();
		return status;
	}

	async function newSession(workspaceId: string): Promise<string> {
		const sessionId = await options.createSession(workspaceId);
		if (!sessionId) stop();
		return sessionId;
	}

	async function implementationPathState(path: string) {
		await directoryAt(dirname(path)); // Refuse a symlink/junction before inspecting its child.
		const occupied = await directoryAt(path);
		const trees = (await options.listGitWorktrees(projectId)).filter((tree) =>
			samePath(tree.path, path),
		);
		return { occupied, trees };
	}

	function verifyWorkspace(
		ws: WorkspaceHandle | null,
		ownership: PendingWorkspace | CompletedWorkspace,
		path: string,
	): WorkspaceHandle {
		if (
			!ws?.id ||
			ws.projectId !== projectId ||
			ws.kind !== undefined ||
			!samePath(ws.worktreePath, path) ||
			ws.branch !== ownership.branch ||
			(ownership.state === "completed" && ws.id !== ownership.workspaceId)
		)
			stop();
		return ws;
	}

	async function verifyImplementation(
		ownership: PendingWorkspace | CompletedWorkspace,
		path: string,
	): Promise<WorkspaceHandle> {
		const { occupied, trees } = await implementationPathState(path);
		if (
			ownership.worktreePath !== path ||
			!ownership.branch ||
			!occupied ||
			trees.length !== 1 ||
			trees[0]?.branch !== ownership.branch ||
			trees[0].prunable
		)
			stop();
		const ws = await options.findWorkspace(
			ownership.state === "completed"
				? { workspaceId: ownership.workspaceId }
				: { worktreePath: path },
		);
		return verifyWorkspace(ws, ownership, path);
	}

	async function resolveImplementation(key: string, record: IssueWorkspaceRecord, path: string) {
		let ownership = record.implementation;
		let ws: WorkspaceHandle;
		if (ownership?.state === "pending") {
			const { occupied, trees } = await implementationPathState(path);
			const registered = await options.findWorkspace({ worktreePath: path });
			// An abandoned reservation that left no directory, Git entry or registration created nothing.
			if (!occupied && trees.length === 0 && !registered) ownership = undefined;
		}
		if (ownership) {
			ws = await verifyImplementation(ownership, path);
		} else {
			const { occupied, trees } = await implementationPathState(path);
			if (occupied || trees.length || (await options.findWorkspace({ worktreePath: path }))) stop();
			// The unpredictable reserved ref correlates a registered worktree with this create intent;
			// a user checkout at the same numeric path is not ownership evidence.
			ownership = {
				state: "pending",
				worktreePath: path,
				branch: `issue-${record.reference.number}-${randomUUID()}`,
			};
			await options.save(key, { ...record, implementation: ownership });
			ws = verifyWorkspace(
				await options.createWorkspaceAtPath(
					projectId,
					path,
					ownership.branch,
					`issue-${record.reference.number}`,
				),
				ownership,
				path,
			);
		}
		if (ownership.state === "completed") return ownership;
		const completed: CompletedWorkspace = { ...ownership, state: "completed", workspaceId: ws.id };
		await options.save(key, { ...record, implementation: completed });
		return completed;
	}

	return {
		ownedImplementation(reference: IssueReference): Promise<WorkspaceHandle> {
			return run(reference, async (_key, record) => {
				const ownership = record.implementation;
				if (ownership?.state !== "completed" || !ownership.workspaceId) stop();
				const path = join(await projectRoot(), ".worktrees", `issue-${record.reference.number}`);
				return verifyImplementation(ownership, path);
			});
		},
		design(reference: IssueReference): Promise<IssueSessionLaunch> {
			return run(
				reference,
				async (key, record) => {
					const root = await projectRoot();
					const ws = await options.defaultWorkspace(projectId);
					if (
						!ws.id ||
						ws.projectId !== projectId ||
						ws.kind !== "default" ||
						!samePath(ws.worktreePath, root)
					)
						stop();
					const workspaceId = ws.id;
					const existing =
						record.design?.workspaceId === workspaceId ? record.design.sessionId : undefined;
					if (existing && (await sessionStatus(workspaceId, existing)) === "idle")
						return { workspaceId, sessionId: existing };
					await options.save(key, {
						...record,
						design: { workspaceId, ...(existing ? { sessionId: existing } : {}) },
						sessionPending: { stage: "design", workspaceId },
					});
					const sessionId = await newSession(workspaceId);
					await options.save(key, { ...record, design: { workspaceId, sessionId } });
					return { workspaceId, sessionId };
				},
				true,
			);
		},
		implementation(reference: IssueReference): Promise<IssueSessionLaunch> {
			return run(
				reference,
				async (key, record) => {
					// The workflow start gate moves the issue to in-progress; the coordinator never trusts
					// a caller-supplied stage or version and reuses the recorded session for every re-entry.
					const path = join(await projectRoot(), ".worktrees", `issue-${record.reference.number}`);
					const ownership = await resolveImplementation(key, record, path);
					const { workspaceId, session } = ownership;
					const status = await sessionStatus(workspaceId, session?.id);
					if (session && status === "idle") return { workspaceId, sessionId: session.id };
					await options.save(key, {
						...record,
						implementation: ownership,
						sessionPending: { stage: "implementation", workspaceId },
					});
					const sessionId = await newSession(workspaceId);
					await options.save(key, {
						...record,
						implementation: { ...ownership, session: { id: sessionId } },
					});
					return { workspaceId, sessionId };
				},
				true,
			);
		},
	};
}
