import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
	createAgentSession,
	type ExtensionCommandContext,
	type ExtensionError,
	type ExtensionUIContext,
	getAgentDir,
	type McpServerConfig,
	type RegisteredMcpServer,
	type SessionInfo,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentSettlement,
	AskUserQuestionResult,
	ImageContent,
	Model,
	PiEvent,
	QueuedMessageContent,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	ReviewFixDetails,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionQueueContent,
	SessionQueueState,
	SessionState,
	SessionStateRecord,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
	WireModelAuth,
} from "@thinkrail/contracts";
import {
	assistantToolCallsAreExecutable,
	isTranscriptMessageRole,
	normalizeSessionTitle,
	sameModel,
	TODO_REVIEW_FIX_CUSTOM_TYPE,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type BackgroundCommands,
	createBackgroundCommands,
	createBackgroundCommandsExtension,
} from "pi-background-commands";
import type { ParentContext } from "pi-delegation";
import { RECURSION_GUARD_TOOLS, type Subagents } from "pi-subagents";
import { logger } from "../log";
import {
	dataDir,
	loadSessionLifecycle,
	loadSessionReceipts,
	SESSION_LIFECYCLE_VERSION,
	type SessionLifecycle,
	type SessionMetadataLoad,
	type SessionReceipts,
	saveSessionLifecycle,
	saveSessionReceipts,
} from "../persistence";
import { trashFile } from "../trash";
import {
	ANSWERABILITY_ERRORS,
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionWaiters,
	assessAnswerability,
	buildAnswersMessage,
	createAskUserQuestionWaiters,
	hasQuestionAck,
} from "./askUserQuestion";
import { publishSessionResourcesChanged } from "./chatResources";
import {
	disposeSessionChildren,
	removeWorkspaceDelegation,
	stopSessionChildren,
	subagentsFor,
} from "./delegation";
import { buildResourceLoader, toSkillCommands } from "./extensions";
import { createMcpSessionHost, type McpProjectPolicy, type McpSessionHost } from "./mcp";
import {
	assertMcpServerDisablableInChat,
	forgetMcpStatus,
	reconcileMcpSessions,
	restartMcpStatus,
	scheduleMcpStatusRefresh,
	showPendingMcpReload,
	watchMcpStatus,
} from "./mcpSessions";
import {
	getPiRuntimeGeneration,
	type PiRuntimeGeneration,
	refreshCatalogs,
	settledAvailableModels,
} from "./piRuntime";
import { catalogProviderAuth } from "./providerAuth";
import { REQUEST_REVIEW_TOOL_NAME } from "./requestReviewTool";
import { projectSessionEvent } from "./sessionEventProjection";
import { repairDanglingToolCalls } from "./sessionRepair";
import { deriveSessionState } from "./sessionState";
import type { SkillAdmissionContext } from "./skillAdmission";
import {
	cancelExtUiForSession,
	createWebUiContext,
	notifyExtensionError,
	notifyExtUi,
	pendingExtUiDialog,
	setExtUiStateChanged,
} from "./webUiContext";

const log = logger("agent");

interface TrackedQueuedMessage {
	id: number;
	text: string;
	images?: ImageContent[];
}

interface Entry {
	subagents: Subagents;
	commands: BackgroundCommands;
	unsubscribeCommands: () => void;
	resourceCascade?: Promise<void>;
	shutdownEmitted?: Promise<void>;
	resourcesClosing: boolean;
	session: AgentSession;
	generation: PiRuntimeGeneration;
	unsubscribe: () => void;
	workspaceId: string;
	lastSettlement: AgentSettlement | null | undefined;
	queuedMessages: Record<QueueLane, TrackedQueuedMessage[]>;
	stuckEmptyDeliveries: Record<QueueLane, number>;
	nextQueuedMessageId: number;
	manualCompactionInProgress: boolean;
	piCompactionInProgress: boolean;
	reloadPending: boolean;
	reloadRunning: Promise<void> | null;
	preflightReleases: Set<() => void>;
	heldReservations: Set<() => void>;
	disposed: boolean;
	registered: boolean;
	subagentToolsRefreshPending: boolean;
	reviewToolRefreshPending: boolean;
	nudgePromptPending: boolean;
	lastPublishedState: string | null;
	askUserQuestionWaiters: AskUserQuestionWaiters;
	mcpHost: McpSessionHost;
}

const sessions = new Map<string, Entry>();
let sessionLifecycleGeneration = 0;
const workspaceLifecycleGenerations = new Map<string, number>();
const closingWorkspaces = new Map<string, number>();
const pendingSessionPreparations = new Map<string, Set<Promise<unknown>>>();
const sessionTeardowns = new Map<string, Promise<void>>();

interface WorkspaceLifecycleToken {
	global: number;
	workspace: number;
}

function captureWorkspaceLifecycle(workspaceId: string): WorkspaceLifecycleToken {
	return {
		global: sessionLifecycleGeneration,
		workspace: workspaceLifecycleGenerations.get(workspaceId) ?? 0,
	};
}

function workspaceAcceptsSessions(workspaceId: string, token: WorkspaceLifecycleToken): boolean {
	return (
		token.global === sessionLifecycleGeneration &&
		token.workspace === (workspaceLifecycleGenerations.get(workspaceId) ?? 0) &&
		!closingWorkspaces.has(workspaceId)
	);
}

function trackSessionPreparation<T>(
	workspaceId: string,
	token: WorkspaceLifecycleToken,
	operation: () => Promise<T>,
): Promise<T> {
	if (!workspaceAcceptsSessions(workspaceId, token))
		return Promise.reject(new Error(`Workspace is unavailable: ${workspaceId}`));
	const pending = operation();
	let preparations = pendingSessionPreparations.get(workspaceId);
	if (!preparations) {
		preparations = new Set();
		pendingSessionPreparations.set(workspaceId, preparations);
	}
	const scope = preparations;
	scope.add(pending);
	return pending.finally(() => {
		scope.delete(pending);
		if (scope.size === 0 && pendingSessionPreparations.get(workspaceId) === scope)
			pendingSessionPreparations.delete(workspaceId);
	});
}

let sessionMetadataRoot: string | null = null;
let sessionLifecycle: SessionLifecycle | null = null;
let sessionReceipts: SessionReceipts | null | undefined;

function loadedSessionMetadata<T>(load: SessionMetadataLoad<T>): T | null {
	if (load.kind === "loaded") return load.value;
	if (load.kind === "set-aside") {
		log.warn(
			`${load.file} was unreadable; ${load.setAsidePath ? `moved it to ${load.setAsidePath}` : "could not move it aside"} and rebuilding session state`,
			load.error,
		);
	}
	return null;
}

function ensureSessionMetadata(): void {
	const root = dataDir();
	if (sessionMetadataRoot === root && sessionLifecycle) return;
	const loadedLifecycle = loadedSessionMetadata(loadSessionLifecycle());
	const loadedReceipts = loadedSessionMetadata(loadSessionReceipts());
	sessionMetadataRoot = root;
	sessionLifecycle = loadedLifecycle ?? {
		version: SESSION_LIFECYCLE_VERSION,
		completionBySession: {},
		cancelledRunBySession: {},
	};
	sessionReceipts = loadedLifecycle ? loadedReceipts : null;
}

function lifecycle(): SessionLifecycle {
	ensureSessionMetadata();
	if (!sessionLifecycle) throw new Error("Session lifecycle metadata is unavailable");
	return sessionLifecycle;
}

function receipts(): SessionReceipts | null {
	ensureSessionMetadata();
	return sessionReceipts ?? null;
}

function omitMetadataKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	const { [key]: _removed, ...rest } = record;
	return rest;
}

function removeSessionStateMetadata(sessionId: string): void {
	const currentLifecycle = lifecycle();
	const nextLifecycle: SessionLifecycle = {
		...currentLifecycle,
		completionBySession: omitMetadataKey(currentLifecycle.completionBySession, sessionId),
		cancelledRunBySession: omitMetadataKey(currentLifecycle.cancelledRunBySession, sessionId),
	};
	saveSessionLifecycle(nextLifecycle);
	sessionLifecycle = nextLifecycle;
	const currentReceipts = receipts();
	if (currentReceipts) {
		const nextReceipts: SessionReceipts = {
			...currentReceipts,
			handledCompletionBySession: omitMetadataKey(
				currentReceipts.handledCompletionBySession,
				sessionId,
			),
		};
		saveSessionReceipts(nextReceipts);
		sessionReceipts = nextReceipts;
	}
}

export async function usePiRuntime<T>(
	operation: (
		runtime: PiRuntimeGeneration["runtime"],
		generation: PiRuntimeGeneration,
	) => Promise<T> | T,
): Promise<T> {
	const generation = await getPiRuntimeGeneration();
	return operation(generation.runtime, generation);
}

const deletedSessions = new Map<string, string>();

const deletingSessions = new Map<string, { workspaceId: string; done: Promise<void> }>();

function isSessionDeleted(sessionId: string, workspaceId: string): boolean {
	return deletedSessions.get(sessionId) === workspaceId;
}

function sessionIsTearingDown(sessionId: string): boolean {
	return sessionTeardowns.has(sessionId);
}

function sessionCanAttach(sessionId: string, workspaceId: string): boolean {
	return (
		!isSessionDeleted(sessionId, workspaceId) &&
		!sessionIsTearingDown(sessionId) &&
		!closingWorkspaces.has(workspaceId)
	);
}

export type { SessionEventPayload };

let publish: (payload: SessionEventPayload) => void = () => {};
export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publish = fn;
}

let publishCreated: (payload: SessionCreatedPayload) => void = () => {};
export function setSessionCreatedPublisher(fn: (payload: SessionCreatedPayload) => void): void {
	publishCreated = fn;
}

