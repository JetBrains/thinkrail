import type { Ack, HookName } from "@thinkrail/contracts";
import { getTransport } from "../transport";

/**
 * Approve `command` for this project+hook, then immediately re-invoke it for this specific workspace.
 * Approving alone never re-runs anything (server-side, it's scoped to project+hook, not a workspace) —
 * this is the composition the approval dialog uses to actually bootstrap a workspace stuck at
 * `hookAwaitingApproval`. Idempotent if the command was already approved via a sibling workspace: the
 * approve call is then a no-op and the run call still does the real work.
 */
export async function approveAndRunHook(
	projectId: string,
	workspaceId: string,
	hook: HookName,
	command: string,
): Promise<void> {
	await getTransport().request("workspace.hooks.approve", { projectId, hook, command });
	await getTransport().request("workspace.hooks.run", { workspaceId, hook });
}

/** Re-invoke an already-approved hook for a specific workspace — the manual retry-after-failure action. */
export function runHookNow(workspaceId: string, hook: HookName): Promise<Ack> {
	return getTransport().request("workspace.hooks.run", { workspaceId, hook });
}
