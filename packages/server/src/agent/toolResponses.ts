import { isDeepStrictEqual } from "node:util";
import type { AgentMessage, ToolResponseMessage } from "@thinkrail/contracts";
import {
	assistantToolCallsAreExecutable,
	isToolResponsePending,
	readToolResponseMessage,
	TOOL_RESPONSE_CUSTOM_TYPE,
} from "@thinkrail/contracts";
import type { ExtensionSessionServices, InteractiveTools } from "../extensions";

export const TOOL_RESPONSE_PENDING_TEXT =
	"This call is now waiting for the user's response. This turn ends here; the response (or the user's own free-form reply) will arrive as the next user message. Do not assume one until it arrives.";
export const TOOL_RESPONSE_STOPPED_ERROR = "Cancelled because the run was stopped";

interface ToolCallView {
	type: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}
interface MessageView {
	role?: string;
	content?: unknown;
	details?: unknown;
	toolCallId?: string;
	stopReason?: string;
}

function toolCallsOf(message: MessageView): ToolCallView[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return (message.content as ToolCallView[]).filter((b) => b?.type === "toolCall");
}

export type Respondability =
	| { ok: true; toolName: string; args: unknown }
	| { ok: false; reason: "unknown_call" | "already_responded" | "not_awaiting" | "superseded" };

export function assessRespondability(
	messages: readonly AgentMessage[],
	toolCallId: string,
	interactive: InteractiveTools,
): Respondability {
	const views = messages as readonly MessageView[];
	let callIndex = -1;
	let callDead = false;
	let call: ToolCallView | null = null;
	for (let i = 0; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		for (const block of toolCallsOf(view)) {
			if (block.id === toolCallId && block.name !== undefined && interactive.has(block.name)) {
				callIndex = i;
				callDead = !assistantToolCallsAreExecutable(view.stopReason);
				call = block;
			}
		}
	}
	if (callIndex < 0 || !call?.name) return { ok: false, reason: "unknown_call" };
	if (callDead) return { ok: false, reason: "not_awaiting" };

	for (let i = callIndex + 1; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		if (readToolResponseMessage(view)?.toolCallId === toolCallId)
			return { ok: false, reason: "already_responded" };
		if (
			view.role === "toolResult" &&
			view.toolCallId === toolCallId &&
			!isToolResponsePending(view.details)
		)
			return { ok: false, reason: "not_awaiting" };
		if (view.role === "user") return { ok: false, reason: "superseded" };
	}
	return { ok: true, toolName: call.name, args: call.arguments };
}

export function hasPendingToolResult(
	messages: readonly AgentMessage[],
	toolCallId: string,
): boolean {
	return (messages as readonly MessageView[]).some(
		(message) =>
			message.role === "toolResult" &&
			message.toolCallId === toolCallId &&
			isToolResponsePending(message.details),
	);
}

export function awaitingToolCallId(
	messages: readonly AgentMessage[],
	interactive: InteractiveTools,
	pendingOnly = false,
): string | null {
	const views = messages as readonly MessageView[];
	for (let i = views.length - 1; i >= 0; i--) {
		const view = views[i];
		if (!view) continue;
		if (view.role === "user") return null;
		for (const block of toolCallsOf(view)) {
			const { id } = block;
			if (id === undefined || block.name === undefined || !interactive.has(block.name)) continue;
			if (!assessRespondability(messages, id, interactive).ok) continue;
			if (!pendingOnly || hasPendingToolResult(messages, id)) return id;
		}
	}
	return null;
}

export const RESPONDABILITY_ERRORS: Record<
	Extract<Respondability, { ok: false }>["reason"],
	string
> = {
	unknown_call: "Unknown tool call awaiting a response",
	already_responded: "This tool call was already responded to",
	not_awaiting: "This tool call is not awaiting a response",
	superseded: "This tool call was superseded by a later message",
};

export function describeToolResponse(
	toolName: string,
	args: unknown,
	response: unknown,
	interactive: InteractiveTools,
): string {
	const described = interactive.get(toolName)?.describeResponse?.(args, response);
	return (
		described ??
		`The user responded to the ${toolName} call that was waiting for them:\n${JSON.stringify(response, null, 2)}`
	);
}

export function buildToolResponseMessage(
	content: string,
	toolCallId: string,
	response: unknown,
): Pick<ToolResponseMessage, "customType" | "content" | "display" | "details"> {
	return {
		customType: TOOL_RESPONSE_CUSTOM_TYPE,
		content,
		display: true,
		details: { toolCallId, response },
	};
}