let publishDeleted: (payload: SessionDeletedPayload) => void = () => {};
export function setSessionDeletedPublisher(fn: (payload: SessionDeletedPayload) => void): void {
	publishDeleted = fn;
}

let publishState: (record: SessionStateRecord) => void = () => {};
export function setSessionStatePublisher(fn: (record: SessionStateRecord) => void): void {
	publishState = fn;
	setExtUiStateChanged((sessionId) => {
		const entry = sessions.get(sessionId);
		if (entry) publishEntryState(entry);
	});
}

let resolveProjectId: (workspaceId: string) => string | null = () => null;
export function setSessionProjectResolver(fn: (workspaceId: string) => string | null): void {
	resolveProjectId = fn;
}

function effectivePendingCount(entry: Entry): number {
	const stuck = entry.stuckEmptyDeliveries.steering + entry.stuckEmptyDeliveries.followUp;
	return Math.max(0, entry.session.pendingMessageCount - stuck);
}

function persistedCompletion(sessionId: string) {
	const stateReceipts = receipts();
	return stateReceipts?.baselineComplete
		? (lifecycle().completionBySession[sessionId] ?? null)
		: undefined;
}

function stateFromEntry(entry: Entry): SessionState {
	const sessionId = entry.session.sessionId;
	return deriveSessionState({
		entries: entry.session.sessionManager.getBranch(),
		isStreaming: entry.session.isStreaming,
		pendingMessageCount: effectivePendingCount(entry),
		lastSettlement: entry.lastSettlement,
		lifecycleCompletion:
			entry.lastSettlement === undefined ? persistedCompletion(sessionId) : undefined,
		liveQuestion: entry.askUserQuestionWaiters.currentQuestion(),
		pendingDialog: pendingExtUiDialog(sessionId),
		handledCompletionId: receipts()?.handledCompletionBySession[sessionId],
		cancelledRunId: lifecycle().cancelledRunBySession[sessionId],
	});
}

function publishEntryState(entry: Entry): void {
	if (sessions.get(entry.session.sessionId) !== entry) return;
	const projectId = resolveProjectId(entry.workspaceId);
	if (!projectId) return;
	const state = stateFromEntry(entry);
	const serialized = JSON.stringify(state);
	if (entry.lastPublishedState === serialized) return;
	entry.lastPublishedState = serialized;
	publishState({
		sessionId: entry.session.sessionId,
		workspaceId: entry.workspaceId,
		projectId,
		state,
	});
}

function stateFromDisk(sessionId: string, manager: SessionManager, legacy = false): SessionState {
	return deriveSessionState({
		entries: manager.getBranch(),
		isStreaming: false,
		pendingMessageCount: 0,
		lastSettlement: undefined,
		lifecycleCompletion: legacy ? undefined : persistedCompletion(sessionId),
		liveQuestion: null,
		pendingDialog: null,
		handledCompletionId: receipts()?.handledCompletionBySession[sessionId],
		cancelledRunId: lifecycle().cancelledRunBySession[sessionId],
	});
}

export function getSessionState(sessionId: string): SessionState {
	return stateFromEntry(mustGetEntry(sessionId));
}

function stateRecordForEntry(entry: Entry): SessionStateRecord {
	const projectId = resolveProjectId(entry.workspaceId);
	if (!projectId) throw new Error(`Unknown workspace: ${entry.workspaceId}`);
	return {
		sessionId: entry.session.sessionId,
		workspaceId: entry.workspaceId,
		projectId,
		state: stateFromEntry(entry),
	};
}

export function acknowledgeCompletion(
	sessionId: string,
	completionId: string,
): { acknowledged: boolean; record: SessionStateRecord } {
	const entry = mustGetEntry(sessionId);
	const currentReceipts = receipts();
	if (!currentReceipts?.baselineComplete) throw new Error("Session state is not initialized");
	const currentState = stateFromEntry(entry);
	if (currentState.completion?.completionId !== completionId || !currentState.completionUnread) {
		return { acknowledged: false, record: stateRecordForEntry(entry) };
	}
	const nextReceipts: SessionReceipts = {
		...currentReceipts,
		handledCompletionBySession: {
			...currentReceipts.handledCompletionBySession,
			[sessionId]: completionId,
		},
	};
	saveSessionReceipts(nextReceipts);
	sessionReceipts = nextReceipts;
	publishEntryState(entry);
	return { acknowledged: true, record: stateRecordForEntry(entry) };
}

export function nudgeSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): {
	disposition: "needs_input" | "queued" | "prompted";
	send: () => Promise<void>;
} {
	const entry = mustGetEntry(sessionId);
	const state = stateFromEntry(entry);
	if (state.needsInput) return { disposition: "needs_input", send: () => Promise.resolve() };
	if (state.execution === "running" || entry.nudgePromptPending) {
		return {
			disposition: "queued",
			send: async () => {
				await queueSessionMessage(entry, "followUp", text, images, () =>
					entry.session.followUp(text, images),
				);
			},
		};
	}
	entry.nudgePromptPending = true;
	return {
		disposition: "prompted",
		send: async () => {
			try {
				await promptSession(sessionId, text, images);
			} finally {
				entry.nudgePromptPending = false;
			}
		},
	};
}

function recordSettlement(entry: Entry, terminal: AgentSettlement | null): void {
	const sessionId = entry.session.sessionId;
	const observed = deriveSessionState({
		entries: entry.session.sessionManager.getBranch(),
		isStreaming: false,
		pendingMessageCount: effectivePendingCount(entry),
		lastSettlement: terminal,
		lifecycleCompletion: undefined,
		liveQuestion: entry.askUserQuestionWaiters.currentQuestion(),
		pendingDialog: pendingExtUiDialog(sessionId),
		handledCompletionId: receipts()?.handledCompletionBySession[sessionId],
		cancelledRunId: lifecycle().cancelledRunBySession[sessionId],
	});
	if (!observed.runId || !observed.completion) return;
	const current = lifecycle();
	const next: SessionLifecycle = {
		...current,
		completionBySession: {
			...current.completionBySession,
			[sessionId]: { runId: observed.runId, completion: observed.completion },
		},
	};
	saveSessionLifecycle(next);
	sessionLifecycle = next;
}

function markCancelledRun(entry: Entry): void {
	const state = stateFromEntry(entry);
	if (!state.runId) return;
	const current = lifecycle();
	if (current.cancelledRunBySession[entry.session.sessionId] === state.runId) return;
	const next: SessionLifecycle = {
		...current,
		cancelledRunBySession: {
			...current.cancelledRunBySession,
			[entry.session.sessionId]: state.runId,
		},
	};
	sessionLifecycle = next;
	try {
		saveSessionLifecycle(next);
	} catch (error) {
		log.warn(
			`session cancellation state was not persisted for ${entry.session.sessionId}`,
			error as Error,
		);
	}
}

let sessionManagerFactory: (cwd: string) => SessionManager = (cwd) => SessionManager.create(cwd);
export function setSessionManagerFactory(factory: (cwd: string) => SessionManager): void {
	sessionManagerFactory = factory;
}

let skillAdmissionResolver: (workspaceId: string) => SkillAdmissionContext = () => ({
	trusted: false,
	piResourceTrusted: false,
	acknowledged: [],
	disabled: [],
	disabledGroups: [],
	overrides: {},
});
export function setSkillAdmissionResolver(
	resolver: (workspaceId: string) => SkillAdmissionContext,
): void {
	skillAdmissionResolver = resolver;
}

let mcpPolicyResolver: (workspaceId: string) => McpProjectPolicy = () => ({
	approvals: {},
	overrides: {},
});
export function setMcpPolicyResolver(resolver: (workspaceId: string) => McpProjectPolicy): void {
	mcpPolicyResolver = resolver;
}

export function piResourceTrustFor(workspaceId: string): boolean {
	return skillAdmissionResolver(workspaceId).piResourceTrusted;
}

let subagentsEnabledResolver: (workspaceId: string) => boolean = () => true;
export function setSubagentsEnabledResolver(resolver: (workspaceId: string) => boolean): void {
	subagentsEnabledResolver = resolver;
}

function subagentsEnabled(workspaceId: string): boolean {
	try {
		return subagentsEnabledResolver(workspaceId);
	} catch {
		return false;
	}
}

function isSubagentTool(name: string): boolean {
	return RECURSION_GUARD_TOOLS.some((toolName) => toolName === name);
}

function applySubagentTools(entry: Entry): void {
	const withoutSubagents = entry.session
		.getActiveToolNames()
		.filter((name) => !isSubagentTool(name));
	entry.session.setActiveToolsByName(
		subagentsEnabled(entry.workspaceId)
			? [...withoutSubagents, ...RECURSION_GUARD_TOOLS]
			: withoutSubagents,
	);
	entry.subagentToolsRefreshPending = false;
}

export function refreshSubagentTools(workspaceId?: string): void {
	for (const entry of sessions.values()) {
		if (workspaceId !== undefined && entry.workspaceId !== workspaceId) continue;
		if (entry.session.isStreaming) entry.subagentToolsRefreshPending = true;
		else applySubagentTools(entry);
	}
}

// Injected by the host (never an agent → settings edge, see agent/SPEC.md); default on. Gates the
// worker's in-session request_review tool live: `setActiveToolsByName` rebuilds the system prompt from
// only the active tools' guidelines, so toggling the tool off also drops its guidance. The Review button
// path (startPlanReview) is separate and unaffected.
let agentReviewEnabledResolver: (workspaceId: string) => boolean = () => true;
export function setAgentReviewEnabledResolver(resolver: (workspaceId: string) => boolean): void {
	agentReviewEnabledResolver = resolver;
}

function agentReviewEnabled(workspaceId: string): boolean {
	try {
		return agentReviewEnabledResolver(workspaceId);
	} catch {
		return false;
	}
}

