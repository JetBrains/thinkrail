import {
	type AgentSession,
	createAgentSession,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
	ImageContent,
	Model,
	PiEvent,
	SessionEventPayload,
	SessionStats,
	SlashCommandInfo,
	ThinkingLevel,
} from "@thinkrail-pi/contracts";
import { getPiRuntime } from "./piRuntime";
import { cancelExtUiForSession, createWebUiContext, notifyExtUi } from "./webUiContext";

interface Entry {
	session: AgentSession;
	unsubscribe: () => void;
}

const sessions = new Map<string, Entry>();

// `SessionEventPayload` is a wire type — it lives in `@thinkrail-pi/contracts`; re-exported so the
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

export interface CreateSessionInput {
	/** The active workspace's worktree — a chat session belongs to a workspace. */
	cwd: string;
	model?: Model<string>;
	thinkingLevel?: ThinkingLevel;
}

/** The resolved session + the model/thinking it starts with (pi picks defaults from auth + settings). */
export interface CreateSessionResult {
	sessionId: string;
	model: Model<string> | null;
	thinkingLevel: ThinkingLevel;
}

/** Create an in-process AgentSession rooted in `cwd`; its events stream out tagged with the session id. */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const { authStorage, modelRegistry } = getPiRuntime();
	const { session } = await createAgentSession({
		cwd: input.cwd,
		authStorage,
		modelRegistry,
		sessionManager: sessionManagerFactory(input.cwd),
		...(input.model ? { model: input.model } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	const { sessionId } = session;
	const unsubscribe = session.subscribe((event) => publish({ sessionId, event: event as PiEvent }));
	// `rpc` mode = dialog-capable, non-TUI: extension `uiContext` dialogs bridge to the browser over WS.
	await session.bindExtensions({
		mode: "rpc",
		uiContext: createWebUiContext(sessionId),
		onError: (error) => notifyExtUi(sessionId, `Extension error: ${error.error}`, "error"),
	});
	sessions.set(sessionId, { session, unsubscribe });
	return {
		sessionId,
		model: (session.model ?? null) as Model<string> | null,
		thinkingLevel: session.thinkingLevel,
	};
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

export async function setSessionModel(sessionId: string, model: Model<string>): Promise<void> {
	await mustGet(sessionId).setModel(model);
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
// uses. In sync with @earendil-works/pi-coding-agent@0.80.2 (modes/rpc get_commands).
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

/** Models with configured auth, for the model picker (cheap win #1). */
export function listAvailableModels(): Model<string>[] {
	// `getAvailable()` is `Model<Api>[]`; the wire uses the looser `Model<string>` (the picker reads id/name/provider).
	return getPiRuntime().modelRegistry.getAvailable() as unknown as Model<string>[];
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
