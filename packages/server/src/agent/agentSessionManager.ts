import { rmSync } from "node:fs";
import {
	type AgentSession,
	createAgentSession,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AskUserQuestionResult,
	ImageContent,
	Model,
	PiEvent,
	SessionEventPayload,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@thinkrail/contracts";
import { ANSWERABILITY_ERRORS, assessAnswerability, buildAnswersMessage } from "./askUserQuestion";
import { buildResourceLoader } from "./extensions";
import { getPiRuntime } from "./piRuntime";
import { repairDanglingToolCalls } from "./sessionRepair";
import { cancelExtUiForSession, createWebUiContext, notifyExtUi } from "./webUiContext";

interface Entry {
	session: AgentSession;
	unsubscribe: () => void;
	/** The workspace this session belongs to — so `listSessions` can report a workspace's sessions. */
	workspaceId: string;
}

const sessions = new Map<string, Entry>();

// `SessionEventPayload` is a wire type — it lives in `@thinkrail/contracts`; re-exported so the
// `../agent` barrel keeps exposing it.
export type { SessionEventPayload };

let publish: (payload: SessionEventPayload) => void = () => {};
export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publish = fn;
}

// Per-session persistence. Overridable so tests can use `SessionManager.inMemory()` (no disk).
let sessionManagerFactory: (cwd: string) => SessionManager = (cwd) => SessionManager.create(cwd);
export function setSessionManagerFactory(factory: (cwd: string) => SessionManager): void {
	sessionManagerFactory = factory;
}

function mustGet(sessionId: string): AgentSession {
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry.session;
}

/** Whether a session is live in this manager — the wire's cheap liveness guard for reply-style methods. */
export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId);
}

/** The workspace a live session belongs to — the host's session→workspace lookup (e.g. auto-rename). */
export function getSessionWorkspaceId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.workspaceId;
}

/**
 * The pi settings a session runs with: the user's real settings **plus** an in-memory override turning
 * `images.autoResize` **off** (never persisted — `applyOverrides`, not `set…`+`save`). With it off, the
 * `read` tool sends image files to the model **raw** instead of routing them through pi's photon
 * (Rust→WASM) resizer. That's deliberate: the resizer can't be bundled into our single-file binary (its
 * wasm loads via a worker + `fs` path that a compiled binary can't satisfy), and the web UI downsizes
 * user-attached images itself — so we keep image-read working everywhere without depending on photon.
 * `SettingsManager.create(cwd)` defaults its agentDir to `getAgentDir()` (honors `PI_CODING_AGENT_DIR`),
 * matching the manager `createAgentSession` builds when we omit `settingsManager`.
 */
export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd);
	settings.applyOverrides({ images: { autoResize: false } });
	return settings;
}

export interface CreateSessionInput {
	/** The active workspace's worktree — a chat session belongs to a workspace. */
	cwd: string;
	/** The workspace id, kept alongside the session so it can be listed back per workspace. */
	workspaceId: string;
	/** A wire model reference (`{provider,id}` + display metadata, no `baseUrl`) — re-resolved host-side. */
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
}

/** The resolved session + the model/thinking it starts with (pi picks defaults from auth + settings). */
export interface CreateSessionResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

/**
 * Project a `pi` `Model` down to the wire's **allowlist** (`WireModel`) — exactly the fields the UI renders.
 * An explicit projection (not a `{...rest}` denylist), so `baseUrl` (the jbcentral proxy secret when wired)
 * and `headers` (can carry auth) — and any future `Model` field — are excluded by default. The UI refers a
 * model back by `{provider,id}`, which the host re-resolves via `resolveWireModel`. This is the single choke
 * point that keeps secrets off every model-bearing wire frame (model.list/default, session.create result,
 * SessionSummary).
 */
export function toWireModel(model: Model<string>): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
	};
}

