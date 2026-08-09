// App state under the data dir (THINKRAIL_DATA_DIR for dev/e2e isolation, else ~/.thinkrail).
// This is OUR state, never the agent's — pi's own session files live under ~/.pi/agent.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AppConfig, DEFAULT_CONFIG, type Project, type Workspace } from "@thinkrail/contracts";

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

/**
 * One terminal tab as written to disk, so a host restart gives its tabs back.
 *
 * `recorded` is the shell's last output window, restored as the revived tab's replay — the process is gone
 * either way (see `submodule-server-terminal`), so this is the picture, not the shell. A **PTY id is
 * deliberately never persisted**: attaching to an id that outlived its process is exactly the `Couldn't attach
 * - can't find terminal with id` failure Theia ships. Only `tabKey` is durable.
 */
export interface PersistedTerminalTab {
	tabKey: string;
	title: string;
	recorded?: string;
}

/** Terminal tabs per workspace id. */
export type PersistedTerminalSessions = Record<string, PersistedTerminalTab[]>;

export function loadTerminalSessions(): PersistedTerminalSessions {
	return readJson<PersistedTerminalSessions>("terminals.json", {});
}

export function saveTerminalSessions(sessions: PersistedTerminalSessions): void {
	writeJson("terminals.json", sessions);
}

/** OUR server-synced app settings. Missing/corrupt file, or missing keys, fall back to `DEFAULT_CONFIG`. */
export function loadConfig(): AppConfig {
	return { ...DEFAULT_CONFIG, ...readJson<Partial<AppConfig>>("config.json", {}) };
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

/**
 * The install identity for anonymous analytics — SERVER-ONLY by design: it must never ride the
 * wire-broadcast `config.json` (see `submodule-server-analytics`). `id` is minted once per install
 * and never rotated (turning analytics off only stops sending); `announced` records that the one-shot
 * `app_installed` event was sent.
 */
export interface InstallationRecord {
	id: string;
	announced: boolean;
}

/** Load `installation.json`, minting (and persisting) a fresh record on first read or corrupt file. */
export function ensureInstallation(): InstallationRecord {
	const raw = readJson<Partial<InstallationRecord>>("installation.json", {});
	if (typeof raw.id === "string" && raw.id.length > 0) {
		return { id: raw.id, announced: raw.announced === true };
	}
	const record: InstallationRecord = { id: randomUUID(), announced: false };
	saveInstallation(record);
	return record;
}

export function saveInstallation(record: InstallationRecord): void {
	writeJson("installation.json", record);
}