function applyReviewTool(entry: Entry): void {
	const withoutReview = entry.session
		.getActiveToolNames()
		.filter((name) => name !== REQUEST_REVIEW_TOOL_NAME);
	entry.session.setActiveToolsByName(
		agentReviewEnabled(entry.workspaceId)
			? [...withoutReview, REQUEST_REVIEW_TOOL_NAME]
			: withoutReview,
	);
	entry.reviewToolRefreshPending = false;
}

export function refreshAgentReviewTool(workspaceId?: string): void {
	for (const entry of sessions.values()) {
		if (workspaceId !== undefined && entry.workspaceId !== workspaceId) continue;
		if (entry.session.isStreaming) entry.reviewToolRefreshPending = true;
		else applyReviewTool(entry);
	}
}

function hasDeletionTombstone(sessionId: string): boolean {
	return deletedSessions.has(sessionId);
}

function mustGetEntry(sessionId: string): Entry {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry;
}

function mustGet(sessionId: string): AgentSession {
	return mustGetEntry(sessionId).session;
}

export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId) && !hasDeletionTombstone(sessionId);
}

export function getSessionWorkspaceId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.workspaceId;
}

export function getSessionRuntimeGeneration(sessionId: string): PiRuntimeGeneration | undefined {
	return hasSession(sessionId) ? sessions.get(sessionId)?.generation : undefined;
}

function transcriptMessages(session: AgentSession): TranscriptMessage[] {
	return session.messages.filter((message) =>
		isTranscriptMessageRole(message.role),
	) as TranscriptMessage[];
}

export async function reloadSessionResources(sessionId: string): Promise<void> {
	const entry = mustGetEntry(sessionId);
	if (entry.reloadRunning) {
		await entry.reloadRunning;
		return;
	}
	const blocked = reloadBlockedReason(entry);
	if (blocked) throw new Error(`Can't reload while ${blocked} — try again after the turn.`);
	await runGatedReload(entry);
}

export type SessionReloadDisposition = "reloaded" | "deferred";

export async function requestSessionReload(sessionId: string): Promise<SessionReloadDisposition> {
	const entry = mustGetEntry(sessionId);
	if (entry.reloadRunning) {
		entry.reloadPending = true;
		await entry.reloadRunning;
		return "reloaded";
	}
	if (reloadBlockedReason(entry)) {
		entry.reloadPending = true;
		return "deferred";
	}
	await runGatedReload(entry);
	return "reloaded";
}

function reloadBlockedReason(entry: Entry): string | null {
	if (entry.disposed || entry.resourcesClosing) return "the chat is closing";
	if (entry.session.isStreaming || !entry.session.isIdle) return "the chat is busy";
	if (entry.preflightReleases.size > 0 || entry.heldReservations.size > 0) {
		return "a message is being admitted";
	}
	if (entry.manualCompactionInProgress || entry.piCompactionInProgress) {
		return "compaction is in progress";
	}
	return null;
}

function reconsiderPendingReload(entry: Entry): void {
	if (!entry.reloadPending || entry.reloadRunning || reloadBlockedReason(entry)) return;
	const { sessionId } = entry.session;
	void runGatedReload(entry).catch((error) => {
		log.warn(`deferred resource reload failed for ${sessionId}`, error as Error);
		if (sessions.get(sessionId) !== entry || entry.disposed) return;
		notifyExtUi(
			sessionId,
			`This chat could not reload its resources after a settings change and still runs with the previous ones — close or reload it. ${(error as Error).message ?? String(error)}`,
			"error",
		);
	});
}

function runGatedReload(entry: Entry): Promise<void> {
	if (entry.reloadRunning) return entry.reloadRunning;
	entry.reloadPending = false;
	entry.reloadRunning = (async () => {
		try {
			await entry.session.reload();
		} finally {
			// Open the gate before flushing: completion delivery is refused while it is held.
			entry.reloadRunning = null;
			entry.commands.flushCompletions();
			entry.subagents.flushCompletions();
			publishEntryState(entry);
			reconsiderPendingReload(entry);
			restartMcpStatus(entry.session.sessionId);
		}
	})();
	return entry.reloadRunning;
}

function admitRun(entry: Entry): void {
	if (entry.reloadRunning) {
		throw new Error("The chat is reloading its resources — try again in a moment.");
	}
}

function admitPreflight(entry: Entry, held = false): () => void {
	admitRun(entry);
	const reservations = held ? entry.heldReservations : entry.preflightReleases;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		reservations.delete(release);
		reconsiderPendingReload(entry);
	};
	reservations.add(release);
	return release;
}

function releasePreflights(entry: Entry): void {
	for (const release of [...entry.preflightReleases]) release();
}

const SESSION_SETTINGS_OVERRIDES = { images: { autoResize: false } };

export function buildSessionSettings(cwd: string, projectTrusted: boolean): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted });
	const reload = settings.reload.bind(settings);
	settings.reload = async () => {
		await reload();
		settings.applyOverrides(SESSION_SETTINGS_OVERRIDES);
	};
	const setProjectTrusted = settings.setProjectTrusted.bind(settings);
	settings.setProjectTrusted = (trusted) => {
		setProjectTrusted(trusted);
		settings.applyOverrides(SESSION_SETTINGS_OVERRIDES);
	};
	settings.applyOverrides(SESSION_SETTINGS_OVERRIDES);
	return settings;
}

export type TrustReloadDisposition = SessionReloadDisposition | "failed";

export async function applyPiResourceTrust(
	workspaceIds: readonly string[],
): Promise<Record<string, TrustReloadDisposition>> {
	const scope = new Set(workspaceIds);
	const stale = [...sessions].filter(
		([, entry]) =>
			scope.has(entry.workspaceId) &&
			!entry.disposed &&
			!entry.resourcesClosing &&
			entry.session.settingsManager.isProjectTrusted() !== piResourceTrustFor(entry.workspaceId),
	);
	const dispositions: Record<string, TrustReloadDisposition> = {};
	for (const [sessionId, entry] of stale) {
		if (!piResourceTrustFor(entry.workspaceId))
			await stopSessionChildren(entry.workspaceId, sessionId, "user").settled;
		try {
			dispositions[sessionId] = await requestSessionReload(sessionId);
		} catch (error) {
			log.warn(`trust reload failed for ${sessionId}`, error as Error);
			dispositions[sessionId] = "failed";
		}
	}
	return dispositions;
}

export interface CreateSessionInput {
	cwd: string;
	workspaceId: string;
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
	/** True: an unresolvable `model` falls back to the default instead of throwing. */
	modelOptional?: boolean;
}

export interface CreateSessionResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

export function toWireModel(model: Model<string>, auth?: WireModelAuth): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
		cost: { input: model.cost.input, output: model.cost.output },
		input: [...model.input],
		...(auth ? { auth } : {}),
	};
}

function sessionWireModel(
	model: Model<string>,
	generation: Pick<PiRuntimeGeneration, "runtime" | "opaqueProviderIds">,
): WireModel {
	return toWireModel(model, catalogProviderAuth(generation, model.provider));
}