/**
 * Re-resolve a wire model reference back to the real `Model` (with its `baseUrl`) from the registry, matching
 * the picker's universe (`getAvailable()`). **Never trust a client-supplied `baseUrl`** — pi's `setModel` /
 * `createAgentSession` use it verbatim, so accepting it would let a client (esp. a remote V2 one) point the
 * agent's model traffic at an arbitrary URL. Throws if the ref isn't an available model.
 */
function resolveWireModel(ref: Pick<WireModel, "provider" | "id">): Model<string> {
	const match = getPiRuntime()
		.modelRegistry.getAvailable()
		.find((m) => m.provider === ref.provider && m.id === ref.id);
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

/** Wire a freshly-created/opened session into the manager: forward its events + bind the extension-UI bridge. */
async function registerSession(
	session: AgentSession,
	workspaceId: string,
): Promise<CreateSessionResult> {
	const { sessionId } = session;
	const unsubscribe = session.subscribe((event) => publish({ sessionId, event: event as PiEvent }));
	// `rpc` mode = dialog-capable, non-TUI: extension `uiContext` dialogs bridge to the browser over WS.
	await session.bindExtensions({
		mode: "rpc",
		uiContext: createWebUiContext(sessionId),
		onError: (error) => notifyExtUi(sessionId, `Extension error: ${error.error}`, "error"),
	});
	sessions.set(sessionId, { session, unsubscribe, workspaceId });
	return {
		sessionId,
		model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
	};
}

/** Create an in-process AgentSession rooted in `cwd`; its events stream out tagged with the session id. */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const { authStorage, modelRegistry } = getPiRuntime();
	const settingsManager = buildSessionSettings(input.cwd);
	const { session } = await createAgentSession({
		cwd: input.cwd,
		authStorage,
		modelRegistry,
		sessionManager: sessionManagerFactory(input.cwd),
		settingsManager,
		resourceLoader: await buildResourceLoader(input.cwd, settingsManager),
		// Re-resolve the wire ref to the real model (with baseUrl) host-side — never the client's baseUrl.
		...(input.model ? { model: resolveWireModel(input.model) } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.workspaceId);
}

/** A live session's summary (drawn from the running `AgentSession`). */
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
	};
}

/**
 * A workspace's chat sessions — live (in-memory) unioned with on-disk ones pi persisted under `cwd`. Live
 * wins on id. This is the domain state a reconnecting/second client hydrates from; the disk half is what
 * survives a host restart.
 */
export async function listSessions(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	const live: SessionSummary[] = [];
	const liveIds = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (entry.workspaceId !== workspaceId) continue;
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
	}
	let disk: SessionSummary[] = [];
	try {
		const infos = await SessionManager.list(cwd);
		// `list(cwd)` reads one encoded-cwd dir, but pi's encoding (`[/\:]`→`-`) can map distinct cwds to the
		// same dir, so match on the session's true recorded `cwd` to disambiguate; live ones are already above.
		disk = infos
			.filter((info) => info.cwd === cwd && !liveIds.has(info.id))
			.map((info) => ({
				sessionId: info.id,
				workspaceId,
				title: info.name ?? "Chat",
				// Placeholders until the session is opened (disk metadata doesn't carry model/thinking).
				model: null,
				thinkingLevel: "medium" as ThinkingLevel,
				isStreaming: false,
				messageCount: info.messageCount,
				updatedAt: info.modified.getTime(),
				live: false,
			}));
	} catch {
		// No sessions dir for this cwd yet — only the live ones.
	}
	return [...live, ...disk];
}

// In-flight disk re-opens, deduped by session id: concurrent `getSessionMessages` for the same disk session
// (two tabs / a fast double-click) must attach it exactly once — a second `AgentSession` on the same id
// would orphan the first (leaked subscription/handles) and have two writers appending one transcript file.
const attaching = new Map<string, Promise<void>>();

/** Re-open a persisted session from disk into the manager (restart survival), keyed by its stable id. */
function attachDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
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

