import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	type ExtensionError,
	getAgentDir,
	type SessionInfo,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentSettlement,
	AskUserQuestionResult,
	ImageContent,
	Model,
	QueuedMessageContent,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionQueueContent,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@thinkrail/contracts";
import { isTranscriptMessageRole } from "@thinkrail/contracts";
import type { ParentContext } from "pi-delegation";
import { logger } from "../log";
import { ANSWERABILITY_ERRORS, assessAnswerability, buildAnswersMessage } from "./askUserQuestion";
import {
	disposeSessionChildren,
	quiesceParentDelegation,
	removeWorkspaceDelegation,
	subagentsExtensionFor,
	sweepUndeliveredCompletions,
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
import { cancelExtUiForSession, createWebUiContext, notifyExtensionError } from "./webUiContext";

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
	nextQueuedMessageId: number;
	manualCompactionInProgress: boolean;
	piCompactionInProgress: boolean;
	registered: boolean;
	shutdownEmitted: boolean;
	resourceReload?: Promise<void>;
}

const sessions = new Map<string, Entry>();
let sessionAdmissionClosed = false;
let sessionAdmissionEpoch = 0;
const closingWorkspaces = new Set<string>();
const workspaceTeardowns = new Map<string, Promise<void>>();
const sessionPreparations = new Map<string, Set<Promise<void>>>();

function assertSessionAdmission(workspaceId: string, admissionEpoch: number): void {
	if (sessionAdmissionClosed || admissionEpoch !== sessionAdmissionEpoch) {
		throw new Error("Server is shutting down");
	}
	if (closingWorkspaces.has(workspaceId)) throw new Error(`Unknown workspace: ${workspaceId}`);
}

export function beginSessionShutdown(): void {
	if (sessionAdmissionClosed) return;
	sessionAdmissionClosed = true;
	sessionAdmissionEpoch += 1;
}

export function resetSessionAdmissionForTests(): void {
	sessionAdmissionClosed = false;
	sessionAdmissionEpoch += 1;
}

