import { existsSync, rmSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	type ExtensionError,
	getAgentDir,
	type SessionEntry,
	type SessionInfo,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AgentSettlement,
	AskUserQuestionResult,
	ImageContent,
	Model,
	PiEvent,
	QueuedMessageContent,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	SessionAttention,
	SessionAttentionPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionQueueContent,
	SessionQueueState,
	SessionRunning,
	SessionRunningPayload,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@thinkrail/contracts";
import { isAskUserAnswersMessage, isTranscriptMessageRole } from "@thinkrail/contracts";
import type { ParentContext } from "pi-delegation";
import { RECURSION_GUARD_TOOLS } from "pi-subagents";
import { logger } from "../log";
import {
	ATTENTION_LEDGER_VERSION,
	type AttentionLedger,
	loadAttentionLedger,
	quarantineAttentionLedger,
	restoreQuarantinedAttentionLedger,
	saveAttentionLedger,
} from "../persistence";
import {
	ANSWERABILITY_ERRORS,
	ASK_USER_QUESTION_TOOL_NAME,
	assessAnswerability,
	buildAnswersMessage,
} from "./askUserQuestion";
import {
	type AttentionCandidate,
	attentionTurnId,
	deriveAttentionCandidate,
	deriveDiskAttentionCandidate,
	parseAttentionEntries,
	TRANSCRIPT_TAIL_BYTES,
	TRANSCRIPT_TAIL_MAX_BYTES,
} from "./attention";
import {
	disposeSessionChildren,
	removeWorkspaceDelegation,
	subagentsExtensionFor,
} from "./delegation";
import { buildResourceLoader, toSkillCommands } from "./extensions";
import {
	getPiRuntime,
	getPiRuntimeGeneration,
	type PiRuntimeGeneration,
	refreshCatalogs,
	settledAvailableModels,
} from "./piRuntime";
import { projectSessionEvent } from "./sessionEventProjection";
import { repairDanglingToolCalls } from "./sessionRepair";
import type { SkillAdmissionContext } from "./skillAdmission";
import { trashFile } from "./trash";
import {
	cancelExtUiForSession,
	createWebUiContext,
	notifyExtensionError,
	pendingExtUiDialogId,
} from "./webUiContext";

const log = logger("agent");

interface TrackedQueuedMessage {
	id: number;
	text: string;
	images?: ImageContent[];
}

interface Entry {
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
	registered: boolean;
	subagentToolsRefreshPending: boolean;
	userVisible: boolean;
	publishedAttentionId: string | null;
	publishedRunning: boolean;
	abortAttentionTurnId: string | null | undefined;
	abortHeldAttentionCandidate: AttentionCandidate | null;
	unpersistedAttentionCandidate: AttentionCandidate | null;
}

const sessions = new Map<string, Entry>();

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
const pendingDeletionAttention = new Map<
	string,
	{ workspaceId: string; candidate: AttentionCandidate | null }
>();

function isSessionDeleted(sessionId: string, workspaceId: string): boolean {
	return deletedSessions.get(sessionId) === workspaceId;
}

function isAttentionDeleted(sessionId: string, workspaceId: string): boolean {
	return isSessionDeleted(sessionId, workspaceId) && !deletingSessions.has(sessionId);
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

let publishAttention: (payload: SessionAttentionPayload) => void = () => {};
export function setSessionAttentionPublisher(fn: (payload: SessionAttentionPayload) => void): void {
	publishAttention = fn;
}

let publishRunning: (payload: SessionRunningPayload) => void = () => {};
export function setSessionRunningPublisher(fn: (payload: SessionRunningPayload) => void): void {
	publishRunning = fn;
}

function effectivePendingCount(entry: Entry): number {
	const stuck = entry.stuckEmptyDeliveries.steering + entry.stuckEmptyDeliveries.followUp;
	return Math.max(0, entry.session.pendingMessageCount - stuck);
}

const NEWLINE = 0x0a;

interface TranscriptTailSource {
	text: string;
	partialFirstLine: boolean;
	truncated: boolean;
}

async function readTranscriptTailSource(path: string): Promise<TranscriptTailSource> {
	const handle = await open(path, "r");
	try {
		const { size } = await handle.stat();
		let length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
		for (;;) {
			const start = size - length;
			const probe = start > 0 ? 1 : 0;
			const buffer = Buffer.allocUnsafe(length + probe);
			await handle.read(buffer, 0, length + probe, start - probe);
			if (probe === 0) {
				return { text: buffer.toString("utf8"), partialFirstLine: false, truncated: false };
			}
			if (buffer[0] === NEWLINE) {
				return {
					text: buffer.subarray(1).toString("utf8"),
					partialFirstLine: false,
					truncated: true,
				};
			}
			if (length >= TRANSCRIPT_TAIL_MAX_BYTES) {
				return { text: buffer.toString("utf8"), partialFirstLine: true, truncated: true };
			}
			length = Math.min(size, TRANSCRIPT_TAIL_MAX_BYTES, length * 8);
		}
	} finally {
		await handle.close();
	}
}

async function readAttentionTranscriptTail(
	path: string,
): Promise<{ entries: SessionEntry[]; truncated: boolean }> {
	const source = await readTranscriptTailSource(path);
	return {
		entries: parseAttentionEntries(source.text, source.partialFirstLine),
		truncated: source.truncated,
	};
}

interface DiskAttentionMemo {
	modifiedMs: number;
	size: number;
	fullRead: boolean;
	candidate: AttentionCandidate | null;
}

interface WorkspaceAttentionRow {
	sessionId: string;
	candidate: AttentionCandidate | null;
}

const diskAttentionMemo = new Map<string, DiskAttentionMemo>();
let attentionLedger: AttentionLedger | null = null;
let attentionLedgerMutation: Promise<void> = Promise.resolve();

function emptyAttentionLedger(): AttentionLedger {
	return {
		version: ATTENTION_LEDGER_VERSION,
		migrationComplete: true,
		handledCandidateBySession: {},
		internalSessionIds: [],
	};
}

function messageMayChangeBlockingAttention(message: AgentMessage): boolean {
	if (message.role === "user" || isAskUserAnswersMessage(message)) return true;
	if (message.role === "toolResult") return message.toolName === ASK_USER_QUESTION_TOOL_NAME;
	return (
		message.role === "assistant" &&
		message.content.some(
			(block) => block.type === "toolCall" && block.name === ASK_USER_QUESTION_TOOL_NAME,
		)
	);
}

function rawAttentionOf(entry: Entry): AttentionCandidate | null {
	if (!entry.userVisible) return null;
	const manager = entry.session.sessionManager;
	return deriveAttentionCandidate({
		entries: manager.getBranch(),
		isStreaming: entry.session.isStreaming,
		pendingMessageCount: effectivePendingCount(entry),
		lastSettlement: entry.lastSettlement,
		pendingDialogId: pendingExtUiDialogId(entry.session.sessionId),
	});
}

function persistedAttentionOf(entry: Entry): AttentionCandidate | null {
	return deriveDiskAttentionCandidate(entry.session.sessionManager.getEntries());
}

function isNonBlockingCandidate(candidate: AttentionCandidate): boolean {
	return candidate.kind !== "blocking";
}

function isInternalSession(sessionId: string): boolean {
	return attentionLedger?.internalSessionIds.includes(sessionId) === true;
}

function isHandledAttention(sessionId: string, candidate: AttentionCandidate): boolean {
	if (!isNonBlockingCandidate(candidate)) return false;
	const handledId = attentionLedger?.handledCandidateBySession[sessionId];
	return handledId === candidate.id || candidate.aliases?.includes(handledId ?? "") === true;
}

function effectiveAttentionOf(entry: Entry): AttentionCandidate | null {
	const candidate = rawAttentionOf(entry);
	if (
		entry.abortHeldAttentionCandidate &&
		!isHandledAttention(entry.session.sessionId, entry.abortHeldAttentionCandidate)
	) {
		return entry.abortHeldAttentionCandidate;
	}
	const fallback = entry.unpersistedAttentionCandidate;
	if (fallback && !isHandledAttention(entry.session.sessionId, fallback)) {
		const currentTurnId = attentionTurnId(entry.session.sessionManager.getBranch());
		if (currentTurnId === fallback.turnId && (!candidate || candidate.id === fallback.id)) {
			return fallback;
		}
		entry.unpersistedAttentionCandidate = null;
	}
	if (!candidate) return null;
	if (
		isNonBlockingCandidate(candidate) &&
		((entry.abortAttentionTurnId !== undefined &&
			entry.abortAttentionTurnId === candidate.turnId) ||
			isHandledAttention(entry.session.sessionId, candidate))
	) {
		return null;
	}
	return candidate;
}

async function readAllAttentionEntries(path: string): Promise<SessionEntry[]> {
	return parseAttentionEntries(await readFile(path, "utf8"), false);
}

async function diskAttentionCandidate(
	path: string,
	version: number,
	handledId?: string,
): Promise<AttentionCandidate | null> {
	const metadata = await stat(path);
	const requireFullRead =
		version < 2 ||
		handledId?.startsWith("legacy-review:") === true ||
		handledId?.startsWith("legacy-interrupted:") === true;
	const cached = diskAttentionMemo.get(path);
	if (
		cached &&
		cached.modifiedMs === metadata.mtimeMs &&
		cached.size === metadata.size &&
		(!requireFullRead || cached.fullRead)
	) {
		return cached.candidate;
	}
	const tail = await readAttentionTranscriptTail(path);
	const fullRead = requireFullRead && tail.truncated;
	const entries = fullRead ? await readAllAttentionEntries(path) : tail.entries;
	const candidate = deriveDiskAttentionCandidate(entries);
	diskAttentionMemo.set(path, {
		modifiedMs: metadata.mtimeMs,
		size: metadata.size,
		fullRead,
		candidate,
	});
	return candidate;
}

async function workspaceDiskAttentionRows(
	workspaceId: string,
	cwd: string,
	mode: "snapshot" | "migration",
): Promise<WorkspaceAttentionRow[]> {
	const liveFiles = new Set<string>();
	for (const entry of sessions.values()) {
		if (entry.workspaceId !== workspaceId) continue;
		const file = entry.session.sessionManager.getSessionFile();
		if (file) liveFiles.add(resolve(file));
	}
	const rows: WorkspaceAttentionRow[] = [];
	for (const file of await scanSessionFiles(cwd, liveFiles)) {
		if (!file.ok) {
			log.warn(`attention ${mode} skipped transcript ${file.path}`, file.error);
			continue;
		}
		const { id: sessionId, version } = file.identity;
		if (isInternalSession(sessionId) || file.identity.cwd !== cwd || sessions.has(sessionId))
			continue;
		if (mode === "snapshot" && isAttentionDeleted(sessionId, workspaceId)) continue;
		try {
			rows.push({
				sessionId,
				candidate: await diskAttentionCandidate(
					file.path,
					version,
					mode === "snapshot" ? attentionLedger?.handledCandidateBySession[sessionId] : undefined,
				),
			});
		} catch (error) {
			log.warn(`attention ${mode} skipped transcript ${file.path}`, error as Error);
		}
	}
	return rows;
}

function attentionPayload(
	sessionId: string,
	workspaceId: string,
	candidate: AttentionCandidate | null,
): SessionAttentionPayload | null {
	const projectId = sessionProjectId(workspaceId);
	if (projectId === null) return null;
	return candidate
		? {
				sessionId,
				workspaceId,
				projectId,
				attentionId: candidate.id,
				attentionPriority: candidate.kind === "blocking" ? "blocking" : "normal",
				attentionAt: candidate.attentionAt,
			}
		: { sessionId, workspaceId, projectId, attentionId: null };
}

function runningPayload(
	sessionId: string,
	workspaceId: string,
	running: boolean,
): SessionRunningPayload | null {
	const projectId = sessionProjectId(workspaceId);
	return projectId === null ? null : { sessionId, workspaceId, projectId, running };
}

export function listRunningSessions(): SessionRunning[] {
	const rows: SessionRunning[] = [];
	for (const [sessionId, entry] of sessions) {
		if (hasDeletionTombstone(sessionId)) continue;
		if (!entry.userVisible || !entry.session.isStreaming) continue;
		const projectId = sessionProjectId(entry.workspaceId);
		if (projectId === null) continue;
		rows.push({ sessionId, workspaceId: entry.workspaceId, projectId });
	}
	return rows;
}

export function syncSessionRunning(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	const running = entry.userVisible && entry.session.isStreaming;
	if (running === entry.publishedRunning) return;
	const payload = runningPayload(sessionId, entry.workspaceId, running);
	if (!payload) return;
	entry.publishedRunning = running;
	publishRunning(payload);
}

function retractSessionRunning(sessionId: string, entry: Entry): void {
	if (!entry.publishedRunning) return;
	const payload = runningPayload(sessionId, entry.workspaceId, false);
	entry.publishedRunning = false;
	if (payload) publishRunning(payload);
}

async function setSessionUserVisible(
	sessionId: string,
	entry: Entry,
	visible: boolean,
): Promise<void> {
	if (entry.userVisible === visible) return;
	await setSessionInternal(sessionId, !visible);
	entry.userVisible = visible;
	if (visible) syncSessionRunning(sessionId);
	else retractSessionRunning(sessionId, entry);
	syncSessionAttention(sessionId);
}

export function syncSessionAttention(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (
		!entry ||
		isAttentionDeleted(sessionId, entry.workspaceId) ||
		deletingSessions.has(sessionId)
	) {
		return;
	}
	const candidate = effectiveAttentionOf(entry);
	const attentionId = candidate?.id ?? null;
	if (attentionId === entry.publishedAttentionId) return;
	const payload = attentionPayload(sessionId, entry.workspaceId, candidate);
	if (!payload) return;
	entry.publishedAttentionId = attentionId;
	publishAttention(payload);
}

function queueAttentionLedgerMutation(
	update: (ledger: AttentionLedger) => AttentionLedger | null,
): Promise<boolean> {
	let changed = false;
	const operation = attentionLedgerMutation.then(() => {
		if (!attentionLedger) throw new Error("Session attention is not initialized");
		const next = update(attentionLedger);
		if (!next) return;
		saveAttentionLedger(next);
		attentionLedger = next;
		changed = true;
	});
	attentionLedgerMutation = operation.then(
		() => {},
		() => {},
	);
	return operation.then(() => changed);
}

function markAttentionHandled(sessionId: string, attentionId: string): Promise<boolean> {
	return queueAttentionLedgerMutation((ledger) => {
		if (ledger.handledCandidateBySession[sessionId] === attentionId) return null;
		return {
			...ledger,
			handledCandidateBySession: {
				...ledger.handledCandidateBySession,
				[sessionId]: attentionId,
			},
		};
	});
}

function setSessionInternal(sessionId: string, internal: boolean): Promise<boolean> {
	return queueAttentionLedgerMutation((ledger) => {
		const current = ledger.internalSessionIds.includes(sessionId);
		if (current === internal) return null;
		return {
			...ledger,
			internalSessionIds: internal
				? [...ledger.internalSessionIds, sessionId].sort()
				: ledger.internalSessionIds.filter((candidate) => candidate !== sessionId),
		};
	});
}

function removeSessionAttentionState(sessionIds: readonly string[]): Promise<boolean> {
	const removed = new Set(sessionIds);
	return queueAttentionLedgerMutation((ledger) => {
		const entries = Object.entries(ledger.handledCandidateBySession).filter(
			([sessionId]) => !removed.has(sessionId),
		);
		const internalSessionIds = ledger.internalSessionIds.filter(
			(sessionId) => !removed.has(sessionId),
		);
		if (
			entries.length === Object.keys(ledger.handledCandidateBySession).length &&
			internalSessionIds.length === ledger.internalSessionIds.length
		) {
			return null;
		}
		return {
			...ledger,
			handledCandidateBySession: Object.fromEntries(entries),
			internalSessionIds,
		};
	});
}

export async function initializeSessionAttention(
	workspaces: readonly { id: string; cwd: string }[],
): Promise<void> {
	await attentionLedgerMutation;
	const loaded = loadAttentionLedger();
	if (loaded.status === "ready") {
		attentionLedger = loaded.ledger;
		return;
	}
	if (loaded.status === "invalid") {
		const quarantined = loaded.quarantined ?? quarantineAttentionLedger();
		log.warn(`invalid attention ledger retained at ${quarantined}`, loaded.error);
		try {
			const ledger = emptyAttentionLedger();
			saveAttentionLedger(ledger);
			attentionLedger = ledger;
		} catch (error) {
			restoreQuarantinedAttentionLedger(quarantined);
			throw error;
		}
		return;
	}
	const handledCandidateBySession: Record<string, string> = {};
	for (const [sessionId, entry] of sessions) {
		const candidate = rawAttentionOf(entry);
		if (candidate && isNonBlockingCandidate(candidate)) {
			handledCandidateBySession[sessionId] = candidate.id;
		}
	}
	for (const workspace of workspaces) {
		try {
			for (const row of await workspaceDiskAttentionRows(
				workspace.id,
				workspace.cwd,
				"migration",
			)) {
				if (row.candidate && isNonBlockingCandidate(row.candidate)) {
					handledCandidateBySession[row.sessionId] = row.candidate.id;
				}
			}
		} catch (error) {
			log.warn(`attention migration skipped workspace ${workspace.id}`, error as Error);
		}
	}
	const ledger: AttentionLedger = {
		version: ATTENTION_LEDGER_VERSION,
		migrationComplete: true,
		handledCandidateBySession,
		internalSessionIds: [],
	};
	saveAttentionLedger(ledger);
	attentionLedger = ledger;
}

export async function listSessionAttention(
	workspaces: readonly { id: string; cwd: string }[] = [],
): Promise<SessionAttention[]> {
	const rows = new Map<string, SessionAttention>();
	const keyOf = (workspaceId: string, sessionId: string) => `${workspaceId}\u0000${sessionId}`;
	const applyLive = (): void => {
		for (const [sessionId, entry] of sessions) {
			const key = keyOf(entry.workspaceId, sessionId);
			if (isAttentionDeleted(sessionId, entry.workspaceId)) {
				rows.delete(key);
				continue;
			}
			const candidate = effectiveAttentionOf(entry);
			const payload = candidate ? attentionPayload(sessionId, entry.workspaceId, candidate) : null;
			if (payload?.attentionId) rows.set(key, { ...payload, attentionId: payload.attentionId });
			else rows.delete(key);
		}
	};
	applyLive();
	for (const workspace of workspaces) {
		const projectId = sessionProjectId(workspace.id);
		if (projectId === null) continue;
		try {
			for (const row of await workspaceDiskAttentionRows(workspace.id, workspace.cwd, "snapshot")) {
				const candidate = row.candidate;
				if (!candidate || isHandledAttention(row.sessionId, candidate)) continue;
				const payload = attentionPayload(row.sessionId, workspace.id, candidate);
				if (payload?.attentionId) {
					rows.set(keyOf(workspace.id, row.sessionId), {
						...payload,
						attentionId: payload.attentionId,
					});
				}
			}
		} catch (error) {
			log.warn(`attention snapshot skipped workspace ${workspace.id}`, error as Error);
		}
	}
	applyLive();
	for (const [sessionId, workspaceId] of deletedSessions) {
		if (!deletingSessions.has(sessionId)) rows.delete(keyOf(workspaceId, sessionId));
	}
	for (const [sessionId, pending] of pendingDeletionAttention) {
		const candidate = pending.candidate;
		const payload = candidate ? attentionPayload(sessionId, pending.workspaceId, candidate) : null;
		if (payload?.attentionId) {
			rows.set(keyOf(pending.workspaceId, sessionId), {
				...payload,
				attentionId: payload.attentionId,
			});
		} else {
			rows.delete(keyOf(pending.workspaceId, sessionId));
		}
	}
	return [...rows.values()];
}

export async function acknowledgeSessionAttention(
	workspaceId: string,
	sessionId: string,
	attentionId: string,
): Promise<void> {
	const entry = sessions.get(sessionId);
	if (!entry || entry.workspaceId !== workspaceId || isSessionDeleted(sessionId, workspaceId)) {
		throw new Error(`Unknown session: ${sessionId}`);
	}
	const candidate = effectiveAttentionOf(entry);
	const matches =
		candidate?.id === attentionId || candidate?.aliases?.includes(attentionId) === true;
	if (!candidate || !matches || candidate.kind === "blocking") return;
	await markAttentionHandled(sessionId, candidate.id);
	if (entry.unpersistedAttentionCandidate?.id === candidate.id) {
		entry.unpersistedAttentionCandidate = null;
	}
	syncSessionAttention(sessionId);
}

let sessionManagerFactory: (cwd: string) => SessionManager = (cwd) => SessionManager.create(cwd);
export function setSessionManagerFactory(factory: (cwd: string) => SessionManager): void {
	sessionManagerFactory = factory;
}

let skillAdmissionResolver: (workspaceId: string) => SkillAdmissionContext = () => ({
	trusted: false,
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

let sessionProjectResolver: (workspaceId: string) => string | null = () => null;
export function setSessionProjectResolver(resolver: (workspaceId: string) => string | null): void {
	sessionProjectResolver = resolver;
}

function sessionProjectId(workspaceId: string): string | null {
	try {
		return sessionProjectResolver(workspaceId);
	} catch {
		return null;
	}
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

export async function reloadSessionResources(sessionId: string): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		throw new Error(
			"Can't reload skills while the session is streaming — try again after the turn.",
		);
	}
	await session.reload();
}

export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted: true });
	settings.applyOverrides({ images: { autoResize: false } });
	return settings;
}