async function openDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	const info = (await SessionManager.list(cwd)).find((i) => i.id === sessionId && i.cwd === cwd);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return; // attached while we listed
	const { authStorage, modelRegistry } = getPiRuntime();
	const settingsManager = buildSessionSettings(cwd);
	const sessionManager = SessionManager.open(info.path);
	// Restart safety net: pair any tool call the last run left dangling (host died mid-tool) with a
	// synthetic result BEFORE the session seeds its context — providers reject unpaired tool calls, and
	// appending behind a live session would desync its in-memory state. See `sessionRepair`.
	repairDanglingToolCalls(sessionManager);
	const { session } = await createAgentSession({
		cwd,
		authStorage,
		modelRegistry,
		sessionManager,
		settingsManager,
		resourceLoader: await buildResourceLoader(cwd, settingsManager),
	});
	// Lost a race after the open — drop this duplicate rather than clobber the registered one.
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, workspaceId);
}

/**
 * A session's transcript (pi-canonical user/assistant/toolResult messages) + its current summary. Re-opens
 * the session from disk first if it isn't live, so a reopened chat is continuable and its summary accurate.
 */
export async function getSessionMessages(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	let entry = sessions.get(sessionId);
	// Scope the read to the requested workspace — a client can't pull a session from a different one.
	if (entry && entry.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, workspaceId, cwd);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	// `custom` rides along for the ask-user-answers pairing (the card reads `details.toolCallId`); the
	// web renders only the customTypes it knows and ignores the rest.
	const renderable = new Set(["user", "assistant", "toolResult", "custom"]);
	const messages = entry.session.messages.filter((m) =>
		renderable.has(m.role),
	) as TranscriptMessage[];
	return { summary: summaryOf(sessionId, entry), messages };
}

/**
 * Deliver the browser's `ask_user_question` reply: vet it against the transcript (pure
 * `assessAnswerability` — unknown/answered/superseded calls fail loud instead of parking an answer),
 * then send the `ask-user-answers` custom message. `sendCustomMessage` starts a new turn when the
 * session is idle (the normal ack+terminate case — also right after a restart re-open) and steers the
 * current one when it is streaming (a fast submit while the ask turn is still winding down), so
 * answering live and answering after a restart are the same code path. Resolves at turn end — the WS
 * handler acks acceptance via `ackSend`, mirroring prompt/steer/followUp.
 */
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

/** Send a turn. `prompt()` throws while streaming, so fall back to `steer()` then. */
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

export async function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	await mustGet(sessionId).steer(text, images);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	await mustGet(sessionId).followUp(text, images);
}

/** Trigger compaction (fire-and-forget — progress/result arrive as `compaction_*` events). */
export function compactSession(sessionId: string, instructions?: string): void {
	void mustGet(sessionId)
		.compact(instructions)
		.catch(() => {});
}

export async function abortSession(sessionId: string): Promise<void> {
	await mustGet(sessionId).abort();
}

export async function setSessionModel(sessionId: string, model: WireModel): Promise<void> {
	// Re-resolve the wire ref to the real model host-side (pi's setModel uses baseUrl verbatim).
	await mustGet(sessionId).setModel(resolveWireModel(model));
}

export function setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
	mustGet(sessionId).setThinkingLevel(level);
}

/** Token/cost stats for the session (display only — `pi` owns the numbers). */
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

// Slash commands / skills available in the session — built from the same three sources pi's own rpc mode
// uses. In sync with @earendil-works/pi-coding-agent@0.80.3 (modes/rpc get_commands).
export function getSessionCommands(sessionId: string): SlashCommandInfo[] {
	const session = mustGet(sessionId);
	const extension = session.extensionRunner.getRegisteredCommands().map((c) => ({
		name: c.invocationName,
		source: "extension" as const,
		sourceInfo: c.sourceInfo,
		...(c.description !== undefined ? { description: c.description } : {}),
	}));
	const prompt = session.promptTemplates.map((t) => ({
		name: t.name,
		description: t.description,
		source: "prompt" as const,
		sourceInfo: t.sourceInfo,
	}));
	const skill = session.resourceLoader.getSkills().skills.map((k) => ({
		name: `skill:${k.name}`,
		description: k.description,
		source: "skill" as const,
		sourceInfo: k.sourceInfo,
	}));
	return [...extension, ...prompt, ...skill];
}

