import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	isComposerGrowthLimit,
	isJbcentralQuotaRefreshSeconds,
	isLineWidth,
	isTerminalWindowsShell,
	normalizeThemePreference,
	type Project,
	type SessionCompletion,
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

function writeJsonAtomic(file: string, value: unknown): void {
	mkdirSync(dataDir(), { recursive: true });
	const target = join(dataDir(), file);
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`);
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function stringRecord(value: unknown): Record<string, string> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const entries = Object.entries(value);
	return entries.every(([, item]) => typeof item === "string") ? Object.fromEntries(entries) : null;
}

export const SESSION_RECEIPTS_VERSION = 1;

export interface SessionReceipts {
	version: typeof SESSION_RECEIPTS_VERSION;
	baselineComplete: boolean;
	handledCompletionBySession: Record<string, string>;
}

export function loadSessionReceipts(): SessionReceipts | null {
	const path = join(dataDir(), "session-receipts.json");
	if (!existsSync(path)) return null;
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const handledCompletionBySession = stringRecord(raw.handledCompletionBySession);
	if (
		raw.version !== SESSION_RECEIPTS_VERSION ||
		typeof raw.baselineComplete !== "boolean" ||
		handledCompletionBySession === null
	) {
		throw new Error("Invalid session receipts");
	}
	return {
		version: SESSION_RECEIPTS_VERSION,
		baselineComplete: raw.baselineComplete,
		handledCompletionBySession,
	};
}

export function saveSessionReceipts(receipts: SessionReceipts): void {
	writeJsonAtomic("session-receipts.json", receipts);
}

export const SESSION_LIFECYCLE_VERSION = 1;

export interface PersistedSessionCompletion {
	runId: string;
	completion: SessionCompletion;
}

export interface SessionLifecycle {
	version: typeof SESSION_LIFECYCLE_VERSION;
	completionBySession: Record<string, PersistedSessionCompletion>;
	cancelledRunBySession: Record<string, string>;
}

function sessionCompletion(value: unknown): PersistedSessionCompletion | null {
	if (!value || typeof value !== "object") return null;
	const runId = Reflect.get(value, "runId");
	const completion = Reflect.get(value, "completion");
	const completionId = completion && Reflect.get(completion, "completionId");
	const outcome = completion && Reflect.get(completion, "outcome");
	if (typeof runId !== "string" || typeof completionId !== "string") return null;
	if (outcome === "failed") {
		const failure = Reflect.get(completion, "failure");
		if (failure !== "error" && failure !== "length") return null;
		return { runId, completion: { completionId, outcome, failure } };
	}
	if (outcome !== "succeeded" && outcome !== "interrupted" && outcome !== "cancelled") return null;
	return { runId, completion: { completionId, outcome } };
}

export function loadSessionLifecycle(): SessionLifecycle {
	const path = join(dataDir(), "session-lifecycle.json");
	if (!existsSync(path)) {
		return {
			version: SESSION_LIFECYCLE_VERSION,
			completionBySession: {},
			cancelledRunBySession: {},
		};
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const cancelledRunBySession = stringRecord(raw.cancelledRunBySession);
	const rawCompletions = Reflect.get(raw, "completionBySession");
	if (
		raw.version !== SESSION_LIFECYCLE_VERSION ||
		!rawCompletions ||
		typeof rawCompletions !== "object" ||
		Array.isArray(rawCompletions) ||
		cancelledRunBySession === null
	) {
		throw new Error("Invalid session lifecycle metadata");
	}
	const completionBySession: Record<string, PersistedSessionCompletion> = {};
	for (const [sessionId, value] of Object.entries(rawCompletions)) {
		const parsed = sessionCompletion(value);
		if (!parsed) throw new Error("Invalid session lifecycle metadata");
		completionBySession[sessionId] = parsed;
	}
	return {
		version: SESSION_LIFECYCLE_VERSION,
		completionBySession,
		cancelledRunBySession,
	};
}

export function saveSessionLifecycle(lifecycle: SessionLifecycle): void {
	writeJsonAtomic("session-lifecycle.json", lifecycle);
}

export const SESSION_PURPOSE_VERSION = 1;

export interface SessionPurpose {
	version: typeof SESSION_PURPOSE_VERSION;
	internalSessionIds: string[];
}

export function loadSessionPurpose(): SessionPurpose {
	const path = join(dataDir(), "session-purpose.json");
	if (!existsSync(path)) return { version: SESSION_PURPOSE_VERSION, internalSessionIds: [] };
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	if (
		raw.version !== SESSION_PURPOSE_VERSION ||
		!Array.isArray(raw.internalSessionIds) ||
		!raw.internalSessionIds.every((id) => typeof id === "string")
	) {
		throw new Error("Invalid session purpose metadata");
	}
	return {
		version: SESSION_PURPOSE_VERSION,
		internalSessionIds: [...new Set(raw.internalSessionIds)],
	};
}

export function saveSessionPurpose(purpose: SessionPurpose): void {
	writeJsonAtomic("session-purpose.json", purpose);
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
	const extensions = { ...value };
	delete extensions.chatMessageOrder;
	delete extensions.layout;
	delete extensions.themeMode;
	delete extensions.systemThemePair;
	return {
		...extensions,
		...normalizeThemePreference(value),
		analyticsEnabled:
			typeof value.analyticsEnabled === "boolean"
				? value.analyticsEnabled
				: DEFAULT_CONFIG.analyticsEnabled,
		analyticsConsentConfirmed: value.analyticsConsentConfirmed === true,
		terminalReplayKb:
			typeof value.terminalReplayKb === "number" && Number.isFinite(value.terminalReplayKb)
				? value.terminalReplayKb
				: DEFAULT_CONFIG.terminalReplayKb,
		composerGrowthLimit: isComposerGrowthLimit(value.composerGrowthLimit)
			? value.composerGrowthLimit
			: DEFAULT_CONFIG.composerGrowthLimit,
		chatLineWidth: isLineWidth(value.chatLineWidth)
			? value.chatLineWidth
			: DEFAULT_CONFIG.chatLineWidth,
		fileLineWidth: isLineWidth(value.fileLineWidth)
			? value.fileLineWidth
			: DEFAULT_CONFIG.fileLineWidth,
		chatLineWidthBounded:
			typeof value.chatLineWidthBounded === "boolean"
				? value.chatLineWidthBounded
				: DEFAULT_CONFIG.chatLineWidthBounded,
		fileLineWidthBounded:
			typeof value.fileLineWidthBounded === "boolean"
				? value.fileLineWidthBounded
				: DEFAULT_CONFIG.fileLineWidthBounded,
		reviewAutoFix:
			typeof value.reviewAutoFix === "boolean" ? value.reviewAutoFix : DEFAULT_CONFIG.reviewAutoFix,
		subagentsEnabled:
			typeof value.subagentsEnabled === "boolean"
				? value.subagentsEnabled
				: DEFAULT_CONFIG.subagentsEnabled,
		jbcentralQuotaEnabled:
			typeof value.jbcentralQuotaEnabled === "boolean"
				? value.jbcentralQuotaEnabled
				: DEFAULT_CONFIG.jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds: isJbcentralQuotaRefreshSeconds(value.jbcentralQuotaRefreshSeconds)
			? value.jbcentralQuotaRefreshSeconds
			: DEFAULT_CONFIG.jbcentralQuotaRefreshSeconds,
		customLayoutPresets: Array.isArray(value.customLayoutPresets)
			? value.customLayoutPresets
			: DEFAULT_CONFIG.customLayoutPresets,
		terminalWindowsShell: isTerminalWindowsShell(value.terminalWindowsShell)
			? value.terminalWindowsShell
			: DEFAULT_CONFIG.terminalWindowsShell,
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

export interface InstallationRecord {
	id: string;
}

export function ensureInstallation(): InstallationRecord {
	const raw = readJson<Partial<InstallationRecord>>("installation.json", {});
	if (typeof raw?.id === "string" && raw.id.length > 0) return { id: raw.id };
	const record: InstallationRecord = { id: randomUUID() };
	writeJson("installation.json", record);
	return record;
}