function resolveWireModel(
	runtime: PiRuntimeGeneration["runtime"],
	ref: Pick<WireModel, "provider" | "id">,
): Model<string> {
	const available = settledAvailableModels(runtime);
	const match = available.find((model) => sameModel(model, ref));
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

const RENAMED_PI_PROVIDERS: Readonly<Record<string, string>> = {
	"azure-openai-responses": "azure",
};

function resolvePersistedModel(
	runtime: PiRuntimeGeneration["runtime"],
	ref: Pick<WireModel, "provider" | "id">,
): Model<string> {
	try {
		return resolveWireModel(runtime, ref);
	} catch (error) {
		const renamed = RENAMED_PI_PROVIDERS[ref.provider];
		if (!renamed) throw error;
		return resolveWireModel(runtime, { provider: renamed, id: ref.id });
	}
}

interface PreparedSessionEntry {
	entry: Entry;
	result: CreateSessionResult;
}

async function prepareSessionEntry(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	commands: BackgroundCommands,
	subagents: Subagents,
	askUserQuestionWaiters: AskUserQuestionWaiters,
	mcpHost: McpSessionHost,
	lastSettlement: AgentSettlement | null | undefined = undefined,
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: AgentSettlement | null = null;
	const entry: Entry = {
		commands,
		subagents,
		resourcesClosing: false,
		unsubscribeCommands: () => {},
		session,
		generation,
		unsubscribe: () => {},
		workspaceId,
		lastSettlement,
		queuedMessages: { steering: [], followUp: [] },
		stuckEmptyDeliveries: { steering: 0, followUp: 0 },
		nextQueuedMessageId: 1,
		manualCompactionInProgress: false,
		piCompactionInProgress: false,
		reloadPending: false,
		reloadRunning: null,
		preflightReleases: new Set(),
		heldReservations: new Set(),
		disposed: false,
		registered: false,
		subagentToolsRefreshPending: false,
		reviewToolRefreshPending: false,
		nudgePromptPending: false,
		lastPublishedState: null,
		askUserQuestionWaiters,
		mcpHost,
	};
	entry.unsubscribeCommands = commands.onChange(() => {
		if (canUseSessionResources(sessionId, workspaceId))
			publishSessionResourcesChanged(workspaceId, sessionId);
	});
	entry.unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_end" &&
			event.message.role === "assistant" &&
			assistantToolCallsAreExecutable(event.message.stopReason)
		) {
			for (const block of event.message.content) {
				if (block.type === "toolCall" && block.name === ASK_USER_QUESTION_TOOL_NAME)
					entry.askUserQuestionWaiters.expect(block.id);
			}
		}
		if (event.type === "turn_end") {
			entry.askUserQuestionWaiters.persistTurn(event.toolResults);
			entry.commands.flushCompletions();
			entry.subagents.flushCompletions();
		}
		if (event.type === "message_start" && event.message.role === "user") {
			const lane = deliveredStuckEmptyLane(entry, event.message.content);
			if (lane) {
				entry.stuckEmptyDeliveries[lane]++;
				synchronizeQueueFromSession(entry);
				if (sessions.get(sessionId) === entry) {
					publish({ sessionId, event: queueUpdateEventOf(entry) });
					publishEntryState(entry);
				}
			}
		}
		if (event.type === "queue_update") {
			synchronizeQueuedLane(entry, "steering", displayedLane(entry, "steering", event.steering));
			synchronizeQueuedLane(entry, "followUp", displayedLane(entry, "followUp", event.followUp));
		}
		if (event.type === "compaction_start") entry.piCompactionInProgress = true;
		if (event.type === "compaction_end") {
			entry.piCompactionInProgress = false;
			reconsiderPendingReload(entry);
		}
		if (event.type === "agent_start") {
			entry.lastSettlement = null;
			releasePreflights(entry);
		}
		if (event.type === "agent_end") {
			const assistant = [...event.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			terminal = assistant
				? {
						stopReason: assistant.stopReason,
						...(assistant.errorMessage !== undefined
							? { errorMessage: assistant.errorMessage }
							: {}),
					}
				: null;
		}
		const baseEvent = projectSessionEvent(event, terminal);
		const projected =
			baseEvent.type === "queue_update"
				? {
						type: "queue_update" as const,
						steering: displayedLane(entry, "steering", baseEvent.steering),
						followUp: displayedLane(entry, "followUp", baseEvent.followUp),
						...(hasQueuedImages(entry) ? { hasImages: true as const } : {}),
					}
				: baseEvent;
		if (event.type === "agent_settled") {
			entry.lastSettlement = terminal;
			try {
				recordSettlement(entry, terminal);
			} catch (error) {
				log.warn(`session state settlement was not persisted for ${sessionId}`, error as Error);
			}
			if (entry.subagentToolsRefreshPending) applySubagentTools(entry);
			if (entry.reviewToolRefreshPending) applyReviewTool(entry);
			reconsiderPendingReload(entry);
			scheduleMcpStatusRefresh(sessionId);
			void reconcileMcpSessions([sessionId]);
		}
		if (sessions.get(sessionId) === entry) {
			publish({ sessionId, event: projected });
			publishEntryState(entry);
		}
		if (event.type === "agent_settled") terminal = null;
	});

	const reportExtensionError = (failure: ExtensionError): void => {
		const line = `extension ${failure.extensionPath} failed on ${failure.event}: ${failure.error}`;
		if (entry.disposed) {
			log.debug(line);
			return;
		}
		if (failure.stack) {
			const cause = new Error(failure.error);
			cause.stack = failure.stack;
			log.warn(line, cause);
		} else {
			log.warn(line);
		}
		if (!entry.registered || sessions.get(sessionId) === entry)
			notifyExtensionError(sessionId, failure);
	};

	try {
		watchMcpStatus(sessionId);
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: reportExtensionError,
		});
		if (!sessionCanAttach(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	} catch (error) {
		abandonPreparedEntry(entry);
		throw error;
	}

	return {
		entry,
		result: {
			sessionId,
			model: session.model
				? sessionWireModel(session.model as unknown as Model<string>, generation)
				: null,
			thinkingLevel: session.thinkingLevel,
		},
	};
}

function abandonPreparedEntry(entry: Entry): void {
	const { sessionId } = entry.session;
	cancelExtUiForSession(sessionId);
	forgetMcpStatus(sessionId);
	entry.askUserQuestionWaiters.abandon();
	entry.unsubscribe();
	entry.unsubscribeCommands();
	entry.disposed = true;
	void closeSessionResources(entry);
	clearEntryQueue(entry);
	disposePiSessionAfterShutdown(entry);
}

async function registerSession(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	commands: BackgroundCommands,
	subagents: Subagents,
	askUserQuestionWaiters: AskUserQuestionWaiters,
	mcpHost: McpSessionHost,
	lifecycleToken: WorkspaceLifecycleToken,
	announceCreation = false,
): Promise<CreateSessionResult> {
	const prepared = await prepareSessionEntry(
		session,
		workspaceId,
		generation,
		commands,
		subagents,
		askUserQuestionWaiters,
		mcpHost,
	);
	if (
		!workspaceAcceptsSessions(workspaceId, lifecycleToken) ||
		sessionIsTearingDown(session.sessionId)
	) {
		abandonPreparedEntry(prepared.entry);
		throw new Error(`Workspace is unavailable: ${workspaceId}`);
	}
	prepared.entry.registered = true;
	sessions.set(session.sessionId, prepared.entry);
	applySubagentTools(prepared.entry);
	applyReviewTool(prepared.entry);
	restartMcpStatus(session.sessionId);
	commands.flushCompletions();
	subagents.flushCompletions();
	log.debug(`session ${session.sessionId} attached (workspace ${workspaceId})`);
	if (announceCreation) {
		publishCreated(summaryOf(session.sessionId, prepared.entry));
	}
	publishEntryState(prepared.entry);
	return prepared.result;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const lifecycleToken = captureWorkspaceLifecycle(input.workspaceId);
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(
		input.cwd,
		skillAdmissionResolver(input.workspaceId).piResourceTrusted,
	);
	let model: Model<string> | undefined;
	if (input.model) {
		try {
			model = resolveWireModel(generation.runtime, input.model);
		} catch (err) {
			if (!input.modelOptional) throw err;
		}
	}
	return createParentSession(
		{
			cwd: input.cwd,
			sessionManager: sessionManagerFactory(input.cwd),
			settingsManager,
			...(model ? { model } : {}),
			...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
		},
		input.workspaceId,
		generation,
		lifecycleToken,
		true,
	);
}

type ParentSessionOptions = CreateAgentSessionOptions & {
	cwd: string;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
};

function createParentSession(
	options: ParentSessionOptions,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	lifecycleToken: WorkspaceLifecycleToken,
	announceCreation = false,
): Promise<CreateSessionResult> {
	const sessionId = options.sessionManager.getSessionId();
	if (sessionIsTearingDown(sessionId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	return trackSessionPreparation(workspaceId, lifecycleToken, () =>
		createParentSessionInternal(options, workspaceId, generation, lifecycleToken, announceCreation),
	);
}

async function createParentSessionInternal(
	options: ParentSessionOptions,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	lifecycleToken: WorkspaceLifecycleToken,
	announceCreation = false,
): Promise<CreateSessionResult> {
	const { sessionManager, settingsManager, cwd } = options;
	const sessionId = sessionManager.getSessionId();
	const askUserQuestionWaiters = createAskUserQuestionWaiters();
	const mcpHost = createMcpSessionHost(() => mcpPolicyResolver(workspaceId));
	const canDeliverCompletion = () =>
		canUseSessionResources(sessionId, workspaceId) &&
		!askUserQuestionWaiters.hasRecoverableCall() &&
		!sessions.get(sessionId)?.reloadRunning;
	let session: AgentSession | undefined;
	const subagents = subagentsFor(
		workspaceId,
		() => subagentsEnabled(workspaceId),
		() => sessions.get(sessionId)?.subagents === subagents && canDeliverCompletion(),
	);
	const commands = createBackgroundCommands({
		sessionId,
		getContext: () => {
			if (!session || hasDeletionTombstone(sessionId))
				throw new Error("Session resources unavailable");
			return {
				cwd: session.sessionManager.getCwd(),
				sessionFile: session.sessionManager.getSessionFile(),
				model: session.model,
				thinkingLevel: session.thinkingLevel,
				shellPath: settingsManager.getShellPath(),
				commandPrefix: settingsManager.getShellCommandPrefix(),
			};
		},
		canDeliverCompletion: () =>
			sessions.get(sessionId)?.commands === commands && canDeliverCompletion(),
	});
	try {
		const result = await createAgentSession({
			...options,
			modelRuntime: generation.runtime,
			resourceLoader: await buildResourceLoader(
				cwd,
				settingsManager,
				() => skillAdmissionResolver(workspaceId),
				generation.excludedSessionExtensionPaths,
				[
					subagents.extension,
					createBackgroundCommandsExtension({ service: commands }),
					...mcpHost.extensions,
				],
				askUserQuestionWaiters,
			),
		});
		session = result.session;
		return await registerSession(
			session,
			workspaceId,
			generation,
			commands,
			subagents,
			askUserQuestionWaiters,
			mcpHost,
			lifecycleToken,
			announceCreation,
		);
	} catch (error) {
		if (sessions.get(sessionId)?.commands === commands) {
			try {
				await disposeSession(sessionId);
			} catch {}
		} else if (!session) {
			subagents.dispose();
			void trackCascade(
				workspaceId,
				commands.dispose().catch(() => {}),
			);
			askUserQuestionWaiters.abandon();
		}
		throw error;
	}
}

export function canUseSessionResources(sessionId: string, workspaceId: string): boolean {
	const entry = sessions.get(sessionId);
	return (
		!!entry &&
		entry.registered &&
		!entry.resourcesClosing &&
		entry.workspaceId === workspaceId &&
		sessionCanAttach(sessionId, workspaceId) &&
		!hasDeletionTombstone(sessionId)
	);
}

export async function withSessionResources<T>(
	workspaceId: string,
	sessionId: string,
	cwd: string,
	operation: (commands: BackgroundCommands) => T | Promise<T>,
): Promise<T> {
	if (!sessions.has(sessionId) && !hasDeletionTombstone(sessionId)) {
		try {
			await ensureSessionAttached(sessionId, workspaceId, cwd);
		} catch {
			throw new CodedError("RESOURCE_UNAVAILABLE", "Session resources unavailable");
		}
	}
	const entry = sessions.get(sessionId);
	if (
		!entry ||
		!canUseSessionResources(sessionId, workspaceId) ||
		entry.session.sessionManager.getCwd() !== cwd
	)
		throw new CodedError("RESOURCE_UNAVAILABLE", "Session resources unavailable");
	return operation(entry.commands);
}

function summaryOf(sessionId: string, entry: Entry): SessionSummary {
	const { session } = entry;
	return {
		sessionId,
		workspaceId: entry.workspaceId,
		title: session.sessionName ?? "Chat",
		model: session.model
			? sessionWireModel(session.model as unknown as Model<string>, entry.generation)
			: null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		messageCount: session.messages.length,
		updatedAt: Date.now(),
		live: true,
		state: stateFromEntry(entry),
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
		...(effectivePendingCount(entry) > 0 ? { queue: queueStateOf(entry) } : {}),
	};
}

interface SessionFileIdentity {
	id: string;
	cwd: string;
}

type ScannedSessionFile =
	| { path: string; ok: true; identity: SessionFileIdentity }
	| { path: string; ok: false; error: Error };

function defaultSessionDirectory(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(getAgentDir()), "sessions", safePath);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

async function readSessionFileIdentity(path: string): Promise<SessionFileIdentity> {
	const input = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof entry !== "object" || entry === null) {
				throw new Error("first parsed entry is not an object");
			}
			const id = Reflect.get(entry, "id");
			if (Reflect.get(entry, "type") !== "session" || typeof id !== "string") {
				throw new Error("first parsed entry is not a session header");
			}
			const headerCwd = Reflect.get(entry, "cwd");
			return { id, cwd: typeof headerCwd === "string" ? headerCwd : "" };
		}
		throw new Error("session header is missing");
	} catch (error) {
		throw new Error(`Session transcript is unreadable or malformed: ${path}`, { cause: error });
	} finally {
		lines.close();
		input.destroy();
	}
}

