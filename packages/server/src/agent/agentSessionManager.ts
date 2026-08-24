import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
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
	RefreshedModels,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@thinkrail/contracts";
import { isTranscriptMessageRole } from "@thinkrail/contracts";
import { ANSWERABILITY_ERRORS, assessAnswerability, buildAnswersMessage } from "./askUserQuestion";
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
import { cancelExtUiForSession, createWebUiContext, notifyExtUi } from "./webUiContext";

interface Entry {
	session: AgentSession;
	generation: PiRuntimeGeneration;
	unsubscribe: () => void;
	workspaceId: string;
	lastSettlement: AgentSettlement | null | undefined;
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

function isSessionDeleted(sessionId: string, workspaceId: string): boolean {
	return deletedSessions.get(sessionId) === workspaceId;
}

export type { SessionEventPayload };

let publish: (payload: SessionEventPayload) => void = () => {};
export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publish = fn;
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
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: AgentSettlement | null = null;
	const entry: Entry = {
		session,
		generation,
		unsubscribe: () => {},
		workspaceId,
		lastSettlement,
	};
	entry.unsubscribe = session.subscribe((event) => {
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
		const projected = projectSessionEvent(event, terminal);
		if (event.type === "agent_settled") entry.lastSettlement = terminal;
		if (sessions.get(sessionId) === entry) publish({ sessionId, event: projected });
		if (event.type === "agent_settled") terminal = null;
	});

	try {
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: () => notifyExtUi(sessionId, "An extension failed.", "error"),
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
): Promise<CreateSessionResult> {
	const prepared = await prepareSessionEntry(session, workspaceId, generation);
	sessions.set(session.sessionId, prepared.entry);
	return prepared.result;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(input.cwd);
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
		),
		...(input.model ? { model: resolveWireModel(generation.runtime, input.model) } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.workspaceId, generation);
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

const attaching = new Map<string, Promise<void>>();

function attachDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, workspaceId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		pending = openDiskSession(sessionId, workspaceId, cwd).finally(() =>
			attaching.delete(sessionId),
		);
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
		),
		...(exactModel ? { model: exactModel } : {}),
	});
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, workspaceId, generation);
}

async function ensureSessionAttachedInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	if (isSessionDeleted(sessionId, workspaceId)) return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!known) return false;
	await attachDiskSession(sessionId, workspaceId, cwd);
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

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.steer(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	return mustGet(sessionId).steer(text, images);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.followUp(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	await mustGet(sessionId).compact(instructions);
}

export function abortSession(sessionId: string): Promise<void> {
	return mustGet(sessionId).abort();
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

function disposeSession(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
}

export function removeSession(sessionId: string): void {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	disposeSession(sessionId);
}

export function disposeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
	deletedSessions.clear();
}

export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const streaming = [...sessions.values()].filter((entry) => entry.session.isStreaming);
	if (streaming.length === 0) return;
	await Promise.race([
		Promise.allSettled(streaming.map((entry) => entry.session.abort())),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

async function removeWorkspaceSessionsInternal(workspaceId: string, cwd?: string): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.workspaceId === workspaceId)
		.map(([sessionId]) => sessionId);
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		disposeSession(sessionId);
	}
	if (cwd) await purgeDiskSessions(cwd);
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
		} else {
			path = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			)?.path;
		}
		if (path && existsSync(path)) await trashFile(path);
	} catch (error) {
		if (installedTombstone) deletedSessions.delete(sessionId);
		throw error;
	}
	if (liveEntry && sessions.get(sessionId) === liveEntry) disposeSession(sessionId);
	publishDeleted({ workspaceId, sessionId });
}