export interface CreateSessionInput {
	cwd: string;
	workspaceId: string;
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
	userVisible?: boolean;
	/** True: an unresolvable `model` falls back to the default instead of throwing. */
	modelOptional?: boolean;
}

export interface CreateSessionResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

export function toWireModel(model: Model<string>): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
	};
}

function resolveWireModel(
	runtime: PiRuntimeGeneration["runtime"],
	ref: Pick<WireModel, "provider" | "id">,
): Model<string> {
	const available = settledAvailableModels(runtime);
	const match = available.find((model) => model.provider === ref.provider && model.id === ref.id);
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

interface PreparedSessionEntry {
	entry: Entry;
	result: CreateSessionResult;
}

async function prepareSessionEntry(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	lastSettlement: AgentSettlement | null | undefined = undefined,
	userVisible = true,
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: AgentSettlement | null = null;
	const entry: Entry = {
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
		registered: false,
		subagentToolsRefreshPending: false,
		userVisible,
		publishedAttentionId: null,
		publishedRunning: false,
		abortAttentionTurnId: undefined,
		abortHeldAttentionCandidate: null,
		unpersistedAttentionCandidate: null,
	};
	entry.unsubscribe = session.subscribe((event) => {
		if (event.type === "message_start" && event.message.role === "user") {
			const lane = deliveredStuckEmptyLane(entry, event.message.content);
			if (lane) {
				entry.stuckEmptyDeliveries[lane]++;
				synchronizeQueueFromSession(entry);
				if (sessions.get(sessionId) === entry)
					publish({ sessionId, event: queueUpdateEventOf(entry) });
			}
		}
		if (event.type === "queue_update") {
			synchronizeQueuedLane(entry, "steering", displayedLane(entry, "steering", event.steering));
			synchronizeQueuedLane(entry, "followUp", displayedLane(entry, "followUp", event.followUp));
		}
		if (event.type === "compaction_start") entry.piCompactionInProgress = true;
		if (event.type === "compaction_end") entry.piCompactionInProgress = false;
		if (event.type === "agent_start") {
			entry.lastSettlement = null;
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
			if (entry.subagentToolsRefreshPending) applySubagentTools(entry);
		}
		if (sessions.get(sessionId) === entry) publish({ sessionId, event: projected });
		if (event.type === "agent_settled") terminal = null;
		if (sessions.get(sessionId) === entry) {
			if (event.type === "agent_start" || event.type === "agent_settled") {
				syncSessionRunning(sessionId);
			}
			if (
				event.type === "agent_start" ||
				event.type === "agent_settled" ||
				event.type === "queue_update"
			) {
				syncSessionAttention(sessionId);
			}
		}
		if (event.type === "message_end" && messageMayChangeBlockingAttention(event.message)) {
			queueMicrotask(() => {
				if (sessions.get(sessionId) === entry) syncSessionAttention(sessionId);
			});
		}
	});

	const reportExtensionError = (failure: ExtensionError): void => {
		const line = `extension ${failure.extensionPath} failed on ${failure.event}: ${failure.error}`;
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
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: reportExtensionError,
		});
		if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	} catch (error) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		session.dispose();
		throw error;
	}

	return {
		entry,
		result: {
			sessionId,
			model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
			thinkingLevel: session.thinkingLevel,
		},
	};
}

