// Committed hook config: `.thinkrail/hooks.json` in a workspace's own worktree — a normal tracked file, so
// it's already checked out the moment `git worktree add` creates the worktree. Host-local overrides (per
// developer, never touching the repo) come from `persistence`'s `hookOverrides.json` — see `hooks.ts`.
// Git-free by design (fs only) — the caller (`host/handlers.ts`'s `project.hooks.save`) commits the
// written file separately via `projects.ts`'s `commitProjectFile`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
	CombineMode,
	HookConfigFile,
	HookName,
	HookSource,
	HookValue,
} from "@thinkrail/contracts";
import { WORKSPACE_HOOKS_CONFIG_FILE, WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";

/** The empty config a missing/corrupt/non-object file falls back to. */
function defaultConfig(): HookConfigFile {
	return { version: 1, combineMode: "both", hooks: {} };
}

const COMBINE_MODES: readonly CombineMode[] = ["both", "shared", "local"];

/** Narrows a parsed `combineMode` field to a real `CombineMode` — anything else (missing, a typo, a
 * stray number) defaults to `"both"` rather than passing an arbitrary value through. */
function isCombineMode(value: unknown): value is CombineMode {
	return typeof value === "string" && (COMBINE_MODES as readonly string[]).includes(value);
}

/**
 * Parse a project's committed `.thinkrail/hooks.json` into the versioned `HookConfigFile` shape, with
 * back-compat for the legacy flat file (`{ onCreate: "…" }`, no `version`/`hooks` keys of its own) — that
 * whole object is treated as `hooks`, `combineMode` defaults to `"both"`. A new-shape file (has a `hooks`
 * key) is used as-is, `combineMode` defaulting to `"both"` only when absent. Missing file, malformed JSON,
 * or a parsed value that isn't a plain object all fall back to `defaultConfig()` — this never throws.
 */
export function loadHookConfig(dir: string): HookConfigFile {
	const file = join(dir, WORKSPACE_HOOKS_CONFIG_FILE);
	if (!existsSync(file)) return defaultConfig();
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return defaultConfig();
		}
		const obj = parsed as Record<string, unknown>;
		// Legacy flat file: neither a `version` nor a `hooks` key of its own ⇒ the whole object IS the
		// hooks map.
		if (!("version" in obj) && !("hooks" in obj)) {
			return {
				version: 1,
				combineMode: "both",
				hooks: obj as Partial<Record<HookName, HookValue>>,
			};
		}
		return {
			version: 1,
			combineMode: isCombineMode(obj.combineMode) ? obj.combineMode : "both",
			hooks: (obj.hooks as Partial<Record<HookName, HookValue>> | undefined) ?? {},
		};
	} catch {
		return defaultConfig();
	}
}

/**
 * Write `config` as `.thinkrail/hooks.json` in `projectPath` (creating `.thinkrail/` if needed) — a full
 * overwrite, not a merge, matching the committed file's own semantics (it's just JSON on disk; the caller
 * decides what the whole object should be). Pure fs write — no git; the caller commits it separately.
 */
export function writeHookConfig(projectPath: string, config: HookConfigFile): void {
	mkdirSync(join(projectPath, WORKSPACE_INTERNAL_DIR), { recursive: true });
	writeFileSync(
		join(projectPath, WORKSPACE_HOOKS_CONFIG_FILE),
		`${JSON.stringify(config, null, "\t")}\n`,
	);
}

/**
 * Resolve the command that should run for `hook`: a host-local override replaces the committed value
 * entirely (never merged) — if you override a hook, you own its whole command.
 *
 * @deprecated Superseded by `resolveHookRun`, which resolves both tiers (per `CombineMode`) into an
 * ordered list instead of one tier winning outright. Kept in place — and still called by `hooks.ts` and
 * `host/handlers.ts` — until those callers migrate; removed once its last caller is gone.
 */
export function resolveHookCommand(
	hook: HookName,
	committed: Partial<Record<HookName, string>>,
	override: Partial<Record<HookName, string>>,
): string | undefined {
	return override[hook] ?? committed[hook];
}

