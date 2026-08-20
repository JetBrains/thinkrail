// App state under the data dir (THINKRAIL_DATA_DIR for dev/e2e isolation, else ~/.thinkrail).
// This is OUR state, never the agent's — pi's own session files live under ~/.pi/agent.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	type Project,
	type Workspace,
	type WorkspaceLayoutSnapshot,
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

/** OUR server-synced app settings. Missing/corrupt fields fall back independently to defaults. */
export function loadConfig(): AppConfig {
	const raw = readJson<unknown>("config.json", {});
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(DEFAULT_CONFIG);
	const value = raw as Record<string, unknown>;
	const layoutValue =
		value.layout && typeof value.layout === "object" && !Array.isArray(value.layout)
			? (value.layout as Record<string, unknown>)
			: {};
	return {
		// Preserve unknown top-level fields so an older host does not erase a newer config extension when it
		// updates one setting it understands.
		...value,
		theme: typeof value.theme === "string" ? value.theme : DEFAULT_CONFIG.theme,
		analyticsEnabled:
			typeof value.analyticsEnabled === "boolean"
				? value.analyticsEnabled
				: DEFAULT_CONFIG.analyticsEnabled,
		terminalReplayKb:
			typeof value.terminalReplayKb === "number" && Number.isFinite(value.terminalReplayKb)
				? value.terminalReplayKb
				: DEFAULT_CONFIG.terminalReplayKb,
		layout: {
			defaultPresetId:
				typeof layoutValue.defaultPresetId === "string" &&
				layoutValue.defaultPresetId.length > 0 &&
				layoutValue.defaultPresetId.length <= 200
					? layoutValue.defaultPresetId
					: DEFAULT_CONFIG.layout.defaultPresetId,
			customPresets: Array.isArray(layoutValue.customPresets)
				? layoutValue.customPresets
				: DEFAULT_CONFIG.layout.customPresets,
			maxSideGroups:
				typeof layoutValue.maxSideGroups === "number" &&
				Number.isInteger(layoutValue.maxSideGroups) &&
				layoutValue.maxSideGroups >= 1 &&
				layoutValue.maxSideGroups <= 32
					? layoutValue.maxSideGroups
					: DEFAULT_CONFIG.layout.maxSideGroups,
		},
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

function workspaceLayoutFileId(workspaceId: string): string {
	return /^[A-Za-z0-9_-]+$/.test(workspaceId)
		? workspaceId
		: `~${Buffer.from(workspaceId).toString("base64url")}`;
}

function workspaceLayoutPaths(workspaceId: string): {
	file: string;
	backup: string;
	temp: string;
	backupTemp: string;
} {
	const directory = join(dataDir(), "layouts");
	const file = join(directory, `${workspaceLayoutFileId(workspaceId)}.json`);
	const backup = `${file}.bak`;
	return {
		file,
		backup,
		temp: `${file}.${process.pid}.tmp`,
		backupTemp: `${backup}.${process.pid}.tmp`,
	};
}

/** Read the persisted primary layout as untrusted JSON; the layout module validates/migrates it. */
export function loadWorkspaceLayout(workspaceId: string): unknown | null {
	const { file } = workspaceLayoutPaths(workspaceId);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as unknown;
	} catch {
		return null;
	}
}

/** Read the last-known-good layout copy as untrusted JSON. */
export function loadWorkspaceLayoutBackup(workspaceId: string): unknown | null {
	const { backup } = workspaceLayoutPaths(workspaceId);
	try {
		return JSON.parse(readFileSync(backup, "utf8")) as unknown;
	} catch {
		return null;
	}
}

/** Atomic per-workspace replacement: the validated previous snapshot becomes LKG before the new primary. */
export function saveWorkspaceLayout(
	snapshot: WorkspaceLayoutSnapshot,
	previous: WorkspaceLayoutSnapshot | null,
): void {
	const { file, backup, temp, backupTemp } = workspaceLayoutPaths(snapshot.workspaceId);
	mkdirSync(join(dataDir(), "layouts"), { recursive: true });
	if (previous) {
		writeFileSync(backupTemp, `${JSON.stringify(previous, null, "\t")}\n`);
		renameSync(backupTemp, backup);
	}
	writeFileSync(temp, `${JSON.stringify(snapshot, null, "\t")}\n`);
	renameSync(temp, file);
}

export function removeWorkspaceLayout(workspaceId: string): void {
	const { file, backup, temp, backupTemp } = workspaceLayoutPaths(workspaceId);
	for (const path of [file, backup, temp, backupTemp]) {
		try {
			unlinkSync(path);
		} catch {
			// Idempotent cleanup.
		}
	}
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