/** Models with configured auth, for the model picker (cheap win #1). Redacted to `WireModel` — the raw
 * `Model.baseUrl` carries the jbcentral proxy secret when wired, and the picker only reads id/name/provider. */
export function listAvailableModels(): WireModel[] {
	return getPiRuntime()
		.modelRegistry.getAvailable()
		.map((m) => toWireModel(m as unknown as Model<string>));
}

/** The model + thinking level a new session resolves to (settings default if available, else first available). */
export interface DefaultModelResult {
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

/**
 * The default the *next* session would start with — so the New-Workspace dialog can show the exact model
 * pre-session (not a "Default" placeholder). Mirrors pi's resolution for a fresh session: the settings
 * default (if it's available), else the first available model. Passing it back to `session.create` is a
 * no-op vs. omitting it, so an `@agent` test that doesn't touch the picker still lands on the pinned model.
 */
export function getDefaultModel(): DefaultModelResult {
	const { modelRegistry } = getPiRuntime();
	const available = modelRegistry.getAvailable();
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((m) => m.provider === provider && m.id === modelId)
			: undefined;
	const resolved = (pinned ?? available[0] ?? null) as Model<string> | null;
	const thinkingLevel = settings.getDefaultThinkingLevel() ?? "medium";
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

/** Remove one session: stop forwarding its events, settle any open dialog, and dispose it. */
export function removeSession(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
}

/** Dispose every session — called on host shutdown. */
export function disposeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
}

/**
 * The polite half of shutdown: abort every streaming session and give pi a bounded window to settle —
 * pi's abort path writes "Operation aborted" tool results through the normal loop, so transcripts land
 * on disk already paired (no repair needed on the next boot). Bounded because shutdown must not hang on
 * a wedged provider: whatever doesn't settle inside `timeoutMs` is left to the restart repair
 * (`sessionRepair`). Callers dispose afterwards (`disposeAllSessions` via `server.stop()`).
 */
export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const streaming = [...sessions.values()].filter((entry) => entry.session.isStreaming);
	if (streaming.length === 0) return;
	await Promise.race([
		Promise.allSettled(streaming.map((entry) => entry.session.abort())),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

/**
 * Tear down a workspace's chat sessions when it's **archived**: abort any in-flight turn, then
 * `removeSession` (unsubscribe + settle dialogs + dispose) every live session for the workspace, then
 * delete pi's on-disk transcripts rooted at the worktree `cwd`. The host calls this before removing the
 * worktree so no session — in memory or on disk — outlives it. `cwd` is optional: on a double-archive the
 * record is already gone, so we still reap any lingering live sessions and just skip the disk purge.
 */
export async function removeWorkspaceSessions(workspaceId: string, cwd?: string): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.workspaceId === workspaceId)
		.map(([sessionId]) => sessionId);
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		// Abort a streaming turn before disposing — a mid-stream dispose drops it less cleanly.
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		removeSession(sessionId);
	}
	if (cwd) await purgeDiskSessions(cwd);
}

/**
 * Delete pi's persisted session files for a worktree `cwd`. Mirrors `listSessions`' disambiguation: pi's
 * cwd→dir encoding can alias distinct cwds to one dir, so delete only the files whose recorded `cwd` is
 * exactly this one — never `rm -rf` the encoded dir.
 */
async function purgeDiskSessions(cwd: string): Promise<void> {
	let infos: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		infos = await SessionManager.list(cwd);
	} catch {
		return; // no sessions dir for this cwd yet
	}
	for (const info of infos) {
		if (info.cwd === cwd) rmSync(info.path, { force: true });
	}
}