/** One resolved entry in a hook's ordered run list — see `resolveHookRun`. */
export interface ResolvedHookEntry {
	/** Which tier this entry came from — carried onto every event/status this entry produces. */
	source: HookSource;
	/** `"inline"` is meant to run via `sh -c "<exec>"`; `"script"` via `sh "<exec>"` — intended behavior
	 * once `hooks.ts`/`runner.ts` are wired to consume `ResolvedHookEntry` (a later task; today `runner.ts`
	 * only runs inline commands, resolved via the deprecated `resolveHookCommand`). */
	kind: "inline" | "script";
	/** Inline: the command text itself. Script: the resolved ABSOLUTE path to the script file. */
	exec: string;
	/** UI/event label: the command text (inline), or `` `script: <original path>` `` (script, unresolved). */
	display: string;
	/** What to hash for approval: the command text (inline), or the script's current contents (script) —
	 * `null` when the script file is missing (nothing to hash; see `missing`). */
	approvalMaterial: string | null;
	/** Set (never `false`) only for a script entry whose file didn't exist at resolve time. */
	missing?: boolean;
}

/** A Shared `script` path always resolves against `basePath`; a Local one only when it's not already absolute. */
function resolveScriptPath(source: HookSource, scriptPath: string, basePath: string): string {
	if (source === "local" && isAbsolute(scriptPath)) return scriptPath;
	return join(basePath, scriptPath);
}

/** Whether a parsed-JSON value is a well-formed `HookValue` — a string, `{ command: <string> }`, or
 * `{ script: <string> }`. `hooks.json`/`hookOverrides.json` are hand-editable and never validated on
 * write, so a value reaching `toEntry` may be anything JSON allows (`null`, `{}`, `[]`, `{ script: 123 }`,
 * …); this guard is what lets `toEntry` treat those as absent instead of crashing on them. */
function isHookValue(value: unknown): value is HookValue {
	if (typeof value === "string") return true;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return typeof record.command === "string" || typeof record.script === "string";
}

/** Turn one tier's raw `HookValue` into its resolved run entry — reading the script file (if any) now, so
 * approval/missing status is decided once, at resolve time, not re-derived later. Returns `null` for a
 * malformed value (see `isHookValue`) — treated as if that tier declared nothing for this hook, not as an
 * error. */
function toEntry(source: HookSource, value: unknown, basePath: string): ResolvedHookEntry | null {
	if (!isHookValue(value)) return null;
	if (typeof value === "string" || "command" in value) {
		const command = typeof value === "string" ? value : value.command;
		return { source, kind: "inline", exec: command, display: command, approvalMaterial: command };
	}
	const exec = resolveScriptPath(source, value.script, basePath);
	const display = `script: ${value.script}`;
	try {
		return { source, kind: "script", exec, display, approvalMaterial: readFileSync(exec, "utf8") };
	} catch {
		return { source, kind: "script", exec, display, approvalMaterial: null, missing: true };
	}
}

/**
 * Resolve `args.hook` into an ordered list of run entries per `args.mode`: `"both"` → `[shared?, local?]`
 * (Shared first, personal extras after — a tier with no value for this hook is skipped, not a gap in the
 * order); `"shared"` → `[shared?]`; `"local"` → `[local?]`. `args.basePath` is the worktree root at run
 * time or the project root at get-time — Shared script paths and relative Local script paths resolve
 * against it; an absolute Local script path is used as-is. Reads script files synchronously to fill
 * `approvalMaterial`/`missing` — never throws: a missing script becomes `missing: true`, and a malformed
 * `HookValue` (not a string, `{command}`, or `{script}` — hand-edited JSON is never validated on write)
 * is skipped entirely, as if that tier hadn't declared the hook.
 */
export function resolveHookRun(args: {
	hook: HookName;
	committed: HookConfigFile;
	local: Partial<Record<HookName, HookValue>>;
	mode: CombineMode;
	basePath: string;
}): ResolvedHookEntry[] {
	const { hook, committed, local, mode, basePath } = args;
	const entries: ResolvedHookEntry[] = [];
	const sharedValue = committed.hooks[hook];
	if (mode !== "local" && sharedValue !== undefined) {
		const entry = toEntry("shared", sharedValue, basePath);
		if (entry) entries.push(entry);
	}
	const localValue = local[hook];
	if (mode !== "shared" && localValue !== undefined) {
		const entry = toEntry("local", localValue, basePath);
		if (entry) entries.push(entry);
	}
	return entries;
}
