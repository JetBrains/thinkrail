import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	isComposerGrowthLimit,
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

export interface PersistedTerminalTab {
	tabKey: string;
	title: string;
	recorded?: string;
}

export type PersistedTerminalSessions = Record<string, PersistedTerminalTab[]>;

export function loadTerminalSessions(): PersistedTerminalSessions {
	return readJson<PersistedTerminalSessions>("terminals.json", {});
}

export function saveTerminalSessions(sessions: PersistedTerminalSessions): void {
	writeJson("terminals.json", sessions);
}

export function loadConfig(): AppConfig {
	const raw = readJson<unknown>("config.json", {});
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(DEFAULT_CONFIG);
	const value = raw as Record<string, unknown>;
	const layoutValue =
		value.layout && typeof value.layout === "object" && !Array.isArray(value.layout)
			? (value.layout as Record<string, unknown>)
			: {};
	return {
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
		composerGrowthLimit: isComposerGrowthLimit(value.composerGrowthLimit)
			? value.composerGrowthLimit
			: DEFAULT_CONFIG.composerGrowthLimit,
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
			maxBottomGroups:
				typeof layoutValue.maxBottomGroups === "number" &&
				Number.isInteger(layoutValue.maxBottomGroups) &&
				layoutValue.maxBottomGroups >= 1 &&
				layoutValue.maxBottomGroups <= 32
					? layoutValue.maxBottomGroups
					: DEFAULT_CONFIG.layout.maxBottomGroups,
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

export function loadWorkspaceLayout(workspaceId: string): unknown | null {
	const { file } = workspaceLayoutPaths(workspaceId);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as unknown;
	} catch {
		return null;
	}
}

export function loadWorkspaceLayoutBackup(workspaceId: string): unknown | null {
	const { backup } = workspaceLayoutPaths(workspaceId);
	try {
		return JSON.parse(readFileSync(backup, "utf8")) as unknown;
	} catch {
		return null;
	}
}

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
		} catch {}
	}
}

export interface InstallationRecord {
	id: string;
	announced: boolean;
}

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
