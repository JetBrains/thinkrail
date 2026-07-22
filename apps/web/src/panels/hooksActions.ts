import type { Ack, CombineMode, HookName, HookValue } from "@thinkrail/contracts";
import { getTransport } from "../transport";

/**
 * Approve `command` for this project+hook+workspace, then immediately re-invoke it for that specific
 * workspace. Approving alone never re-runs anything (server-side, it only records the approval) — this is
 * the composition the approval dialog uses to actually bootstrap a workspace stuck at
 * `hookAwaitingApproval`. `workspaceId` anchors the approve call to that workspace's own worktree (matching
 * the paired run call) rather than the project root, which matters for a Shared `{script}` hook whose
 * worktree contents can differ from the root checkout — otherwise the hash this records would never match
 * what `run` re-checks. Idempotent if the command was already approved via a sibling workspace: the
 * approve call is then a no-op and the run call still does the real work.
 */
export async function approveAndRunHook(
	projectId: string,
	workspaceId: string,
	hook: HookName,
	command: string,
): Promise<void> {
	await getTransport().request("workspace.hooks.approve", {
		projectId,
		workspaceId,
		hook,
		command,
	});
	await getTransport().request("workspace.hooks.run", { workspaceId, hook });
}

/** Re-invoke an already-approved hook for a specific workspace — the manual retry-after-failure action. */
export function runHookNow(workspaceId: string, hook: HookName): Promise<Ack> {
	return getTransport().request("workspace.hooks.run", { workspaceId, hook });
}

/**
 * Read a project's declared hooks: the combine-mode, the Shared tier (committed in
 * `.thinkrail/hooks.json`), the Local tier (host-local overrides), a per-(hook,source) approval map, and
 * whether Shared can even be committed here (`sharedCommittable: false` when `.thinkrail/` is gitignored —
 * see `saveProjectHooks`, which then never attempts to write Shared).
 */
export function getProjectHooks(projectId: string) {
	return getTransport().request("project.hooks.get", { projectId });
}

/**
 * Write a project's combine-mode + Shared + Local hooks. Saving **approves** — on this machine — every
 * command it writes (Shared and Local alike), so a workspace created right after never sits at
 * `hookAwaitingApproval` for something the user just configured themselves; there is no separate approve
 * step in this dialog. An empty `shared` clears a previously-committed Shared hook rather than being a
 * no-op. Throws (never force-commits) if `shared` is non-empty for a project that ignores `.thinkrail/`.
 */
export function saveProjectHooks(
	projectId: string,
	payload: {
		combineMode: CombineMode;
		shared: Partial<Record<HookName, HookValue>>;
		local: Partial<Record<HookName, HookValue>>;
	},
): Promise<Ack> {
	return getTransport().request("project.hooks.save", { projectId, ...payload });
}