export type ToolResponseWaitOutcome =
	| { kind: "response"; value: unknown }
	| { kind: "superseded" }
	| { kind: "abandoned" };

type WaiterPhase =
	| "expected"
	| "waiting"
	| "response-accepted-uncommitted"
	| "superseded"
	| "stopped";

interface Waiter {
	phase: WaiterPhase;
	executeStarted: boolean;
	acceptedResponse: unknown;
	responsePromise: Promise<ToolResponseWaitOutcome>;
	resolveResponse: (outcome: ToolResponseWaitOutcome) => void;
	rejectResponse: (error: Error) => void;
	persisted: Promise<void>;
	resolvePersisted: () => void;
	rejectPersisted: (error: Error) => void;
	cleanupAbort: () => void;
}

const UNSET = Symbol("unset");

function createWaiter(): Waiter {
	let resolveResponse: (outcome: ToolResponseWaitOutcome) => void = () => {};
	let rejectResponse: (error: Error) => void = () => {};
	const responsePromise = new Promise<ToolResponseWaitOutcome>((resolve, reject) => {
		resolveResponse = resolve;
		rejectResponse = reject;
	});
	let resolvePersisted: () => void = () => {};
	let rejectPersisted: (error: Error) => void = () => {};
	const persisted = new Promise<void>((resolve, reject) => {
		resolvePersisted = resolve;
		rejectPersisted = reject;
	});
	return {
		phase: "expected",
		executeStarted: false,
		acceptedResponse: UNSET,
		responsePromise,
		resolveResponse,
		rejectResponse,
		persisted,
		resolvePersisted,
		rejectPersisted,
		cleanupAbort: () => {},
	};
}

export interface ToolResponseWaiters {
	expect(toolCallId: string): void;
	wait(toolCallId: string, signal: AbortSignal | undefined): Promise<ToolResponseWaitOutcome>;
	respond(
		toolCallId: string,
		response: unknown,
	): { handled: false } | { handled: true; persisted: Promise<void> };
	persistTurn(
		toolResults: readonly {
			toolCallId: string;
			details?: unknown;
			isError?: boolean;
		}[],
	): void;
	supersede(): boolean;
	currentInteraction(): { toolCallId: string; needsInput: boolean } | null;
	hasRecoverableCall(): boolean;
	prepareShutdown(): Promise<void> | null;
	prepareAbort(): Promise<void> | null;
	abandon(): void;
}