function trackSessionPreparation<T>(workspaceId: string, operation: Promise<T>): Promise<T> {
	let pending = sessionPreparations.get(workspaceId);
	if (!pending) {
		pending = new Set();
		sessionPreparations.set(workspaceId, pending);
	}
	const scope = pending;
	let settlement: Promise<void>;
	const finish = (): void => {
		scope.delete(settlement);
		if (scope.size === 0 && sessionPreparations.get(workspaceId) === scope) {
			sessionPreparations.delete(workspaceId);
		}
	};
	settlement = operation.then(finish, finish);
	scope.add(settlement);
	return operation;
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

interface DisposalFlight {
	workspaceId: string;
	cwd: string;
	persisted: boolean;
	path?: string;
	done: Promise<void>;
}

const disposingSessions = new Map<string, DisposalFlight>();

function isSessionDeleted(sessionId: string, workspaceId: string): boolean {
	return deletingSessions.has(sessionId) || deletedSessions.get(sessionId) === workspaceId;
}

function completedDeletionFor(sessionId: string, workspaceId: string): boolean {
	if (deletingSessions.has(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const deletedWorkspaceId = deletedSessions.get(sessionId);
	if (deletedWorkspaceId === undefined) return false;
	if (deletedWorkspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
	return true;
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

function isSessionUnavailable(sessionId: string): boolean {
	return (
		deletingSessions.has(sessionId) ||
		deletedSessions.has(sessionId) ||
		disposingSessions.has(sessionId)
	);
}

function mustGetEntry(sessionId: string): Entry {
	if (sessionAdmissionClosed) throw new Error("Server is shutting down");
	if (isSessionUnavailable(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry;
}

function mustGet(sessionId: string): AgentSession {
	return mustGetEntry(sessionId).session;
}

export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId) && !isSessionUnavailable(sessionId);
}

export function getSessionWorkspaceId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.workspaceId;
}

export function reloadSessionResources(sessionId: string): Promise<void> {
	const entry = mustGetEntry(sessionId);
	if (entry.resourceReload) return entry.resourceReload;
	if (entry.session.isStreaming) {
		throw new Error(
			"Can't reload skills while the session is streaming — try again after the turn.",
		);
	}
	const releaseDelegation = quiesceParentDelegation(entry.workspaceId, sessionId);
	let resourceReload!: Promise<void>;
	resourceReload = (async () => {
		try {
			await entry.session.reload();
		} finally {
			if (entry.resourceReload === resourceReload) delete entry.resourceReload;
			releaseDelegation();
			void sweepUndeliveredCompletions(entry.workspaceId, sessionId, entry.session).catch(() => {});
		}
	})();
	entry.resourceReload = resourceReload;
	return resourceReload;
}

export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted: true });
	const applySessionOverrides = () => settings.applyOverrides({ images: { autoResize: false } });
	const reload = settings.reload.bind(settings);
	settings.reload = async () => {
		await reload();
		applySessionOverrides();
	};
	applySessionOverrides();
	return settings;
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

function requestCompletionSweep(sessionId: string, entry: Entry): void {
	if (sessions.get(sessionId) !== entry || isSessionUnavailable(sessionId)) return;
	void sweepUndeliveredCompletions(entry.workspaceId, sessionId, entry.session).catch(() => {});
}

async function prepareSessionEntry(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	lastSettlement: AgentSettlement | null | undefined = undefined,
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
		nextQueuedMessageId: 1,
		manualCompactionInProgress: false,
		piCompactionInProgress: false,
		registered: false,
		shutdownEmitted: false,
	};
	entry.unsubscribe = session.subscribe((event) => {
		if (event.type === "queue_update") {
			synchronizeQueuedLane(entry, "steering", event.steering);
			synchronizeQueuedLane(entry, "followUp", event.followUp);
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
			baseEvent.type === "queue_update" && hasQueuedImages(entry)
				? { ...baseEvent, hasImages: true as const }
				: baseEvent;
		if (event.type === "agent_settled") entry.lastSettlement = terminal;
		if (sessions.get(sessionId) === entry) {
			publish({ sessionId, event: projected });
			if (event.type === "agent_settled") requestCompletionSweep(sessionId, entry);
			if (event.type === "compaction_end") {
				queueMicrotask(() => requestCompletionSweep(sessionId, entry));
			}
		}
		if (event.type === "agent_settled") terminal = null;
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
	admissionEpoch: number,
	announceCreation = false,
): Promise<CreateSessionResult> {
	try {
		assertSessionAdmission(workspaceId, admissionEpoch);
	} catch (error) {
		session.dispose();
		throw error;
	}
	const prepared = await prepareSessionEntry(session, workspaceId, generation);
	try {
		assertSessionAdmission(workspaceId, admissionEpoch);
	} catch (error) {
		cancelExtUiForSession(session.sessionId);
		prepared.entry.unsubscribe();
		session.dispose();
		throw error;
	}
	prepared.entry.registered = true;
	sessions.set(session.sessionId, prepared.entry);
	log.debug(`session ${session.sessionId} attached (workspace ${workspaceId})`);
	if (announceCreation) publishCreated(summaryOf(session.sessionId, prepared.entry));
	return prepared.result;
}

async function createSessionInternal(
	input: CreateSessionInput,
	admissionEpoch: number,
): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	assertSessionAdmission(input.workspaceId, admissionEpoch);
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
			[subagentsExtensionFor(input.workspaceId)],
		),
		...(model ? { model } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.workspaceId, generation, admissionEpoch, true);
}

export function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const admissionEpoch = sessionAdmissionEpoch;
	assertSessionAdmission(input.workspaceId, admissionEpoch);
	return trackSessionPreparation(input.workspaceId, createSessionInternal(input, admissionEpoch));
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
		...(session.pendingMessageCount > 0 ? { queue: queueStateOf(entry) } : {}),
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

interface AttachmentFlight {
	workspaceId: string;
	cwd: string;
	done: Promise<void>;
}

const attaching = new Map<string, AttachmentFlight>();

function attachDiskSession(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	admissionEpoch = sessionAdmissionEpoch,
): Promise<void> {
	try {
		assertSessionAdmission(workspaceId, admissionEpoch);
	} catch (error) {
		return Promise.reject(error);
	}
	const disposal = disposingSessions.get(sessionId);
	if (disposal) return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (isSessionDeleted(sessionId, workspaceId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	const pending = attaching.get(sessionId);
	if (pending) {
		return pending.workspaceId === workspaceId && pending.cwd === cwd
			? pending.done
			: Promise.reject(new Error(`Unknown session: ${sessionId}`));
	}
	const done = openDiskSession(sessionId, workspaceId, cwd, admissionEpoch).finally(() =>
		attaching.delete(sessionId),
	);
	attaching.set(sessionId, { workspaceId, cwd, done });
	return trackSessionPreparation(workspaceId, done);
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
	admissionEpoch: number,
): Promise<void> {
	assertSessionAdmission(workspaceId, admissionEpoch);
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
			[subagentsExtensionFor(workspaceId)],
		),
		...(exactModel ? { model: exactModel } : {}),
	});
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, workspaceId, generation, admissionEpoch);
}

