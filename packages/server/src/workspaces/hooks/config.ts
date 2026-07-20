// Committed hook config: `.thinkrail/hooks.json` in a workspace's own worktree — a normal tracked file, so
// it's already checked out the moment `git worktree add` creates the worktree. Host-local overrides (per
// developer, never touching the repo) come from `persistence`'s `hookOverrides.json` — see `hooks.ts`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookName } from "@thinkrail/contracts";
import { WORKSPACE_HOOKS_CONFIG_FILE } from "@thinkrail/shared/paths";

/** The committed hook commands declared in a workspace's own worktree. Missing/corrupt file → `{}`. */
export function loadHookConfig(worktreePath: string): Partial<Record<HookName, string>> {
	const file = join(worktreePath, WORKSPACE_HOOKS_CONFIG_FILE);
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Partial<Record<HookName, string>>;
	} catch {
		return {};
	}
}

/**
 * Resolve the command that should run for `hook`: a host-local override replaces the committed value
 * entirely (never merged) — if you override a hook, you own its whole command.
 */
export function resolveHookCommand(
	hook: HookName,
	committed: Partial<Record<HookName, string>>,
	override: Partial<Record<HookName, string>>,
): string | undefined {
	return override[hook] ?? committed[hook];
}