async function scanSessionFiles(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<ScannedSessionFile[]> {
	const dir = defaultSessionDirectory(cwd);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw new Error(`Session directory is unreadable: ${dir}`, { cause: error });
	}
	const scanned: ScannedSessionFile[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(dir, name);
		if (excludedPaths.has(resolve(path))) continue;
		try {
			scanned.push({ path, ok: true, identity: await readSessionFileIdentity(path) });
		} catch (error) {
			scanned.push({
				path,
				ok: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}
	return scanned;
}

async function listSessionInfosStrict(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<SessionInfo[]> {
	const scanned = await scanSessionFiles(cwd, excludedPaths);
	const broken = scanned.find((file) => !file.ok);
	if (broken && !broken.ok) throw broken.error;
	const infos = await SessionManager.list(cwd);
	const listedByPath = new Map(infos.map((info) => [resolve(info.path), info]));
	const omitted = scanned.find((file) => {
		if (!file.ok) return false;
		const listed = listedByPath.get(resolve(file.path));
		return !listed || listed.id !== file.identity.id || listed.cwd !== file.identity.cwd;
	});
	if (omitted) throw new Error(`Session transcript could not be listed: ${omitted.path}`);
	return infos;
}

async function listSessionsInternal(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	const live: SessionSummary[] = [];
	const liveIds = new Set<string>();
	const liveFiles = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (entry.workspaceId !== workspaceId || isSessionDeleted(sessionId, workspaceId)) continue;
		const sessionFile = entry.session.sessionManager.getSessionFile();
		if (sessionFile) liveFiles.add(resolve(sessionFile));
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
	}
	const infos = await listSessionInfosStrict(cwd, liveFiles);
	const disk: SessionSummary[] = infos
		.filter(
			(info) =>
				info.cwd === cwd && !liveIds.has(info.id) && !isSessionDeleted(info.id, workspaceId),
		)
		.map((info) => ({
			sessionId: info.id,
			workspaceId,
			title: info.name ?? "Chat",
			model: null,
			thinkingLevel: "medium" as ThinkingLevel,
			isStreaming: false,
			messageCount: info.messageCount,
			updatedAt: info.modified.getTime(),
			live: false,
			state: stateFromDisk(info.id, SessionManager.open(info.path)),
		}));
	return [...live, ...disk];
}

export function listSessions(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	return listSessionsInternal(workspaceId, cwd);
}

export interface SessionStateWorkspace {
	id: string;
	projectId: string;
	cwd: string;
}

async function listBaselineSessionInfos(cwd: string): Promise<SessionInfo[]> {
	try {
		return await listSessionInfosStrict(cwd);
	} catch (error) {
		log.warn(`session baseline is skipping unreadable transcripts for ${cwd}`, error);
		return SessionManager.list(cwd);
	}
}

async function collectSessionStates(
	workspaces: readonly SessionStateWorkspace[],
	baseline: boolean,
): Promise<SessionStateRecord[]> {
	const records: SessionStateRecord[] = [];
	const liveIds = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (isSessionDeleted(sessionId, entry.workspaceId)) continue;
		const workspace = workspaces.find((candidate) => candidate.id === entry.workspaceId);
		if (!workspace) continue;
		records.push({
			sessionId,
			workspaceId: entry.workspaceId,
			projectId: workspace.projectId,
			state: stateFromEntry(entry),
		});
		liveIds.add(sessionId);
	}
	for (const workspace of workspaces) {
		const infos = baseline
			? await listBaselineSessionInfos(workspace.cwd)
			: await listSessionInfosStrict(workspace.cwd);
		for (const info of infos) {
			if (
				info.cwd !== workspace.cwd ||
				liveIds.has(info.id) ||
				sessions.has(info.id) ||
				isSessionDeleted(info.id, workspace.id)
			) {
				continue;
			}
			records.push({
				sessionId: info.id,
				workspaceId: workspace.id,
				projectId: workspace.projectId,
				state: stateFromDisk(info.id, SessionManager.open(info.path), baseline),
			});
		}
	}
	return records;
}

export async function initializeSessionStates(
	workspaces: readonly SessionStateWorkspace[],
): Promise<void> {
	ensureSessionMetadata();
	const currentReceipts = receipts();
	if (currentReceipts?.baselineComplete) return;
	const records = await collectSessionStates(workspaces, true);
	const currentLifecycle = lifecycle();
	const completionBySession = { ...currentLifecycle.completionBySession };
	const handledCompletionBySession = {
		...(currentReceipts?.handledCompletionBySession ?? {}),
	};
	for (const record of records) {
		const { completion, runId } = record.state;
		if (!completion || !runId) continue;
		completionBySession[record.sessionId] = { runId, completion };
		if (completion.outcome !== "cancelled") {
			handledCompletionBySession[record.sessionId] = completion.completionId;
		}
	}
	const nextLifecycle: SessionLifecycle = { ...currentLifecycle, completionBySession };
	const nextReceipts: SessionReceipts = {
		version: 1,
		baselineComplete: true,
		handledCompletionBySession,
	};
	saveSessionLifecycle(nextLifecycle);
	saveSessionReceipts(nextReceipts);
	sessionLifecycle = nextLifecycle;
	sessionReceipts = nextReceipts;
}

export async function listSessionStates(
	workspaces: readonly SessionStateWorkspace[],
): Promise<SessionStateRecord[]> {
	if (!receipts()?.baselineComplete) throw new Error("Session state is not initialized");
	return collectSessionStates(workspaces, false);
}

const sessionFileOperations = new Map<string, Promise<void>>();

function serializeSessionFileOperation<T>(
	sessionId: string,
	operation: () => Promise<T> | T,
): Promise<T> {
	const previous = sessionFileOperations.get(sessionId) ?? Promise.resolve();
	const result = previous.catch(() => {}).then(operation);
	const settled = result.then(
		() => undefined,
		() => undefined,
	);
	sessionFileOperations.set(sessionId, settled);
	return result.finally(() => {
		if (sessionFileOperations.get(sessionId) === settled) sessionFileOperations.delete(sessionId);
	});
}

export interface RenameSessionOptions {
	onlyIfUnnamed?: boolean;
}

export function renameSession(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	title: string,
	options: RenameSessionOptions = {},
): Promise<boolean> {
	const normalized = normalizeSessionTitle(title);
	if (!normalized) return Promise.reject(new Error("Invalid session title"));
	return serializeSessionFileOperation(sessionId, async () => {
		if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
		const live = sessions.get(sessionId);
		if (live) {
			if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
			const current = live.session.sessionName;
			if ((options.onlyIfUnnamed && current !== undefined) || current === normalized) return false;
			live.session.setSessionName(normalized);
			return true;
		}

		const info = (await listSessionInfosStrict(cwd)).find(
			(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
		);
		if (!info || hasDeletionTombstone(sessionId)) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		const manager = SessionManager.open(info.path);
		const current = manager.getSessionName();
		if ((options.onlyIfUnnamed && current !== undefined) || current === normalized) return false;
		manager.appendSessionInfo(normalized);
		publish({ sessionId, event: { type: "session_info_changed", name: normalized } });
		return true;
	});
}

const attaching = new Map<string, Promise<void>>();

function attachDiskSession(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	lifecycleToken: WorkspaceLifecycleToken,
): Promise<void> {
	if (
		!workspaceAcceptsSessions(workspaceId, lifecycleToken) ||
		!sessionCanAttach(sessionId, workspaceId)
	)
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		pending = serializeSessionFileOperation(sessionId, () =>
			openDiskSession(sessionId, workspaceId, cwd, lifecycleToken),
		).finally(() => attaching.delete(sessionId));
		attaching.set(sessionId, pending);
	}
	return pending;
}

function persistedSessionModelRef(model: unknown): { provider: string; id: string } | undefined {
	if (typeof model !== "object" || model === null) return undefined;
	const provider = Reflect.get(model, "provider");
	const id = Reflect.get(model, "modelId");
	if (provider === undefined && id === undefined) return undefined;
	if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
		throw new Error("The chat's saved model is unavailable.");
	}
	return { provider, id };
}

async function openDiskSession(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	lifecycleToken: WorkspaceLifecycleToken,
): Promise<void> {
	if (
		!workspaceAcceptsSessions(workspaceId, lifecycleToken) ||
		!sessionCanAttach(sessionId, workspaceId)
	)
		throw new Error(`Unknown session: ${sessionId}`);
	const info = (await listSessionInfosStrict(cwd)).find(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return;
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(
		cwd,
		skillAdmissionResolver(workspaceId).piResourceTrusted,
	);
	const sessionManager = SessionManager.open(info.path);
	const persistedModel = persistedSessionModelRef(sessionManager.buildSessionContext().model);
	let exactModel: Model<string> | undefined;
	if (persistedModel) {
		try {
			exactModel = resolvePersistedModel(generation.runtime, persistedModel);
		} catch {
			throw new Error("The chat's saved model is unavailable.");
		}
	}
	repairDanglingToolCalls(sessionManager);
	await createParentSession(
		{
			cwd,
			sessionManager,
			settingsManager,
			...(exactModel ? { model: exactModel } : {}),
		},
		workspaceId,
		generation,
		lifecycleToken,
	);
}

async function ensureSessionAttachedInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	const lifecycleToken = captureWorkspaceLifecycle(workspaceId);
	if (
		!workspaceAcceptsSessions(workspaceId, lifecycleToken) ||
		!sessionCanAttach(sessionId, workspaceId)
	)
		return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!known || !workspaceAcceptsSessions(workspaceId, lifecycleToken)) return false;
	await attachDiskSession(sessionId, workspaceId, cwd, lifecycleToken);
	if (!sessions.has(sessionId))
		throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	return true;
}