async function registerSession(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	options: { announceCreation?: boolean; userVisible?: boolean } = {},
): Promise<CreateSessionResult> {
	const persistedUserVisible = !isInternalSession(session.sessionId);
	const userVisible = options.userVisible ?? persistedUserVisible;
	if (userVisible !== persistedUserVisible) {
		await setSessionInternal(session.sessionId, !userVisible);
	}
	const prepared = await prepareSessionEntry(
		session,
		workspaceId,
		generation,
		undefined,
		userVisible,
	);
	prepared.entry.registered = true;
	sessions.set(session.sessionId, prepared.entry);
	syncSessionRunning(session.sessionId);
	syncSessionAttention(session.sessionId);
	applySubagentTools(prepared.entry);
	log.debug(`session ${session.sessionId} attached (workspace ${workspaceId})`);
	if (options.announceCreation) publishCreated(summaryOf(session.sessionId, prepared.entry));
	return prepared.result;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(input.cwd);
	let model: Model<string> | undefined;
	if (input.model) {
		try {
			model = resolveWireModel(generation.runtime, input.model);
		} catch (err) {
			if (!input.modelOptional) throw err;
		}
	}
	const { session } = await createAgentSession({
		cwd: input.cwd,
		modelRuntime: generation.runtime,
		sessionManager: sessionManagerFactory(input.cwd),
		settingsManager,
		resourceLoader: await buildResourceLoader(
			input.cwd,
			settingsManager,
			() => skillAdmissionResolver(input.workspaceId),
			generation.excludedSessionExtensionPaths,
			[subagentsExtensionFor(input.workspaceId, () => subagentsEnabled(input.workspaceId))],
		),
		...(model ? { model } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.workspaceId, generation, {
		announceCreation: true,
		...(input.userVisible !== undefined ? { userVisible: input.userVisible } : {}),
	});
}

function summaryOf(sessionId: string, entry: Entry): SessionSummary {
	const { session } = entry;
	return {
		sessionId,
		workspaceId: entry.workspaceId,
		title: session.sessionName ?? "Chat",
		model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		messageCount: session.messages.length,
		updatedAt: Date.now(),
		live: true,
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
		...(effectivePendingCount(entry) > 0 ? { queue: queueStateOf(entry) } : {}),
	};
}

interface SessionFileIdentity {
	id: string;
	cwd: string;
	version: number;
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

const SESSION_HEADER_MAX_BYTES = 64 * 1024;

async function readSessionFileIdentity(path: string): Promise<SessionFileIdentity> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.allocUnsafe(SESSION_HEADER_MAX_BYTES + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const source = buffer
			.subarray(0, Math.min(bytesRead, SESSION_HEADER_MAX_BYTES))
			.toString("utf8");
		for (const line of source.split("\n")) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				if (bytesRead > SESSION_HEADER_MAX_BYTES && !source.includes("\n")) {
					throw new Error("session header exceeds the read limit");
				}
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
			const headerVersion = Reflect.get(entry, "version");
			return {
				id,
				cwd: typeof headerCwd === "string" ? headerCwd : "",
				version: typeof headerVersion === "number" ? headerVersion : 1,
			};
		}
		throw new Error(
			bytesRead > SESSION_HEADER_MAX_BYTES
				? "session header exceeds the read limit"
				: "session header is missing",
		);
	} catch (error) {
		throw new Error(`Session transcript is unreadable or malformed: ${path}`, { cause: error });
	} finally {
		await handle.close();
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
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
		const sessionFile = entry.session.sessionManager.getSessionFile();
		if (sessionFile) liveFiles.add(resolve(sessionFile));
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
		}));
	return [...live, ...disk];
}

