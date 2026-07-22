// App state under the data dir (THINKRAIL_DATA_DIR for dev/e2e isolation, else ~/.thinkrail).
// This is OUR state, never the agent's — pi's own session files live under ~/.pi/agent.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	type HookName,
	type HookValue,
	type Project,
	type Workspace,
} from "@thinkrail/contracts";

export function dataDir(): string {
	return process.env.THINKRAIL_DATA_DIR ?? join(homedir(), ".thinkrail");
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(join(dataDir(), file), "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, value: unknown): void {
	mkdirSync(dataDir(), { recursive: true });
	writeFileSync(join(dataDir(), file), `${JSON.stringify(value, null, "\t")}\n`);
}

export function loadProjects(): Project[] {
	return readJson<Project[]>("projects.json", []);
}

export function saveProjects(projects: Project[]): void {
	writeJson("projects.json", projects);
}

export function loadWorkspaces(): Workspace[] {
	return readJson<Workspace[]>("workspaces.json", []);
}

export function saveWorkspaces(workspaces: Workspace[]): void {
	writeJson("workspaces.json", workspaces);
}

/** OUR server-synced app settings. Missing/corrupt file, or missing keys, fall back to `DEFAULT_CONFIG`. */
export function loadConfig(): AppConfig {
	return { ...DEFAULT_CONFIG, ...readJson<Partial<AppConfig>>("config.json", {}) };
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

/**
 * Per-project, host-local override of a hook value (inline command or `{ script }` reference) — read by
 * `workspaces/hooks`; replaces (never merges with) the committed `.thinkrail/hooks.json` value for that
 * hook. Never touches the repo.
 */
export function loadHookOverrides(): Record<string, Partial<Record<HookName, HookValue>>> {
	return readJson("hookOverrides.json", {});
}

export function saveHookOverrides(
	overrides: Record<string, Partial<Record<HookName, HookValue>>>,
): void {
	writeJson("hookOverrides.json", overrides);
}

/**
 * Per-project, per-hook, per-`HookSource` record of which material (as a sha256) the user has approved to
 * auto-run — Shared and Local are approved independently since `combineMode: "both"` can run both for the
 * same event. Editing the approved material (the inline command, or a script's file contents) invalidates
 * that source's approval — the stored hash no longer matches.
 */
export function loadHookApprovals(): Record<
	string,
	Partial<Record<HookName, { shared?: string; local?: string }>>
> {
	return readJson("hookApprovals.json", {});
}

export function saveHookApprovals(
	approvals: Record<string, Partial<Record<HookName, { shared?: string; local?: string }>>>,
): void {
	writeJson("hookApprovals.json", approvals);
}