export function ensureSessionAttached(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	return ensureSessionAttachedInternal(sessionId, workspaceId, cwd);
}

async function getSessionMessagesInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	const lifecycleToken = captureWorkspaceLifecycle(workspaceId);
	if (
		!workspaceAcceptsSessions(workspaceId, lifecycleToken) ||
		!sessionCanAttach(sessionId, workspaceId)
	)
		throw new Error(`Unknown session: ${sessionId}`);
	let entry = sessions.get(sessionId);
	if (entry && entry.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, workspaceId, cwd, lifecycleToken);
		if (!sessionCanAttach(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	return { summary: summaryOf(sessionId, entry), messages: transcriptMessages(entry.session) };
}

export function getSessionMessages(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	return getSessionMessagesInternal(sessionId, workspaceId, cwd);
}

export async function answerQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	const live = entry.askUserQuestionWaiters.answer(toolCallId, result);
	if (live.handled) {
		publishEntryState(entry);
		await live.persisted;
		return;
	}
	const verdict = assessAnswerability(entry.session.messages, toolCallId);
	if (!verdict.ok) throw new Error(`${ANSWERABILITY_ERRORS[verdict.reason]}: ${toolCallId}`);
	if (!hasQuestionAck(entry.session.messages, toolCallId)) {
		throw new Error(`${ANSWERABILITY_ERRORS.not_awaiting}: ${toolCallId}`);
	}
	const release = admitPreflight(entry);
	try {
		await entry.session.sendCustomMessage(buildAnswersMessage(toolCallId, verdict.args, result), {
			triggerTurn: true,
		});
	} finally {
		release();
	}
}

function synchronizeQueuedLane(entry: Entry, kind: QueueLane, texts: readonly string[]): void {
	const current = entry.queuedMessages[kind];
	if (texts.length >= current.length) {
		entry.queuedMessages[kind] = texts.map((text, index) => {
			const tracked = current[index];
			return tracked ? { ...tracked, text } : { id: entry.nextQueuedMessageId++, text };
		});
		return;
	}

	const reconciled: TrackedQueuedMessage[] = [];
	let currentIndex = current.length - 1;
	for (let textIndex = texts.length - 1; textIndex >= 0; textIndex--) {
		const text = texts[textIndex];
		if (text === undefined) continue;
		while (currentIndex >= 0 && current[currentIndex]?.text !== text) currentIndex--;
		const tracked = currentIndex >= 0 ? current[currentIndex] : undefined;
		reconciled.unshift(tracked ? { ...tracked, text } : { id: entry.nextQueuedMessageId++, text });
		currentIndex--;
	}
	entry.queuedMessages[kind] = reconciled;
}

function synchronizeQueueFromSession(entry: Entry): void {
	synchronizeQueuedLane(entry, "steering", displayedLane(entry, "steering"));
	synchronizeQueuedLane(entry, "followUp", displayedLane(entry, "followUp"));
}

function laneMessages(entry: Entry, kind: QueueLane): readonly string[] {
	return kind === "steering"
		? entry.session.getSteeringMessages()
		: entry.session.getFollowUpMessages();
}

function displayedLane(entry: Entry, kind: QueueLane, texts?: readonly string[]): string[] {
	let toDrop = entry.stuckEmptyDeliveries[kind];
	const result: string[] = [];
	for (const text of texts ?? laneMessages(entry, kind)) {
		if (text === "" && toDrop > 0) {
			toDrop--;
			continue;
		}
		result.push(text);
	}
	return result;
}

function queueUpdateEventOf(entry: Entry): PiEvent {
	return {
		type: "queue_update",
		steering: displayedLane(entry, "steering"),
		followUp: displayedLane(entry, "followUp"),
		...(hasQueuedImages(entry) ? { hasImages: true as const } : {}),
	};
}

function deliveredStuckEmptyLane(entry: Entry, content: unknown): QueueLane | null {
	if (userContentText(content).trim() !== "") return null;
	if (!userContentHasImage(content)) return null;
	for (const kind of ["steering", "followUp"] as const) {
		const pendingEmpties = laneMessages(entry, kind).filter((text) => text === "").length;
		if (pendingEmpties > entry.stuckEmptyDeliveries[kind]) return kind;
	}
	return null;
}

function userContentBlocks(content: unknown): { type: string; text?: string }[] {
	return Array.isArray(content) ? (content as { type: string; text?: string }[]) : [];
}

function userContentText(content: unknown): string {
	if (typeof content === "string") return content;
	return userContentBlocks(content)
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function userContentHasImage(content: unknown): boolean {
	return userContentBlocks(content).some((block) => block.type === "image");
}

function hasQueuedImages(entry: Entry): boolean {
	return (["steering", "followUp"] as const).some((kind) =>
		entry.queuedMessages[kind].some((message) => (message.images?.length ?? 0) > 0),
	);
}

function queueContentOf(entry: Entry): SessionQueueContent {
	synchronizeQueueFromSession(entry);
	const project = (message: TrackedQueuedMessage): QueuedMessageContent => ({
		text: message.text,
		...(message.images && message.images.length > 0 ? { images: [...message.images] } : {}),
	});
	return {
		steering: entry.queuedMessages.steering.map(project),
		followUp: entry.queuedMessages.followUp.map(project),
	};
}

function mergeQueueContent(
	before: SessionQueueContent,
	after: SessionQueueContent,
): SessionQueueContent {
	return {
		steering: [...before.steering, ...after.steering],
		followUp: [...before.followUp, ...after.followUp],
	};
}

async function queueSessionMessage<T>(
	entry: Entry,
	kind: QueueLane,
	text: string,
	images: ImageContent[] | undefined,
	send: () => Promise<T>,
): Promise<T> {
	const tracked: TrackedQueuedMessage = {
		id: entry.nextQueuedMessageId++,
		text,
		...(images && images.length > 0 ? { images: [...images] } : {}),
	};
	entry.queuedMessages[kind].push(tracked);
	try {
		return await send();
	} catch (error) {
		entry.queuedMessages[kind] = entry.queuedMessages[kind].filter(
			(message) => message.id !== tracked.id,
		);
		synchronizeQueueFromSession(entry);
		throw error;
	}
}

async function steerEntry(
	entry: Entry,
	text: string,
	images: ImageContent[] | undefined,
): Promise<void> {
	const disposition = await queueSessionMessage(entry, "steering", text, images, () =>
		entry.session.steer(text, images),
	);
	if (disposition !== "queued") return;
	entry.mcpHost.cancelPendingConfirmations();
	if (entry.askUserQuestionWaiters.supersede()) publishEntryState(entry);
}

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	admitRun(entry);
	if (entry.session.isStreaming) {
		await steerEntry(entry, text, images);
		return;
	}
	const release = admitPreflight(entry);
	try {
		await entry.session.prompt(text, images ? { images } : undefined);
	} finally {
		release();
	}
}

export async function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	admitRun(entry);
	await steerEntry(entry, text, images);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	admitRun(entry);
	if (entry.session.isStreaming) {
		await queueSessionMessage(entry, "followUp", text, images, () =>
			entry.session.followUp(text, images),
		);
		return;
	}
	const release = admitPreflight(entry);
	try {
		await entry.session.prompt(text, images ? { images } : undefined);
	} finally {
		release();
	}
}

// Callers MUST `ackSend`-wrap this: a pre-turn rejection has to roll the review record back — see submodule-server-todos.
export async function sendReviewFixToSession(
	sessionId: string,
	content: string,
	details: ReviewFixDetails,
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	const release = admitPreflight(entry);
	try {
		await entry.session.sendCustomMessage(
			{ customType: TODO_REVIEW_FIX_CUSTOM_TYPE, content, display: true, details },
			{ deliverAs: "followUp", triggerTurn: true },
		);
	} finally {
		release();
	}
}

export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	const entry = mustGetEntry(sessionId);
	admitRun(entry);
	if (entry.manualCompactionInProgress || entry.piCompactionInProgress) {
		throw new Error("Compaction is already in progress for this session");
	}
	entry.manualCompactionInProgress = true;
	try {
		await entry.session.compact(instructions);
	} finally {
		entry.manualCompactionInProgress = false;
		reconsiderPendingReload(entry);
	}
}