export function listSessions(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	return listSessionsInternal(workspaceId, cwd);
}

const attaching = new Map<string, Promise<void>>();
const attachingUserVisible = new Map<string, boolean | undefined>();

function attachDiskSession(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	userVisible?: boolean,
): Promise<void> {
	if (isSessionDeleted(sessionId, workspaceId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		attachingUserVisible.set(sessionId, userVisible);
		pending = openDiskSession(sessionId, workspaceId, cwd).finally(() => {
			attaching.delete(sessionId);
			attachingUserVisible.delete(sessionId);
		});
		attaching.set(sessionId, pending);
	} else if (userVisible === false) {
		attachingUserVisible.set(sessionId, false);
	} else if (userVisible === true && attachingUserVisible.get(sessionId) !== false) {
		attachingUserVisible.set(sessionId, true);
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

async function openDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	const info = (await listSessionInfosStrict(cwd)).find(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return;
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(cwd);
	const sessionManager = SessionManager.open(info.path);
	const persistedModel = persistedSessionModelRef(sessionManager.buildSessionContext().model);
	let exactModel: Model<string> | undefined;
	if (persistedModel) {
		try {
			exactModel = resolveWireModel(generation.runtime, persistedModel);
		} catch {
			throw new Error("The chat's saved model is unavailable.");
		}
	}
	repairDanglingToolCalls(sessionManager);
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: generation.runtime,
		sessionManager,
		settingsManager,
		resourceLoader: await buildResourceLoader(
			cwd,
			settingsManager,
			() => skillAdmissionResolver(workspaceId),
			generation.excludedSessionExtensionPaths,
			[subagentsExtensionFor(workspaceId, () => subagentsEnabled(workspaceId))],
		),
		...(exactModel ? { model: exactModel } : {}),
	});
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	const userVisible = attachingUserVisible.get(sessionId);
	await registerSession(session, workspaceId, generation, {
		...(userVisible !== undefined ? { userVisible } : {}),
	});
}

async function ensureSessionAttachedInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	userVisible?: boolean,
): Promise<boolean> {
	if (isSessionDeleted(sessionId, workspaceId)) return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
		if (userVisible !== undefined) await setSessionUserVisible(sessionId, live, userVisible);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!known) return false;
	await attachDiskSession(sessionId, workspaceId, cwd, userVisible);
	const attached = sessions.get(sessionId);
	if (!attached) throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	if (userVisible !== undefined) await setSessionUserVisible(sessionId, attached, userVisible);
	return true;
}

