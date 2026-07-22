// Approval gate: before auto-running a project's Shared or Local hook, the exact material that would run
// must have been explicitly approved. Approvals are keyed by project id + hook name + `HookSource`, storing
// a sha256 of the approved material — editing the material (an inline command, or a script's file
// contents) invalidates that source's approval and the hook goes back to `hookAwaitingApproval` until
// re-approved. Shared and Local approve independently (combineMode `"both"` can run both for one event).
// Host-local only (`~/.thinkrail`), never the repo. "Material" is opaque here — the caller decides whether
// it's the command text (inline) or the script's file contents (script); this module just hashes it.
import { createHash } from "node:crypto";
import type { HookName, HookSource } from "@thinkrail/contracts";
import { loadHookApprovals, saveHookApprovals } from "../../persistence";

function hash(material: string): string {
	return createHash("sha256").update(material).digest("hex");
}

/** Whether `material` is the exact, currently-approved material for this project's `hook` + `source`. */
export function isApproved(
	projectId: string,
	hook: HookName,
	source: HookSource,
	material: string,
): boolean {
	return loadHookApprovals()[projectId]?.[hook]?.[source] === hash(material);
}

/**
 * Record `material` as the approved material for this project's `hook` + `source` (replaces any prior
 * approval for that source only — the other source's approval, if any, is untouched).
 */
export function approveHook(
	projectId: string,
	hook: HookName,
	source: HookSource,
	material: string,
): void {
	const all = loadHookApprovals();
	all[projectId] = {
		...all[projectId],
		[hook]: { ...all[projectId]?.[hook], [source]: hash(material) },
	};
	saveHookApprovals(all);
}