function queueStateOf(entry: Entry): SessionQueueState {
	synchronizeQueueFromSession(entry);
	return {
		steering: displayedLane(entry, "steering"),
		followUp: displayedLane(entry, "followUp"),
		...(hasQueuedImages(entry) ? { hasImages: true as const } : {}),
	};
}

export function clearQueueSession(sessionId: string, requireTextOnly = false): SessionQueueContent {
	return clearEntryQueue(mustGetEntry(sessionId), requireTextOnly);
}

function clearEntryQueue(entry: Entry, requireTextOnly = false): SessionQueueContent {
	const content = queueContentOf(entry);
	if (requireTextOnly && hasQueuedImages(entry)) {
		throw new Error("Cannot restore queued image messages as text");
	}
	entry.session.clearQueue();
	entry.stuckEmptyDeliveries = { steering: 0, followUp: 0 };
	return content;
}

export async function removeQueuedSession(
	sessionId: string,
	kind: QueueLane,
	index: number,
): Promise<RemovedQueuedMessage> {
	const entry = mustGetEntry(sessionId);
	const release = admitPreflight(entry, true);
	try {
		const { session } = entry;
		const drained = clearQueueSession(sessionId);
		const lane = [...drained[kind]];
		const removed = index >= 0 && index < lane.length ? (lane.splice(index, 1)[0] ?? null) : null;
		const keep = { ...drained, [kind]: lane };
		for (const message of keep.steering) {
			const images = message.images ? [...message.images] : undefined;
			await queueSessionMessage(entry, "steering", message.text, images, () =>
				session.steer(message.text, images),
			);
		}
		for (const message of keep.followUp) {
			await followUpSession(
				sessionId,
				message.text,
				message.images ? [...message.images] : undefined,
			);
		}
		if (!session.isStreaming && session.pendingMessageCount > 0) {
			const parked = clearQueueSession(sessionId);
			for (const message of [...parked.steering, ...parked.followUp]) {
				await followUpSession(
					sessionId,
					message.text,
					message.images ? [...message.images] : undefined,
				);
			}
		}
		return { removed, queue: queueStateOf(entry) };
	} finally {
		release();
	}
}

const ACCEPTED_ANSWER_STOP_GRACE_MS = 1_000;

async function waitForAcceptedAnswerGrace(
	acceptedResult: Promise<void> | null,
	timeoutMs: number,
): Promise<void> {
	if (!acceptedResult) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, Math.max(0, timeoutMs));
		timer.unref?.();
	});
	await Promise.race([acceptedResult.catch(() => {}), timeout]);
	if (timer) clearTimeout(timer);
}

export async function abortSession(
	sessionId: string,
	restoreQueue = false,
	acceptedAnswerGraceMs = ACCEPTED_ANSWER_STOP_GRACE_MS,
): Promise<SessionQueueContent | undefined> {
	const entry = mustGetEntry(sessionId);
	if (entry.session.isStreaming) markCancelledRun(entry);
	return abortEntry(entry, restoreQueue, acceptedAnswerGraceMs);
}

async function abortEntry(
	entry: Entry,
	restoreQueue: boolean,
	acceptedAnswerGraceMs = ACCEPTED_ANSWER_STOP_GRACE_MS,
): Promise<SessionQueueContent | undefined> {
	let restoredQueue = restoreQueue ? clearEntryQueue(entry) : undefined;
	const acceptedResult = entry.askUserQuestionWaiters.prepareAbort();
	await waitForAcceptedAnswerGrace(acceptedResult, acceptedAnswerGraceMs);
	if (sessions.get(entry.session.sessionId) !== entry) return restoredQueue;
	if (restoredQueue) {
		restoredQueue = mergeQueueContent(restoredQueue, clearEntryQueue(entry));
	}
	await entry.session.abort();
	return restoredQueue;
}

export async function setSessionModel(sessionId: string, model: WireModel): Promise<WireModel> {
	const entry = mustGetEntry(sessionId);
	const resolved = resolveWireModel(entry.generation.runtime, model);
	await entry.session.setModel(resolved);
	return sessionWireModel(resolved, entry.generation);
}

export function setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
	mustGet(sessionId).setThinkingLevel(level);
}

export function getSessionStats(sessionId: string): SessionStats {
	const session = mustGet(sessionId);
	const stats = session.getSessionStats();
	const contextUsage = stats.contextUsage ?? session.getContextUsage();
	return {
		sessionId: stats.sessionId,
		totalMessages: stats.totalMessages,
		tokens: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			total: stats.tokens.total,
		},
		cost: stats.cost,
		...(contextUsage ? { contextUsage } : {}),
	};
}

export interface McpSessionView {
	workspaceId: string;
	cwd: string;
	projectTrusted: boolean;
	policy: McpProjectPolicy;
	disabledInChat: ReadonlySet<string>;
	loaded: ReadonlyMap<string, McpServerConfig> | null;
	registered: readonly RegisteredMcpServer[];
	commandOwner: string | null;
}

export function mcpSessionView(sessionId: string): McpSessionView | undefined {
	const entry = sessions.get(sessionId);
	if (!entry?.registered || entry.disposed || hasDeletionTombstone(sessionId)) return undefined;
	return {
		workspaceId: entry.workspaceId,
		cwd: entry.session.sessionManager.getCwd(),
		projectTrusted: entry.session.settingsManager.isProjectTrusted(),
		policy: mcpPolicyResolver(entry.workspaceId),
		disabledInChat: entry.mcpHost.disabledInChat,
		loaded: entry.mcpHost.loaded(),
		registered: entry.mcpHost.registered(),
		commandOwner: entry.session.extensionRunner.getCommand("mcp")?.sourceInfo.path ?? null,
	};
}

export function liveSessionIdsOf(workspaceId?: string): string[] {
	return [...sessions]
		.filter(
			([sessionId, entry]) =>
				(workspaceId === undefined || entry.workspaceId === workspaceId) &&
				mcpSessionView(sessionId),
		)
		.map(([sessionId]) => sessionId);
}

type McpCommandNotify = (message: string, level: "info" | "warning" | "error") => void;

function notifyingCommandContext(
	context: ExtensionCommandContext,
	notify: McpCommandNotify,
): ExtensionCommandContext {
	const ui = Object.getOwnPropertyDescriptor(context, "ui");
	const capture: ExtensionUIContext["notify"] = (message, type) => notify(message, type ?? "info");
	return Object.defineProperty(context, "ui", {
		get: (): ExtensionUIContext =>
			new Proxy<ExtensionUIContext>(ui?.get ? ui.get.call(context) : ui?.value, {
				get: (target, key) => (key === "notify" ? capture : Reflect.get(target, key)),
			}),
	});
}

export function dispatchSessionMcpCommand(
	sessionId: string,
	args: string,
	notify?: McpCommandNotify,
): Promise<void> | null {
	const entry = sessions.get(sessionId);
	const command = entry?.session.extensionRunner.getCommand("mcp");
	if (!entry || !command) return null;
	const context = entry.session.extensionRunner.createCommandContext();
	return Promise.resolve(
		command.handler(args, notify ? notifyingCommandContext(context, notify) : context),
	);
}

export async function setSessionMcpServerEnabled(
	sessionId: string,
	name: string,
	enabled: boolean,
): Promise<SessionReloadDisposition | "unchanged"> {
	const entry = mustGetEntry(sessionId);
	const disabled = entry.mcpHost.disabledInChat;
	if (disabled.has(name) === !enabled) return "unchanged";
	if (enabled) disabled.delete(name);
	else {
		assertMcpServerDisablableInChat(sessionId, name);
		disabled.add(name);
	}
	const disposition = await requestSessionReload(sessionId);
	if (disposition === "deferred") showPendingMcpReload(sessionId);
	return disposition;
}

export function getSessionCommands(sessionId: string): SlashCommandInfo[] {
	const session = mustGet(sessionId);
	const extension = session.extensionRunner.getRegisteredCommands().map((command) => ({
		name: command.invocationName,
		source: "extension" as const,
		sourceInfo: command.sourceInfo,
		...(command.description !== undefined ? { description: command.description } : {}),
	}));
	const prompt = session.promptTemplates.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		sourceInfo: template.sourceInfo,
	}));
	const skill = toSkillCommands(session.resourceLoader.getSkills().skills);
	return [...extension, ...prompt, ...skill];
}

export async function listAvailableModels(): Promise<WireModel[]> {
	const generation = await getPiRuntimeGeneration();
	void refreshCatalogs(generation.runtime);
	return readAvailableWireModels(generation);
}

export async function listSettledModels(): Promise<WireModel[]> {
	return readAvailableWireModels(await getPiRuntimeGeneration());
}

export async function refreshAvailableModels(force = false): Promise<RefreshedModels> {
	const generation = await getPiRuntimeGeneration();
	const { completed } = await refreshCatalogs(generation.runtime, { force });
	return { models: readAvailableWireModels(generation), complete: completed };
}

function readAvailableWireModels(generation: PiRuntimeGeneration): WireModel[] {
	const authByProvider = new Map<string, WireModelAuth>();
	return settledAvailableModels(generation.runtime).map((m) => {
		const model = m as unknown as Model<string>;
		let auth = authByProvider.get(model.provider);
		if (!auth) {
			auth = catalogProviderAuth(generation, model.provider);
			authByProvider.set(model.provider, auth);
		}
		return toWireModel(model, auth);
	});
}