export function ensureSessionAttached(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	options: { userVisible?: boolean } = {},
): Promise<boolean> {
	return ensureSessionAttachedInternal(sessionId, workspaceId, cwd, options.userVisible);
}

async function getSessionMessagesInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	let entry = sessions.get(sessionId);
	if (entry && entry.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, workspaceId, cwd);
		if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	const messages = entry.session.messages.filter((m) =>
		isTranscriptMessageRole(m.role),
	) as TranscriptMessage[];
	return { summary: summaryOf(sessionId, entry), messages };
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
	const session = mustGet(sessionId);
	const verdict = assessAnswerability(session.messages, toolCallId);
	if (!verdict.ok) throw new Error(`${ANSWERABILITY_ERRORS[verdict.reason]}: ${toolCallId}`);
	await session.sendCustomMessage(buildAnswersMessage(toolCallId, verdict.args, result), {
		triggerTurn: true,
	});
	syncSessionAttention(sessionId);
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

async function queueSessionMessage(
	entry: Entry,
	kind: QueueLane,
	text: string,
	images: ImageContent[] | undefined,
	send: () => Promise<void>,
): Promise<void> {
	const tracked: TrackedQueuedMessage = {
		id: entry.nextQueuedMessageId++,
		text,
		...(images && images.length > 0 ? { images: [...images] } : {}),
	};
	entry.queuedMessages[kind].push(tracked);
	try {
		await send();
	} catch (error) {
		entry.queuedMessages[kind] = entry.queuedMessages[kind].filter(
			(message) => message.id !== tracked.id,
		);
		synchronizeQueueFromSession(entry);
		throw error;
	}
}

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	if (entry.session.isStreaming) {
		await queueSessionMessage(entry, "steering", text, images, () =>
			entry.session.steer(text, images),
		);
		return;
	}
	await entry.session.prompt(text, images ? { images } : undefined);
}

