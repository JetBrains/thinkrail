// Orchestrates one hook run: resolve its command (committed + host-local override), gate it behind
// approval, execute it, and publish every state transition through the injected publisher (the same
// inversion `workspaces`/`terminal`/`settings` use) so the host can fan it out over `workspace.hook`.
import type {
	HookName,
	HookStatus,
	Project,
	Workspace,
	WorkspaceHookEvent,
} from "@thinkrail/contracts";
import { loadHookOverrides, loadWorkspaces, saveWorkspaces } from "../../persistence";
import { approveHook, isApproved } from "./approvals";
import { loadHookConfig, resolveHookCommand } from "./config";
import { runShellCommand } from "./runner";

type HookPublisher = (event: WorkspaceHookEvent) => void;

// Injected by the host; `null` in unit tests → emits are silent no-ops.
let publishHookEvent: HookPublisher | null = null;

/** Install (or clear with `null`) the sink hook state transitions are fanned out through. */
export function setHookPublisher(fn: HookPublisher | null): void {
	publishHookEvent = fn;
}

/**
 * Persist `hook`'s latest state onto its workspace record (`Workspace.hookStatus`) — durability for a
 * reconnecting/reloaded client, not the live update path (an already-connected client updates from the
 * `workspace.hook` event itself). Best-effort: a workspace archived mid-run (record already gone) is a
 * silent no-op — there's nothing left to persist onto.
 */
function persistHookStatus(workspaceId: string, hook: HookName, status: HookStatus): void {
	const all = loadWorkspaces();
	const target = all.find((w) => w.id === workspaceId);
	if (!target) return;
	target.hookStatus = { ...target.hookStatus, [hook]: status };
	saveWorkspaces(all);
}

function emit(event: WorkspaceHookEvent): void {
	publishHookEvent?.(event);
	switch (event.kind) {
		case "hookAwaitingApproval":
			persistHookStatus(event.workspaceId, event.hook, {
				state: "awaitingApproval",
				command: event.command,
			});
			break;
		case "hookStarted":
			persistHookStatus(event.workspaceId, event.hook, { state: "running" });
			break;
		case "hookSucceeded":
			persistHookStatus(event.workspaceId, event.hook, { state: "succeeded" });
			break;
		case "hookFailed":
			persistHookStatus(event.workspaceId, event.hook, {
				state: "failed",
				exitCode: event.exitCode,
			});
			break;
		case "hookOutput":
			break; // ephemeral — never persisted
	}
}

/** A blocking hook's default ceiling — `onDelete`/`preMerge` are awaited by their caller. */
const DEFAULT_TIMEOUT_MS = 30_000;

function buildHookEnv(workspace: Workspace): Record<string, string | undefined> {
	return {
		...process.env,
		THINKRAIL_WORKSPACE_ID: workspace.id,
		THINKRAIL_WORKSPACE_PATH: workspace.worktreePath,
		THINKRAIL_WORKSPACE_BRANCH: workspace.branch,
		THINKRAIL_PROJECT_ID: workspace.projectId,
	};
}

/** Resolve `hook`'s command from this workspace's own worktree (committed) + the host-local override for
 * its project. */
function resolveCommand(
	hook: HookName,
	workspace: Workspace,
	project: Project,
): string | undefined {
	const committed = loadHookConfig(workspace.worktreePath);
	const override = loadHookOverrides()[project.id] ?? {};
	return resolveHookCommand(hook, committed, override);
}

/**
 * Run `hook` for this workspace/project if it has a resolved command and that command is approved. Never
 * throws — any failure (missing approval, non-zero exit, timeout, an unexpected error) resolves to
 * `ok: false`; callers decide what that means for their own hook (abort a merge, or just log it).
 */
async function runHook(
	hook: HookName,
	workspace: Workspace,
	project: Project,
	timeoutMs: number | undefined,
): Promise<{ ok: boolean }> {
	try {
		const command = resolveCommand(hook, workspace, project);
		if (!command) return { ok: true }; // nothing declared for this hook — not a failure

		if (!isApproved(project.id, hook, command)) {
			emit({ kind: "hookAwaitingApproval", workspaceId: workspace.id, hook, command });
			return { ok: false };
		}

		emit({ kind: "hookStarted", workspaceId: workspace.id, hook });
		const result = await runShellCommand({
			command,
			cwd: workspace.worktreePath,
			env: buildHookEnv(workspace),
			// `exactOptionalPropertyTypes` forbids passing an explicit `timeoutMs: undefined` — omit the key
			// entirely for fire-and-forget hooks instead.
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
			onChunk: (_stream, chunk) =>
				emit({ kind: "hookOutput", workspaceId: workspace.id, hook, chunk }),
		});
		if (result.ok) {
			emit({ kind: "hookSucceeded", workspaceId: workspace.id, hook });
		} else {
			emit({ kind: "hookFailed", workspaceId: workspace.id, hook, exitCode: result.exitCode });
		}
		return { ok: result.ok };
	} catch (error) {
		emit({ kind: "hookFailed", workspaceId: workspace.id, hook, exitCode: -1 });
		console.warn(`workspace hook ${hook} failed for ${workspace.id}: ${error}`);
		return { ok: false };
	}
}

/** Fire the `onCreate` hook in the background — never blocks workspace creation. Deferred to a microtask:
 * `runHook`'s own body runs synchronously up to its first `await` (normal JS async-function semantics), so
 * without this, `resolveCommand`/`isApproved`/the `hookStarted` emit would run inline on this call's stack
 * — this call must return before any of that happens. */
export function runOnCreateHook(workspace: Workspace, project: Project): void {
	queueMicrotask(() => void runHook("onCreate", workspace, project, undefined));
}

/** Run the `onDelete` hook before the worktree is removed. Best-effort: always resolves, never rejects —
 * `reclaimWorktree` proceeds with the removal regardless of the result. */
export async function runOnDeleteHook(workspace: Workspace, project: Project): Promise<void> {
	await runHook("onDelete", workspace, project, DEFAULT_TIMEOUT_MS);
}

/** Run the `preMerge` hook and report whether the merge should proceed — `false` (incl. on timeout or a
 * missing approval) means abort. */
export async function runPreMergeHook(workspace: Workspace, project: Project): Promise<boolean> {
	const { ok } = await runHook("preMerge", workspace, project, DEFAULT_TIMEOUT_MS);
	return ok;
}

/** Fire the `postMerge` hook in the background — never blocks the caller. Deferred to a microtask for the
 * same reason as `runOnCreateHook` above. */
export function runPostMergeHook(workspace: Workspace, project: Project): void {
	queueMicrotask(() => void runHook("postMerge", workspace, project, undefined));
}

export { approveHook };
