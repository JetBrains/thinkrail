// Orchestrates one hook's run: resolve its ordered list of run entries (Shared/Local, combined per the
// effective `CombineMode`), gate each entry behind its own per-source approval, execute it, and publish
// every state transition through the injected publisher (the same inversion `workspaces`/`terminal`/
// `settings` use) so the host can fan it out over `workspace.hook`.
import type {
	HookName,
	HookSource,
	HookStatus,
	Project,
	Workspace,
	WorkspaceHookEvent,
} from "@thinkrail/contracts";
import { loadHookOverrides, loadWorkspaces, saveWorkspaces } from "../../persistence";
import { approveHook, isApproved } from "./approvals";
import { loadHookConfig, type ResolvedHookEntry, resolveHookRun } from "./config";
import { runShellCommand } from "./runner";

type HookPublisher = (event: WorkspaceHookEvent) => void;

// Injected by the host; `null` in unit tests → emits are silent no-ops.
let publishHookEvent: HookPublisher | null = null;

/** Install (or clear with `null`) the sink hook state transitions are fanned out through. */
export function setHookPublisher(fn: HookPublisher | null): void {
	publishHookEvent = fn;
}

/**
 * Persist `hook`'s latest per-`HookSource` state onto its workspace record (`Workspace.hookStatus`) —
 * durability for a reconnecting/reloaded client, not the live update path (an already-connected client
 * updates from the `workspace.hook` event itself). Merges into the hook's existing entry so the sibling
 * source's last-known status (e.g. Shared sitting at `succeeded` while Local is now `running`) is never
 * clobbered. Best-effort: a workspace archived mid-run (record already gone) is a silent no-op — there's
 * nothing left to persist onto.
 */
function persistHookStatus(
	workspaceId: string,
	hook: HookName,
	source: HookSource,
	status: HookStatus,
): void {
	const all = loadWorkspaces();
	const target = all.find((w) => w.id === workspaceId);
	if (!target) return;
	target.hookStatus = {
		...target.hookStatus,
		[hook]: { ...target.hookStatus?.[hook], [source]: status },
	};
	saveWorkspaces(all);
}

function emit(event: WorkspaceHookEvent): void {
	publishHookEvent?.(event);
	switch (event.kind) {
		case "hookAwaitingApproval":
			persistHookStatus(event.workspaceId, event.hook, event.source, {
				state: "awaitingApproval",
				command: event.command,
			});
			break;
		case "hookStarted":
			persistHookStatus(event.workspaceId, event.hook, event.source, {
				state: "running",
				command: event.command,
			});
			break;
		case "hookSucceeded":
			persistHookStatus(event.workspaceId, event.hook, event.source, {
				state: "succeeded",
				command: event.command,
			});
			break;
		case "hookFailed":
			persistHookStatus(event.workspaceId, event.hook, event.source, {
				state: "failed",
				command: event.command,
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

/**
 * Run one resolved entry to completion, gating it behind its own approval first. Returns whether it's safe
 * to continue on to the next entry in the list — `true` only for a clean, approved, zero-exit run; `false`
 * for a missing script, unapproved material, a non-zero exit, or an unexpected error — which is exactly
 * what gives the caller its stop-on-first-non-clean-entry behavior. Never throws: an error the subprocess
 * layer itself raises (as opposed to a non-zero exit, which it reports normally) is caught and converted
 * into a `hookFailed`, the same public shape as any other failure.
 */
async function runHookEntry(
	hook: HookName,
	workspace: Workspace,
	project: Project,
	entry: ResolvedHookEntry,
	timeoutMs: number | undefined,
): Promise<boolean> {
	const { source, display } = entry;
	try {
		if (entry.missing) {
			emit({
				kind: "hookFailed",
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				projectId: project.id,
				hook,
				source,
				command: display,
				exitCode: -1,
			});
			return false;
		}
		// `approvalMaterial` is `null` only when `entry.missing` is set (nothing to hash) — already handled
		// above — but the type doesn't encode that link, so this null check both guards `isApproved` (which
		// takes a plain `string`) and doubles as the "may be null → not approved" case the caller must honor.
		if (
			entry.approvalMaterial === null ||
			!isApproved(project.id, hook, source, entry.approvalMaterial)
		) {
			emit({
				kind: "hookAwaitingApproval",
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				projectId: project.id,
				hook,
				source,
				command: display,
			});
			return false;
		}

		emit({
			kind: "hookStarted",
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			projectId: project.id,
			hook,
			source,
			command: display,
		});
		const result = await runShellCommand({
			...(entry.kind === "script" ? { script: entry.exec } : { command: entry.exec }),
			cwd: workspace.worktreePath,
			env: buildHookEnv(workspace),
			// `exactOptionalPropertyTypes` forbids passing an explicit `timeoutMs: undefined` — omit the key
			// entirely for fire-and-forget hooks instead.
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
			onChunk: (_stream, chunk) =>
				emit({
					kind: "hookOutput",
					workspaceId: workspace.id,
					workspaceName: workspace.name,
					projectId: project.id,
					hook,
					source,
					chunk,
				}),
		});
		if (result.ok) {
			emit({
				kind: "hookSucceeded",
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				projectId: project.id,
				hook,
				source,
				command: display,
			});
		} else {
			emit({
				kind: "hookFailed",
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				projectId: project.id,
				hook,
				source,
				command: display,
				exitCode: result.exitCode,
			});
		}
		return result.ok;
	} catch (error) {
		emit({
			kind: "hookFailed",
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			projectId: project.id,
			hook,
			source,
			command: display,
			exitCode: -1,
		});
		console.warn(`workspace hook ${hook} (${source}) failed for ${workspace.id}: ${error}`);
		return false;
	}
}

/**
 * Run `hook` for this workspace/project: resolve its ordered list of run entries — Shared/Local per the
 * effective `CombineMode` (`workspace.hookCombineMode`, falling back to the project's committed default,
 * falling back to `"both"`) — then run them one at a time, in that order. Stops at the first entry that
 * isn't a clean approved zero-exit run (`&&` semantics) and returns `{ ok: false }` without touching the
 * remaining entries; `{ ok: true }` only when every entry ran and succeeded, including the vacuous case
 * where the list is empty (nothing declared for this hook is not a failure). Never throws — any failure
 * mode (missing approval, a missing script, a non-zero exit, timeout, an unexpected error) resolves to
 * `ok: false`; callers decide what that means for their own hook (abort a merge, or just log it).
 */
async function runHook(
	hook: HookName,
	workspace: Workspace,
	project: Project,
	timeoutMs: number | undefined,
): Promise<{ ok: boolean }> {
	const committed = loadHookConfig(workspace.worktreePath);
	const mode = workspace.hookCombineMode ?? committed.combineMode ?? "both";
	const local = loadHookOverrides()[project.id] ?? {};
	const entries = resolveHookRun({
		hook,
		committed,
		local,
		mode,
		basePath: workspace.worktreePath,
	});

	for (const entry of entries) {
		const ok = await runHookEntry(hook, workspace, project, entry, timeoutMs);
		if (!ok) return { ok: false };
	}
	return { ok: true };
}

/** Fire the `onCreate` hook in the background — never blocks workspace creation. Deferred to a microtask:
 * `runHook`'s own body runs synchronously up to its first `await` (normal JS async-function semantics), so
 * without this, entry resolution/`isApproved`/the `hookStarted` emit would run inline on this call's stack
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

export { loadHookConfig, resolveHookCommand, resolveHookRun, writeHookConfig } from "./config";
export { approveHook, isApproved };