export async function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	await queueSessionMessage(entry, "steering", text, images, () =>
		entry.session.steer(text, images),
	);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const entry = mustGetEntry(sessionId);
	if (entry.session.isStreaming) {
		await queueSessionMessage(entry, "followUp", text, images, () =>
			entry.session.followUp(text, images),
		);
		return;
	}
	await entry.session.prompt(text, images ? { images } : undefined);
}

export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	const entry = mustGetEntry(sessionId);
	if (entry.manualCompactionInProgress || entry.piCompactionInProgress) {
		throw new Error("Compaction is already in progress for this session");
	}
	entry.manualCompactionInProgress = true;
	try {
		await entry.session.compact(instructions);
	} finally {
		entry.manualCompactionInProgress = false;
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
	const entry = mustGetEntry(sessionId);
	const content = queueContentOf(entry);
	if (requireTextOnly && hasQueuedImages(entry)) {
		throw new Error("Cannot restore queued image messages as text");
	}
	entry.session.clearQueue();
	entry.stuckEmptyDeliveries = { steering: 0, followUp: 0 };
	syncSessionAttention(sessionId);
	return content;
}

export async function removeQueuedSession(
	sessionId: string,
	kind: QueueLane,
	index: number,
): Promise<RemovedQueuedMessage> {
	const entry = mustGetEntry(sessionId);
	const { session } = entry;
	const drained = clearQueueSession(sessionId);
	const lane = [...drained[kind]];
	const removed = index >= 0 && index < lane.length ? (lane.splice(index, 1)[0] ?? null) : null;
	const keep = { ...drained, [kind]: lane };
	for (const message of keep.steering) {
		await steerSession(sessionId, message.text, message.images ? [...message.images] : undefined);
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
	syncSessionAttention(sessionId);
	return { removed, queue: queueStateOf(entry) };
}

export async function abortSession(
	sessionId: string,
	restoreQueue = false,
): Promise<SessionQueueContent | undefined> {
	const entry = mustGetEntry(sessionId);
	const entriesBefore = entry.session.sessionManager.getBranch();
	const turnId = attentionTurnId(entriesBefore);
	const before = persistedAttentionOf(entry);
	const held = effectiveAttentionOf(entry);
	entry.abortHeldAttentionCandidate = held && isNonBlockingCandidate(held) ? held : null;
	entry.abortAttentionTurnId = turnId;
	let restoredQueue: SessionQueueContent | undefined;
	let persistenceFailureCandidate: AttentionCandidate | null = null;
	try {
		restoredQueue = restoreQueue ? clearQueueSession(sessionId) : undefined;
		await entry.session.abort();
		const after = persistedAttentionOf(entry);
		const candidate =
			after && isNonBlockingCandidate(after) && after.turnId === turnId
				? after
				: before && isNonBlockingCandidate(before) && before.turnId === turnId
					? before
					: null;
		if (candidate && attentionLedger) {
			try {
				await markAttentionHandled(sessionId, candidate.id);
			} catch (error) {
				persistenceFailureCandidate = candidate;
				log.warn(
					`attention acknowledgement failed for aborted session ${sessionId}`,
					error as Error,
				);
			}
		}
	} finally {
		entry.abortAttentionTurnId = undefined;
		entry.abortHeldAttentionCandidate = null;
		if (persistenceFailureCandidate) {
			entry.unpersistedAttentionCandidate = persistenceFailureCandidate;
		}
		syncSessionAttention(sessionId);
	}
	return restoredQueue;
}

export async function abortSessionForDisposal(sessionId: string): Promise<void> {
	await mustGetEntry(sessionId).session.abort();
}

export async function setSessionModel(sessionId: string, model: WireModel): Promise<void> {
	const entry = mustGetEntry(sessionId);
	await entry.session.setModel(resolveWireModel(entry.generation.runtime, model));
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
	const runtime = await getPiRuntime();
	void refreshCatalogs(runtime);
	return readAvailableWireModels(runtime);
}

export async function refreshAvailableModels(force = false): Promise<RefreshedModels> {
	const runtime = await getPiRuntime();
	const { completed } = await refreshCatalogs(runtime, { force });
	return { models: readAvailableWireModels(runtime), complete: completed };
}

function readAvailableWireModels(runtime: Awaited<ReturnType<typeof getPiRuntime>>): WireModel[] {
	return settledAvailableModels(runtime).map((m) => toWireModel(m as unknown as Model<string>));
}

export interface DefaultModelResult {
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

export async function clampThinkingForModel(
	ref: Pick<WireModel, "provider" | "id">,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	const generation = await getPiRuntimeGeneration();
	return clampThinkingLevel(resolveWireModel(generation.runtime, ref), level);
}

export async function getDefaultModel(): Promise<DefaultModelResult> {
	const available = settledAvailableModels(await getPiRuntime());
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((model) => model.provider === provider && model.id === modelId)
			: undefined;
	const resolved = (pinned ?? null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

export function liveParentContext(sessionId: string): ParentContext | undefined {
	const entry = sessions.get(sessionId);
	if (!entry) return undefined;
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

function disposeSession(sessionId: string): Promise<void> {
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	const cascade = trackCascade(
		entry.workspaceId,
		disposeSessionChildren(entry.workspaceId, sessionId).catch(() => {}),
	);
	cancelExtUiForSession(sessionId);
	retractSessionRunning(sessionId, entry);
	syncSessionAttention(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
	log.debug(`session ${sessionId} disposed`);
	return cascade;
}

export function removeSession(sessionId: string): Promise<void> {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	return disposeSession(sessionId);
}

export function disposeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		void trackCascade(
			entry.workspaceId,
			disposeSessionChildren(entry.workspaceId, sessionId).catch(() => {}),
		);
		cancelExtUiForSession(sessionId);
		retractSessionRunning(sessionId, entry);
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
	deletedSessions.clear();
	pendingDeletionAttention.clear();
	attentionLedger = null;
	attentionLedgerMutation = Promise.resolve();
}

export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const settling = new Set<Promise<unknown>>();
	for (const [sessionId, entry] of sessions) {
		if (entry.session.isStreaming) settling.add(entry.session.abort());
		settling.add(
			trackCascade(
				entry.workspaceId,
				disposeSessionChildren(entry.workspaceId, sessionId).catch(() => {}),
			),
		);
	}
	for (const pending of pendingCascades.values()) {
		for (const cascade of pending) settling.add(cascade);
	}
	if (settling.size === 0) return;
	await Promise.race([
		Promise.allSettled(settling),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

async function removeWorkspaceSessionsInternal(workspaceId: string, cwd?: string): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.workspaceId === workspaceId)
		.map(([sessionId]) => sessionId);
	const removedIds = new Set(ids);
	if (cwd) {
		try {
			for (const info of await SessionManager.list(cwd)) {
				if (info.cwd === cwd) removedIds.add(info.id);
			}
		} catch {}
	}
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		await disposeSession(sessionId);
	}
	await Promise.all([...(pendingCascades.get(workspaceId) ?? [])]);
	removeWorkspaceDelegation(workspaceId);
	if (cwd) await purgeDiskSessions(cwd);
	if (attentionLedger && removedIds.size > 0) {
		try {
			await removeSessionAttentionState([...removedIds]);
		} catch (error) {
			log.warn(`attention cleanup failed for removed workspace ${workspaceId}`, error as Error);
		}
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
		if (info.cwd === cwd) rmSync(info.path, { force: true });
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
		let deletionCandidate: AttentionCandidate | null = null;
		if (entry) {
			liveEntry = entry;
			if (entry.session.isStreaming) await entry.session.abort();
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
			deletionCandidate = effectiveAttentionOf(entry);
		} else {
			const info = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			);
			path = info?.path;
			const identity = info ? await readSessionFileIdentity(info.path) : null;
			const candidate =
				info && identity
					? await diskAttentionCandidate(
							info.path,
							identity.version,
							attentionLedger?.handledCandidateBySession[sessionId],
						)
					: null;
			deletionCandidate = candidate && !isHandledAttention(sessionId, candidate) ? candidate : null;
		}
		pendingDeletionAttention.set(sessionId, {
			workspaceId,
			candidate: deletionCandidate,
		});
		if (path && existsSync(path)) {
			await trashFile(path);
			diskAttentionMemo.delete(path);
		}
	} catch (error) {
		pendingDeletionAttention.delete(sessionId);
		if (installedTombstone) {
			deletedSessions.delete(sessionId);
			syncSessionAttention(sessionId);
		}
		throw error;
	}
	if (liveEntry && sessions.get(sessionId) === liveEntry) await disposeSession(sessionId);
	if (attentionLedger) {
		try {
			await removeSessionAttentionState([sessionId]);
		} catch (error) {
			log.warn(`attention cleanup failed for deleted session ${sessionId}`, error as Error);
		}
	}
	pendingDeletionAttention.delete(sessionId);
	const retraction = attentionPayload(sessionId, workspaceId, null);
	if (retraction) publishAttention(retraction);
	publishDeleted({ workspaceId, sessionId });
}