async function ensureSessionAttachedInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
	admissionEpoch: number,
): Promise<boolean> {
	assertSessionAdmission(workspaceId, admissionEpoch);
	if (completedDeletionFor(sessionId, workspaceId)) return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	assertSessionAdmission(workspaceId, admissionEpoch);
	if (completedDeletionFor(sessionId, workspaceId)) return false;
	if (!known) return false;
	await attachDiskSession(sessionId, workspaceId, cwd, admissionEpoch);
	if (!sessions.has(sessionId))
		throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	return true;
}

export function ensureSessionAttached(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	const admissionEpoch = sessionAdmissionEpoch;
	assertSessionAdmission(workspaceId, admissionEpoch);
	return trackSessionPreparation(
		workspaceId,
		ensureSessionAttachedInternal(sessionId, workspaceId, cwd, admissionEpoch),
	);
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
	synchronizeQueuedLane(entry, "steering", entry.session.getSteeringMessages());
	synchronizeQueuedLane(entry, "followUp", entry.session.getFollowUpMessages());
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
		requestCompletionSweep(sessionId, entry);
	}
}

function queueStateOf(entry: Entry): SessionQueueState {
	synchronizeQueueFromSession(entry);
	return {
		steering: [...entry.session.getSteeringMessages()],
		followUp: [...entry.session.getFollowUpMessages()],
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
	return { removed, queue: queueStateOf(entry) };
}

export async function abortSession(
	sessionId: string,
	restoreQueue = false,
): Promise<SessionQueueContent | undefined> {
	const entry = mustGetEntry(sessionId);
	const restoredQueue = restoreQueue ? clearQueueSession(sessionId) : undefined;
	await entry.session.abort();
	return restoredQueue;
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
	const resolved = (pinned ?? available[0] ?? null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

export function liveParentSessionForDelegation(
	sessionId: string,
	workspaceId?: string,
): AgentSession | undefined {
	if (isSessionUnavailable(sessionId)) return undefined;
	const entry = sessions.get(sessionId);
	if (!entry || (workspaceId !== undefined && entry.workspaceId !== workspaceId)) return undefined;
	return entry.session;
}

export function liveParentContext(
	sessionId: string,
	workspaceId?: string,
): ParentContext | undefined {
	const session = liveParentSessionForDelegation(sessionId, workspaceId);
	if (!session) return undefined;
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

async function emitSessionShutdown(entry: Entry): Promise<void> {
	if (entry.shutdownEmitted) return;
	entry.shutdownEmitted = true;
	try {
		await entry.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	} catch {}
}

function disposeSession(sessionId: string, parentQuiesced = false): Promise<void> {
	const active = disposingSessions.get(sessionId);
	if (active) return active.done;
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	const releaseDelegation = parentQuiesced
		? () => {}
		: quiesceParentDelegation(entry.workspaceId, sessionId);
	const manager = entry.session.sessionManager;
	const cwd = manager.getCwd();
	const persisted = manager.isPersisted();
	const path = manager.getSessionFile();
	sessions.delete(sessionId);
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	log.debug(`session ${sessionId} disposed`);
	const done = trackCascade(
		entry.workspaceId,
		(async () => {
			try {
				await entry.resourceReload?.catch(() => {});
				await emitSessionShutdown(entry);
				try {
					entry.session.dispose();
				} catch {}
				await disposeSessionChildren(entry.workspaceId, sessionId).catch(() => {});
			} finally {
				releaseDelegation();
			}
		})(),
	);
	disposingSessions.set(sessionId, {
		workspaceId: entry.workspaceId,
		cwd,
		persisted,
		...(path ? { path } : {}),
		done,
	});
	void done.finally(() => disposingSessions.delete(sessionId)).catch(() => {});
	return done;
}

export function removeSession(sessionId: string): Promise<void> {
	if (isSessionUnavailable(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	return disposeSession(sessionId);
}

export function disposeAllSessions(): void {
	const entries = [...sessions];
	for (const [sessionId, entry] of entries) {
		quiesceParentDelegation(entry.workspaceId, sessionId);
	}
	for (const [sessionId] of entries) void disposeSession(sessionId, true);
	deletedSessions.clear();
}

export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	beginSessionShutdown();
	const entries = [...sessions];
	const settling = new Set<Promise<unknown>>();
	for (const [sessionId, entry] of entries) {
		quiesceParentDelegation(entry.workspaceId, sessionId);
	}
	for (const [sessionId, entry] of entries) {
		if (entry.resourceReload) settling.add(entry.resourceReload);
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
	for (const pending of sessionPreparations.values()) {
		for (const preparation of pending) settling.add(preparation);
	}
	if (settling.size === 0) return;
	await Promise.race([
		Promise.allSettled(settling),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

async function removeWorkspaceSessionsInternal(workspaceId: string, cwd?: string): Promise<void> {
	for (const [sessionId, entry] of sessions) {
		if (entry.workspaceId === workspaceId) quiesceParentDelegation(workspaceId, sessionId);
	}
	await Promise.all([...(sessionPreparations.get(workspaceId) ?? [])]);
	const entries = [...sessions].filter(([, entry]) => entry.workspaceId === workspaceId);
	for (const [sessionId] of entries) quiesceParentDelegation(workspaceId, sessionId);
	await Promise.all(
		entries.map(async ([sessionId, entry]) => {
			if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
			await disposeSession(sessionId);
		}),
	);
	while ((pendingCascades.get(workspaceId)?.size ?? 0) > 0) {
		await Promise.all([...(pendingCascades.get(workspaceId) ?? [])]);
	}
	removeWorkspaceDelegation(workspaceId);
	if (cwd) await purgeDiskSessions(cwd);
}

export function removeWorkspaceSessions(workspaceId: string, cwd?: string): Promise<void> {
	const active = workspaceTeardowns.get(workspaceId);
	if (active) return active;
	closingWorkspaces.add(workspaceId);
	const teardown = removeWorkspaceSessionsInternal(workspaceId, cwd).finally(() => {
		if (workspaceTeardowns.get(workspaceId) === teardown) {
			workspaceTeardowns.delete(workspaceId);
		}
	});
	workspaceTeardowns.set(workspaceId, teardown);
	return teardown;
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
	const deletedWorkspaceId = deletedSessions.get(sessionId);
	if (deletedWorkspaceId !== undefined) {
		return deletedWorkspaceId === workspaceId
			? Promise.resolve()
			: Promise.reject(new Error(`Unknown session: ${sessionId}`));
	}
	const disposal = disposingSessions.get(sessionId);
	if (disposal && (disposal.workspaceId !== workspaceId || disposal.cwd !== cwd)) {
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	}
	const attachment = attaching.get(sessionId);
	if (attachment && (attachment.workspaceId !== workspaceId || attachment.cwd !== cwd)) {
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	}
	const liveEntry = sessions.get(sessionId);
	if (liveEntry) {
		if (liveEntry.workspaceId !== workspaceId)
			return Promise.reject(new Error(`Unknown session: ${sessionId}`));
		const manager = liveEntry.session.sessionManager;
		if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
			return Promise.reject(new Error(`Session transcript scope mismatch: ${sessionId}`));
		}
	}

	const transaction = Promise.resolve().then(() =>
		runDeleteTransaction(sessionId, workspaceId, cwd, disposal),
	);
	const done = transaction.then(
		() => {
			deletingSessions.delete(sessionId);
		},
		(error: unknown) => {
			deletingSessions.delete(sessionId);
			const restoredEntry = sessions.get(sessionId);
			if (restoredEntry?.workspaceId === workspaceId) {
				void sweepUndeliveredCompletions(workspaceId, sessionId, restoredEntry.session).catch(
					() => {},
				);
			}
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
	disposal?: DisposalFlight,
): Promise<void> {
	let installedTombstone = false;
	let releaseDelegation = () => {};
	let liveEntry: Entry | undefined;
	try {
		releaseDelegation = quiesceParentDelegation(workspaceId, sessionId);
		await attaching.get(sessionId)?.done.catch(() => {});
		await disposal?.done.catch(() => {});
		const entry = sessions.get(sessionId);
		if (entry && entry.workspaceId !== workspaceId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		let path: string | undefined;
		if (entry) {
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			liveEntry = entry;
			if (entry.resourceReload) await entry.resourceReload.catch(() => {});
			if (entry.session.isStreaming) await entry.session.abort();
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
		} else if (disposal) {
			if (disposal.persisted && !disposal.path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
			path = disposal.path;
		} else {
			const info = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			);
			if (!info) throw new Error(`Unknown session: ${sessionId}`);
			path = info.path;
		}
		const deletedWorkspaceId = deletedSessions.get(sessionId);
		if (deletedWorkspaceId !== undefined && deletedWorkspaceId !== workspaceId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		if (deletedWorkspaceId === undefined) {
			deletedSessions.set(sessionId, workspaceId);
			installedTombstone = true;
		}
		if (path && existsSync(path)) await trashFile(path);
	} catch (error) {
		if (installedTombstone) deletedSessions.delete(sessionId);
		releaseDelegation();
		throw error;
	}
	try {
		if (liveEntry && sessions.get(sessionId) === liveEntry) {
			await emitSessionShutdown(liveEntry);
			await disposeSession(sessionId);
		}
		await disposingSessions.get(sessionId)?.done.catch(() => {});
		publishDeleted({ workspaceId, sessionId });
	} finally {
		releaseDelegation();
	}
}
