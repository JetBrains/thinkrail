import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	type Workspace,
} from "@thinkrail/contracts";
import {
	claimBrowserAttributionAttemptIn,
	readAcquisitionIn,
	replaceAcquisitionWithTerminalMarkerIn,
	saveAcquisitionIn,
} from "./attribution";
import type { AcquisitionRecord } from "./attributionProtocol";
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
