// Committed hook config: `.thinkrail/hooks.json` in a workspace's own worktree — a normal tracked file, so
// it's already checked out the moment `git worktree add` creates the worktree. Host-local overrides (per
// developer, never touching the repo) come from `persistence`'s `hookOverrides.json` — see `hooks.ts`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HookName } from "@thinkrail/contracts";
import { WORKSPACE_HOOKS_CONFIG_FILE, WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";

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
 * Write `hooks` as `.thinkrail/hooks.json` in `projectPath` (creating `.thinkrail/` if needed) — a full
 * overwrite, not a merge, matching the committed file's own semantics (it's just JSON on disk; the caller
 * decides what the whole object should be). Pure fs write — no git. The caller (`host/handlers.ts`'s
 * `project.hooks.save`) commits it separately via `projects.ts`'s `commitProjectFile`, keeping this module
 * git-free per its SPEC.
 */
export function writeHookConfig(
	projectPath: string,
	hooks: Partial<Record<HookName, string>>,
): void {
	mkdirSync(join(projectPath, WORKSPACE_INTERNAL_DIR), { recursive: true });
	writeFileSync(
		join(projectPath, WORKSPACE_HOOKS_CONFIG_FILE),
		`${JSON.stringify(hooks, null, "\t")}\n`,
	);
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
