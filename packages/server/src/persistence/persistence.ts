import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
	type WireModel,
	type Workspace,
} from "@thinkrail/contracts";
import {
	claimBrowserAttributionAttemptIn,
	readAcquisitionIn,
	replaceAcquisitionWithTerminalMarkerIn,
	saveAcquisitionIn,
} from "./attribution";
import { type AcquisitionRecord, isRecord } from "./attributionProtocol";
import { claimAppInstalledIn, ensureInstallationIn, type InstallationRecord } from "./installation";

export {
	type AcquisitionRecord,
	ATTRIBUTION_LIFETIME_MS,
	ATTRIBUTION_MAX_POLLS,
	ATTRIBUTION_ORIGIN,
	ATTRIBUTION_POLL_INTERVAL_MS,
	type AttributionTouch,
	claimIdPattern,
	hasExactKeys,
	isRecord,
	parseRedeemedAttribution,
	type RedeemedAttribution,
} from "./attributionProtocol";
export type { InstallationRecord } from "./installation";

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

export type SessionMetadataLoad<T> =
	| { kind: "loaded"; value: T }
	| { kind: "missing" }
	| { kind: "set-aside"; file: string; error: unknown; setAsidePath: string | null };

function loadSessionMetadata<T>(
	file: string,
	parse: (raw: unknown) => T | null,
): SessionMetadataLoad<T> {
	const path = join(dataDir(), file);
	let error: unknown;
	try {
		const value = parse(JSON.parse(readFileSync(path, "utf8")));
		if (value !== null) return { kind: "loaded", value };
		error = new Error(`Invalid ${file}`);
	} catch (caught) {
		if ((caught as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
		error = caught;
	}
	const setAsidePath = `${path}.corrupt-${Date.now()}`;
	try {
		renameSync(path, setAsidePath);
		return { kind: "set-aside", file, error, setAsidePath };
	} catch {
		return { kind: "set-aside", file, error, setAsidePath: null };
	}
}

export const SESSION_RECEIPTS_VERSION = 1;

export interface SessionReceipts {
	version: typeof SESSION_RECEIPTS_VERSION;
	baselineComplete: boolean;
	handledCompletionBySession: Record<string, string>;
}

function parseSessionReceipts(raw: unknown): SessionReceipts | null {
	if (!isRecord(raw)) return null;
	const handledCompletionBySession = stringRecord(raw.handledCompletionBySession);
	if (
		raw.version !== SESSION_RECEIPTS_VERSION ||
		typeof raw.baselineComplete !== "boolean" ||
		handledCompletionBySession === null
	) {
		return null;
	}
	return {
		version: SESSION_RECEIPTS_VERSION,
		baselineComplete: raw.baselineComplete,
		handledCompletionBySession,
	};
}

export function loadSessionReceipts(): SessionMetadataLoad<SessionReceipts> {
	return loadSessionMetadata("session-receipts.json", parseSessionReceipts);
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

function parseSessionLifecycle(raw: unknown): SessionLifecycle | null {
	if (!isRecord(raw)) return null;
	const cancelledRunBySession = stringRecord(raw.cancelledRunBySession);
	const rawCompletions = raw.completionBySession;
	if (
		raw.version !== SESSION_LIFECYCLE_VERSION ||
		!isRecord(rawCompletions) ||
		cancelledRunBySession === null
	) {
		return null;
	}
	const completionBySession: Record<string, PersistedSessionCompletion> = {};
	for (const [sessionId, value] of Object.entries(rawCompletions)) {
		const parsed = sessionCompletion(value);
		if (!parsed) return null;
		completionBySession[sessionId] = parsed;
	}
	return {
		version: SESSION_LIFECYCLE_VERSION,
		completionBySession,
		cancelledRunBySession,
	};
}

export function loadSessionLifecycle(): SessionMetadataLoad<SessionLifecycle> {
	return loadSessionMetadata("session-lifecycle.json", parseSessionLifecycle);
}

export function saveSessionLifecycle(lifecycle: SessionLifecycle): void {
	writeJsonAtomic("session-lifecycle.json", lifecycle);
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

/** A persisted model list keeps only entries that still identify a model; anything else is dropped, not repaired. */
function storedModels(value: unknown): WireModel[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is WireModel =>
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as WireModel).provider === "string" &&
			typeof (entry as WireModel).id === "string",
	);
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
		notificationsEnabled:
			typeof value.notificationsEnabled === "boolean"
				? value.notificationsEnabled
				: DEFAULT_CONFIG.notificationsEnabled,
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
		agentReviewEnabled:
			typeof value.agentReviewEnabled === "boolean"
				? value.agentReviewEnabled
				: DEFAULT_CONFIG.agentReviewEnabled,
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
		favoriteModels: storedModels(value.favoriteModels),
		recentModels: storedModels(value.recentModels),
		terminalWindowsShell: isTerminalWindowsShell(value.terminalWindowsShell)
			? value.terminalWindowsShell
			: DEFAULT_CONFIG.terminalWindowsShell,
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

export function ensureInstallation(): InstallationRecord {
	return ensureInstallationIn(dataDir());
}

export function claimAppInstalled(): boolean {
	return claimAppInstalledIn(dataDir());
}

export function readAcquisition(now = Date.now()): AcquisitionRecord | undefined {
	return readAcquisitionIn(dataDir(), now);
}

export function claimBrowserAttributionAttempt(): boolean {
	return claimBrowserAttributionAttemptIn(dataDir());
}

export function saveAcquisition(record: AcquisitionRecord): void {
	saveAcquisitionIn(dataDir(), record);
}

export function replaceAcquisitionWithTerminalMarker(): void {
	replaceAcquisitionWithTerminalMarkerIn(dataDir());
}
