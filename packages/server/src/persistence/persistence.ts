import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export const ATTENTION_LEDGER_VERSION = 1 as const;

export interface AttentionLedger {
	version: typeof ATTENTION_LEDGER_VERSION;
	migrationComplete: true;
	handledCandidateBySession: Record<string, string>;
	internalSessionIds: string[];
}

export type AttentionLedgerLoadResult =
	| { status: "missing" }
	| { status: "ready"; ledger: AttentionLedger }
	| { status: "invalid"; error: Error; quarantined?: string };

const ATTENTION_LEDGER_FILE = "attention.json";

function attentionLedgerPath(): string {
	return join(dataDir(), ATTENTION_LEDGER_FILE);
}

function errorValue(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function parseAttentionLedger(value: unknown): AttentionLedger | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (Reflect.get(value, "version") !== ATTENTION_LEDGER_VERSION) return null;
	if (Reflect.get(value, "migrationComplete") !== true) return null;
	const rawHandled = Reflect.get(value, "handledCandidateBySession");
	if (!rawHandled || typeof rawHandled !== "object" || Array.isArray(rawHandled)) return null;
	const entries = Object.entries(rawHandled);
	if (entries.some(([sessionId, candidateId]) => !sessionId || !candidateId)) return null;
	if (entries.some(([, candidateId]) => typeof candidateId !== "string")) return null;
	const rawInternal = Reflect.get(value, "internalSessionIds");
	if (rawInternal !== undefined && !Array.isArray(rawInternal)) return null;
	if (
		Array.isArray(rawInternal) &&
		rawInternal.some((sessionId) => typeof sessionId !== "string" || !sessionId)
	) {
		return null;
	}
	return {
		version: ATTENTION_LEDGER_VERSION,
		migrationComplete: true,
		handledCandidateBySession: Object.fromEntries(entries) as Record<string, string>,
		internalSessionIds: [...new Set((rawInternal ?? []) as string[])],
	};
}

export function loadAttentionLedger(): AttentionLedgerLoadResult {
	let source: string;
	try {
		source = readFileSync(attentionLedgerPath(), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			let quarantined: string | undefined;
			try {
				const name = readdirSync(dataDir())
					.filter((candidate) => candidate.startsWith(`${ATTENTION_LEDGER_FILE}.invalid-`))
					.sort()
					.at(-1);
				if (name) quarantined = join(dataDir(), name);
			} catch {}
			return quarantined
				? {
						status: "invalid",
						error: new Error("Attention ledger replacement was interrupted"),
						quarantined,
					}
				: { status: "missing" };
		}
		return { status: "invalid", error: errorValue(error) };
	}
	try {
		const ledger = parseAttentionLedger(JSON.parse(source));
		return ledger
			? { status: "ready", ledger }
			: { status: "invalid", error: new Error("Invalid attention ledger") };
	} catch (error) {
		return { status: "invalid", error: errorValue(error) };
	}
}

export function saveAttentionLedger(ledger: AttentionLedger): void {
	const normalized = parseAttentionLedger(ledger);
	if (!normalized) throw new Error("Invalid attention ledger");
	const directory = dataDir();
	const file = attentionLedgerPath();
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	mkdirSync(directory, { recursive: true });
	try {
		writeFileSync(temporary, `${JSON.stringify(normalized, null, "\t")}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, file);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

export function quarantineAttentionLedger(): string {
	const file = attentionLedgerPath();
	const quarantined = `${file}.invalid-${Date.now()}-${randomUUID()}`;
	renameSync(file, quarantined);
	return quarantined;
}

export function restoreQuarantinedAttentionLedger(quarantined: string): void {
	renameSync(quarantined, attentionLedgerPath());
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