export function createToolResponseWaiters(): ToolResponseWaiters {
	const waiting = new Map<string, Waiter>();
	let shutdownPrepared = false;
	const waiterFor = (toolCallId: string): Waiter => {
		let waiter = waiting.get(toolCallId);
		if (!waiter) {
			waiter = createWaiter();
			waiting.set(toolCallId, waiter);
		}
		return waiter;
	};
	const notAwaiting = (toolCallId: string): Error =>
		new Error(`${RESPONDABILITY_ERRORS.not_awaiting}: ${toolCallId}`);
	const responseNotPersisted = (toolCallId: string): Error =>
		new Error(`The accepted response of this tool call was not persisted: ${toolCallId}`);
	const acceptedResponsePersistence = (): Promise<void> | null => {
		const accepted = [...waiting.values()]
			.filter((waiter) => waiter.phase === "response-accepted-uncommitted")
			.map((waiter) => waiter.persisted);
		return accepted.length > 0 ? Promise.all(accepted).then(() => {}) : null;
	};
	return {
		expect(toolCallId) {
			waiterFor(toolCallId);
		},
		wait(toolCallId, signal) {
			const waiter = waiterFor(toolCallId);
			if (waiter.executeStarted) {
				return Promise.reject(new Error(`Duplicate interactive tool call: ${toolCallId}`));
			}
			waiter.executeStarted = true;
			if (waiter.phase === "response-accepted-uncommitted") return waiter.responsePromise;
			if (waiter.phase === "superseded") return Promise.resolve({ kind: "superseded" });
			if (waiter.phase === "stopped") return Promise.reject(new Error(TOOL_RESPONSE_STOPPED_ERROR));
			waiter.phase = "waiting";
			if (signal?.aborted) {
				waiter.phase = "stopped";
				waiter.rejectResponse(new Error(TOOL_RESPONSE_STOPPED_ERROR));
				return waiter.responsePromise;
			}
			const abort = (): void => {
				if (waiting.get(toolCallId) !== waiter || waiter.phase !== "waiting") return;
				waiter.phase = "stopped";
				waiter.rejectResponse(new Error(TOOL_RESPONSE_STOPPED_ERROR));
			};
			signal?.addEventListener("abort", abort, { once: true });
			waiter.cleanupAbort = () => signal?.removeEventListener("abort", abort);
			return waiter.responsePromise;
		},
		respond(toolCallId, response) {
			if (shutdownPrepared) throw notAwaiting(toolCallId);
			const waiter = waiting.get(toolCallId);
			if (!waiter) return { handled: false };
			if (waiter.phase === "stopped") throw notAwaiting(toolCallId);
			if (waiter.phase === "superseded") {
				throw new Error(`${RESPONDABILITY_ERRORS.superseded}: ${toolCallId}`);
			}
			if (waiter.phase === "response-accepted-uncommitted") {
				throw new Error(`${RESPONDABILITY_ERRORS.already_responded}: ${toolCallId}`);
			}
			waiter.phase = "response-accepted-uncommitted";
			waiter.acceptedResponse = structuredClone(response);
			waiter.resolveResponse({ kind: "response", value: response });
			return { handled: true, persisted: waiter.persisted };
		},
		persistTurn(toolResults) {
			for (const result of toolResults) {
				const waiter = waiting.get(result.toolCallId);
				if (!waiter) continue;
				waiting.delete(result.toolCallId);
				waiter.cleanupAbort();
				if (waiter.phase !== "response-accepted-uncommitted") continue;
				if (
					waiter.executeStarted &&
					waiter.acceptedResponse !== UNSET &&
					result.isError !== true &&
					isDeepStrictEqual(result.details, waiter.acceptedResponse)
				) {
					waiter.resolvePersisted();
				} else {
					waiter.rejectPersisted(responseNotPersisted(result.toolCallId));
				}
			}
			for (const [toolCallId, waiter] of waiting) {
				waiting.delete(toolCallId);
				waiter.cleanupAbort();
				if (waiter.phase === "waiting") waiter.rejectResponse(notAwaiting(toolCallId));
				if (waiter.phase === "response-accepted-uncommitted") {
					waiter.rejectPersisted(responseNotPersisted(toolCallId));
				}
			}
		},
		supersede() {
			let superseded = false;
			for (const waiter of waiting.values()) {
				if (waiter.phase !== "expected" && waiter.phase !== "waiting") continue;
				if (waiter.phase === "waiting") waiter.resolveResponse({ kind: "superseded" });
				waiter.phase = "superseded";
				superseded = true;
			}
			return superseded;
		},
		currentInteraction() {
			for (const [toolCallId, waiter] of waiting) {
				return {
					toolCallId,
					needsInput: waiter.phase === "expected" || waiter.phase === "waiting",
				};
			}
			return null;
		},
		hasRecoverableCall() {
			return [...waiting.values()].some(
				(waiter) => waiter.phase !== "stopped" && waiter.phase !== "superseded",
			);
		},
		prepareShutdown() {
			shutdownPrepared = true;
			return acceptedResponsePersistence();
		},
		prepareAbort() {
			const accepted: Promise<void>[] = [];
			for (const waiter of waiting.values()) {
				if (waiter.phase === "response-accepted-uncommitted") {
					accepted.push(waiter.persisted);
					continue;
				}
				if (waiter.phase === "waiting")
					waiter.rejectResponse(new Error(TOOL_RESPONSE_STOPPED_ERROR));
				if (waiter.phase === "expected" || waiter.phase === "waiting") {
					waiter.phase = "stopped";
				}
			}
			return accepted.length > 0 ? Promise.all(accepted).then(() => {}) : null;
		},
		abandon() {
			const error = new Error("Session disposed while waiting for a tool response");
			for (const waiter of waiting.values()) {
				waiter.cleanupAbort();
				if (waiter.phase === "waiting") waiter.resolveResponse({ kind: "abandoned" });
				if (waiter.phase === "response-accepted-uncommitted") waiter.rejectPersisted(error);
			}
			waiting.clear();
		},
	};
}

export function toolResponseSessionServices(
	waiters: ToolResponseWaiters,
): ExtensionSessionServices {
	return {
		expectToolResponse: (toolCallId) => waiters.expect(toolCallId),
		awaitToolResponse: async (toolCallId, signal) => {
			const outcome = await waiters.wait(toolCallId, signal);
			return outcome.kind === "superseded" ? { kind: "deferred" } : outcome;
		},
	};
}
