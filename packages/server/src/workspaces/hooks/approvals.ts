// Approval gate: before auto-running a project's committed/override hook command, the exact command string
// must have been explicitly approved. Approvals are keyed by project id + hook name, storing a sha256 of
// the approved command — editing the command (committed or override) invalidates the approval and the
// hook goes back to `hookAwaitingApproval` until re-approved. Host-local only (`~/.thinkrail`), never the repo.
import { createHash } from "node:crypto";
import type { HookName } from "@thinkrail/contracts";
import { loadHookApprovals, saveHookApprovals } from "../../persistence";

function hash(command: string): string {
	return createHash("sha256").update(command).digest("hex");
}

/** Whether `command` is the exact, currently-approved command for this project's `hook`. */
export function isApproved(projectId: string, hook: HookName, command: string): boolean {
	return loadHookApprovals()[projectId]?.[hook] === hash(command);
}

/** Record `command` as the approved command for this project's `hook` (replaces any prior approval). */
export function approveHook(projectId: string, hook: HookName, command: string): void {
	const all = loadHookApprovals();
	all[projectId] = { ...all[projectId], [hook]: hash(command) };
	saveHookApprovals(all);
}
