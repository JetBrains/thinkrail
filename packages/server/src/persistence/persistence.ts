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

/**
 * Which `(project, remote)` pairs a **user-initiated** operation has authenticated against successfully.
 * SERVER-ONLY, exactly like `installation.json`: it is inference about the user's machine, not app state a
 * client needs, and it must never ride a broadcast.
 *
 * Keyed by `projectId` + NUL + remote name. NUL because neither component may contain it, so two different
 * pairs can never collide into one key the way a `:`-joined key could (`"a:b" + "c"` vs `"a" + "b:c"`).
 */
export type RemoteTrustRecord = Record<string, string>;

const trustKey = (projectId: string, remote: string) => `${projectId}\0${remote}`;

export function loadRemoteTrust(): RemoteTrustRecord {
	return readJson<RemoteTrustRecord>("remotes.json", {});
}

/** Whether a background check is allowed to touch this pair at all. */
export function isRemoteTrusted(projectId: string, remote: string): boolean {
	return typeof loadRemoteTrust()[trustKey(projectId, remote)] === "string";
}

/** Record that a user-initiated operation authenticated against this pair. Idempotent. */
export function noteRemoteTrusted(projectId: string, remote: string): void {
	const record = loadRemoteTrust();
	const key = trustKey(projectId, remote);
	if (record[key]) return;
	record[key] = new Date().toISOString();
	writeJson("remotes.json", record);
}
