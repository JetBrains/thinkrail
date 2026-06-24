import {
	type AgentSession,
	createAgentSession,
	SessionManager,
	type SessionStats,
} from "@earendil-works/pi-coding-agent";
import type { Model, PiEvent, ThinkingLevel } from "@thinkrail-pi/contracts";
import { getPiRuntime } from "./piRuntime";

interface Entry {
	session: AgentSession;
	unsubscribe: () => void;
}

const sessions = new Map<string, Entry>();

/** Each session's events, tagged with its id, for the WS `pi.event` channel (wired at M11). */
export interface SessionEventPayload {
	sessionId: string;
	event: PiEvent;
}

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

/** Create an in-process AgentSession rooted in `cwd`; its events stream out tagged with the session id. */
export async function createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
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
	sessions.set(sessionId, { session, unsubscribe });
	return { sessionId };
}

/** Send a turn. `prompt()` throws while streaming, so fall back to `steer()` then. */
export async function promptSession(sessionId: string, text: string): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.steer(text);
		return;
	}
	await session.prompt(text);
}

export async function steerSession(sessionId: string, text: string): Promise<void> {
	await mustGet(sessionId).steer(text);
}

export async function followUpSession(sessionId: string, text: string): Promise<void> {
	await mustGet(sessionId).followUp(text);
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

export function getSessionStats(sessionId: string): SessionStats {
	return mustGet(sessionId).getSessionStats();
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

/** Remove one session: stop forwarding its events and dispose it. */
export function removeSession(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
}

/** Dispose every session — called on host shutdown. */
export function disposeAllSessions(): void {
	for (const entry of sessions.values()) {
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
}