export async function clampThinkingForModel(
	ref: Pick<WireModel, "provider" | "id">,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	const generation = await getPiRuntimeGeneration();
	return clampThinkingLevel(resolveWireModel(generation.runtime, ref), level);
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

export function liveParentContext(sessionId: string): ParentContext | undefined {
	const entry = sessions.get(sessionId);
	if (!entry || !canUseSessionResources(sessionId, entry.workspaceId)) return undefined;
	const { session } = entry;
	return {
		cwd: session.sessionManager.getCwd(),
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		modelRuntime: session.modelRuntime,
	};
}

const pendingCascades = new Map<string, Set<Promise<void>>>();

function trackCascade(workspaceId: string, cascade: Promise<void>): Promise<void> {
	let pending = pendingCascades.get(workspaceId);
	if (!pending) {
		pending = new Set();
		pendingCascades.set(workspaceId, pending);
	}
	const scope = pending;
	const tracked: Promise<void> = cascade.then(() => {
		scope.delete(tracked);
		if (scope.size === 0 && pendingCascades.get(workspaceId) === scope) {
			pendingCascades.delete(workspaceId);
		}
	});
	scope.add(tracked);
	return tracked;
}

const SESSION_SHUTDOWN_BUDGET_MS = 3000;

function settleShutdownStep(entry: Entry, step: () => Promise<unknown>): Promise<void> {
	let running: Promise<unknown>;
	try {
		running = step();
	} catch (error) {
		running = Promise.reject(error);
	}
	return running.then(
		() => {},
		(error) => {
			log.debug(`session ${entry.session.sessionId} shutdown handlers failed`, error as Error);
		},
	);
}

function emitSessionShutdown(entry: Entry, timeoutMs = SESSION_SHUTDOWN_BUDGET_MS): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const runner = entry.session.extensionRunner;
	const event = { type: "session_shutdown", reason: "quit" } as const;
	// Started synchronously: the synchronous teardown path disposes the pi session right after, and
	// handlers must have started (pi's MCP shutdown begins closing connections before its first await).
	const steps = [
		settleShutdownStep(entry, () => entry.mcpHost.shutdownEngine(event, runner.createContext())),
		settleShutdownStep(entry, () => runner.emit(event)),
	];
	return Promise.race([
		Promise.all(steps).then(() => {}),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

function closeSessionResources(entry: Entry, timeoutMs?: number): Promise<void> {
	if (entry.resourceCascade) return entry.resourceCascade;
	entry.resourcesClosing = true;
	entry.subagents.dispose();
	const closing = entry.commands.dispose(timeoutMs === undefined ? undefined : { timeoutMs });
	const children = disposeSessionChildren(entry.workspaceId, entry.session.sessionId);
	entry.shutdownEmitted = emitSessionShutdown(entry, timeoutMs);
	entry.resourceCascade = trackCascade(
		entry.workspaceId,
		Promise.allSettled([closing, children, entry.shutdownEmitted]).then(() => {}),
	);
	return entry.resourceCascade;
}

// `dispose()` invalidates the extension context the session_shutdown handlers are still using.
function disposePiSessionAfterShutdown(entry: Entry): void {
	void (entry.shutdownEmitted ?? Promise.resolve()).then(() => entry.session.dispose());
}

function trackSessionTeardown(sessionId: string, cascade: Promise<void>): Promise<void> {
	const current = sessionTeardowns.get(sessionId);
	if (current) return current;
	let done: Promise<void>;
	done = cascade.finally(() => {
		if (sessionTeardowns.get(sessionId) === done) sessionTeardowns.delete(sessionId);
	});
	sessionTeardowns.set(sessionId, done);
	return done;
}

function disposeSession(sessionId: string): Promise<void> {
	const pending = sessionTeardowns.get(sessionId);
	if (pending) return pending;
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	entry.disposed = true;
	const cascade = trackSessionTeardown(sessionId, closeSessionResources(entry));
	cancelExtUiForSession(sessionId);
	forgetMcpStatus(sessionId);
	entry.askUserQuestionWaiters.abandon();
	entry.unsubscribe();
	entry.unsubscribeCommands();
	clearEntryQueue(entry);
	sessions.delete(sessionId);
	disposePiSessionAfterShutdown(entry);
	publishSessionResourcesChanged(entry.workspaceId, sessionId);
	log.debug(`session ${sessionId} disposed`);
	return cascade;
}

export function removeSession(sessionId: string): Promise<void> {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const pending = sessionTeardowns.get(sessionId);
	if (pending) return pending;
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	closeSessionResources(entry);
	if (entry.session.isStreaming)
		return abortEntry(entry, true)
			.catch(() => {})
			.then(() => disposeSession(sessionId));
	return disposeSession(sessionId);
}

export function disposeAllSessions(): void {
	sessionLifecycleGeneration++;
	workspaceLifecycleGenerations.clear();
	closingWorkspaces.clear();
	for (const [sessionId, entry] of sessions) {
		void trackSessionTeardown(sessionId, closeSessionResources(entry));
	}
	for (const [sessionId, entry] of sessions) {
		cancelExtUiForSession(sessionId);
		forgetMcpStatus(sessionId);
		entry.askUserQuestionWaiters.abandon();
		entry.unsubscribe();
		entry.unsubscribeCommands();
		entry.disposed = true;
		clearEntryQueue(entry);
		disposePiSessionAfterShutdown(entry);
	}
	sessions.clear();
	deletedSessions.clear();
}

export async function settleSessionsForShutdown(
	timeoutMs = SESSION_SHUTDOWN_BUDGET_MS,
): Promise<void> {
	const settling = new Set<Promise<unknown>>();
	for (const entry of sessions.values()) settling.add(closeSessionResources(entry, timeoutMs));
	for (const [sessionId, entry] of sessions) {
		clearEntryQueue(entry);
		const acceptedResult = entry.askUserQuestionWaiters.prepareShutdown();
		if (acceptedResult) {
			settling.add(
				acceptedResult
					.catch(() => {})
					.then(async () => {
						if (sessions.get(sessionId) === entry && entry.session.isStreaming) {
							clearEntryQueue(entry);
							await entry.session.abort();
						}
					}),
			);
		}
		if (entry.session.isStreaming && !entry.askUserQuestionWaiters.hasRecoverableCall()) {
			settling.add(entry.session.abort());
		}
	}
	for (const pending of pendingCascades.values()) {
		for (const cascade of pending) settling.add(cascade);
	}
	if (settling.size === 0) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.allSettled(settling),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function removeWorkspaceSessionsInternal(workspaceId: string, cwd?: string): Promise<void> {
	workspaceLifecycleGenerations.set(
		workspaceId,
		(workspaceLifecycleGenerations.get(workspaceId) ?? 0) + 1,
	);
	closingWorkspaces.set(workspaceId, (closingWorkspaces.get(workspaceId) ?? 0) + 1);
	try {
		const entries = [...sessions].filter(([, entry]) => entry.workspaceId === workspaceId);
		for (const [, entry] of entries) void closeSessionResources(entry);
		const removals = entries.map(async ([sessionId, entry]) => {
			if (entry.session.isStreaming) await abortEntry(entry, true).catch(() => {});
			await disposeSession(sessionId);
		});
		await Promise.all([
			Promise.allSettled([...(pendingSessionPreparations.get(workspaceId) ?? [])]),
			Promise.all(removals),
		]);
		await Promise.all([...(pendingCascades.get(workspaceId) ?? [])]);
		removeWorkspaceDelegation(workspaceId);
		if (cwd) await purgeDiskSessions(cwd);
	} finally {
		const remainingClosures = (closingWorkspaces.get(workspaceId) ?? 1) - 1;
		if (remainingClosures === 0) closingWorkspaces.delete(workspaceId);
		else closingWorkspaces.set(workspaceId, remainingClosures);
	}
}

export function removeWorkspaceSessions(workspaceId: string, cwd?: string): Promise<void> {
	return removeWorkspaceSessionsInternal(workspaceId, cwd);
}

async function purgeDiskSessions(cwd: string): Promise<void> {
	let infos: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		infos = await SessionManager.list(cwd);
	} catch {
		return;
	}
	for (const info of infos) {
		if (info.cwd !== cwd) continue;
		rmSync(info.path, { force: true });
		try {
			removeSessionStateMetadata(info.id);
		} catch (error) {
			log.warn(`session state metadata was not pruned for ${info.id}`, error as Error);
		}
	}
}

export function deleteSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	const inFlight = deletingSessions.get(sessionId);
	if (inFlight) {
		if (inFlight.workspaceId !== workspaceId)
			return Promise.reject(new Error(`Unknown session: ${sessionId}`));
		return inFlight.done;
	}

	const transaction = runDeleteTransaction(sessionId, workspaceId, cwd);
	const done = transaction.then(
		() => {
			deletingSessions.delete(sessionId);
		},
		(error: unknown) => {
			deletingSessions.delete(sessionId);
			throw error;
		},
	);
	deletingSessions.set(sessionId, { workspaceId, done });
	return done;
}

async function runDeleteTransaction(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<void> {
	const installedTombstone = !deletedSessions.has(sessionId);
	deletedSessions.set(sessionId, workspaceId);
	let liveEntry: Entry | undefined;
	try {
		await attaching.get(sessionId)?.catch(() => {});
		const entry = sessions.get(sessionId);
		if (entry && entry.workspaceId !== workspaceId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		let path: string | undefined;
		if (entry) {
			liveEntry = entry;
			if (entry.session.isStreaming) await abortEntry(entry, true);
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
		} else {
			path = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			)?.path;
		}
		if (path && existsSync(path)) await trashFile(path);
	} catch (error) {
		if (installedTombstone) {
			deletedSessions.delete(sessionId);
			sessions.get(sessionId)?.commands.flushCompletions();
			sessions.get(sessionId)?.subagents.flushCompletions();
			publishSessionResourcesChanged(workspaceId, sessionId);
		}
		throw error;
	}
	if (liveEntry && sessions.get(sessionId) === liveEntry) await disposeSession(sessionId);
	try {
		removeSessionStateMetadata(sessionId);
	} catch (error) {
		log.warn(`session state metadata was not pruned for ${sessionId}`, error as Error);
	}
	publishDeleted({ workspaceId, sessionId });
}
