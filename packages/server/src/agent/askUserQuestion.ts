import { isDeepStrictEqual } from "node:util";
import type {
	AgentMessage,
	AskUserAnswersMessage,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import {
	ASK_USER_ANSWERS_CUSTOM_TYPE,
	assistantToolCallsAreExecutable,
	isAskUserAnswersMessage,
	isAskUserQuestionArgs,
} from "@thinkrail/contracts";
import {
	ASK_STOPPED_ERROR,
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	type ExtensionSessionServices,
	isAckDetails,
} from "../extensions";

export { ASK_ACK_TEXT, ASK_STOPPED_ERROR, ASK_USER_QUESTION_TOOL_NAME } from "../extensions";

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

export type Answerability =
	| { ok: true; args: AskUserQuestionArgs }
	| { ok: false; reason: "unknown_call" | "already_answered" | "not_awaiting" | "superseded" };

export function assessAnswerability(
	messages: readonly AgentMessage[],
	toolCallId: string,
): Answerability {
	const views = messages as readonly MessageView[];
	let callIndex = -1;
	let callDead = false;
	let args: AskUserQuestionArgs | null = null;
	for (let i = 0; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		for (const block of toolCallsOf(view)) {
			if (block.id === toolCallId && block.name === ASK_USER_QUESTION_TOOL_NAME) {
				callIndex = i;
				callDead = !assistantToolCallsAreExecutable(view.stopReason);
				args = isAskUserQuestionArgs(block.arguments) ? block.arguments : null;
			}
		}
	}
	if (callIndex < 0 || !args) return { ok: false, reason: "unknown_call" };
	if (callDead) return { ok: false, reason: "not_awaiting" };

	for (let i = callIndex + 1; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		if (isAskUserAnswersMessage(view) && view.details.toolCallId === toolCallId)
			return { ok: false, reason: "already_answered" };
		if (view.role === "toolResult" && view.toolCallId === toolCallId && !isAckDetails(view.details))
			return { ok: false, reason: "not_awaiting" };
		if (view.role === "user") return { ok: false, reason: "superseded" };
	}
	return { ok: true, args };
}

export function hasQuestionAck(messages: readonly AgentMessage[], toolCallId: string): boolean {
	return (messages as readonly MessageView[]).some(
		(message) =>
			message.role === "toolResult" &&
			message.toolCallId === toolCallId &&
			isAckDetails(message.details),
	);
}

export function awaitingQuestionToolCallId(
	messages: readonly AgentMessage[],
	acknowledgedOnly = false,
): string | null {
	const views = messages as readonly MessageView[];
	for (let i = views.length - 1; i >= 0; i--) {
		const view = views[i];
		if (!view) continue;
		if (view.role === "user") return null;
		for (const block of toolCallsOf(view)) {
			const { id } = block;
			if (id === undefined || block.name !== ASK_USER_QUESTION_TOOL_NAME) continue;
			if (!assessAnswerability(messages, id).ok) continue;
			if (!acknowledgedOnly || hasQuestionAck(messages, id)) return id;
		}
	}
	return null;
}

export const ANSWERABILITY_ERRORS: Record<Extract<Answerability, { ok: false }>["reason"], string> =
	{
		unknown_call: "Unknown ask_user_question tool call",
		already_answered: "This questionnaire was already answered",
		not_awaiting: "This questionnaire is not awaiting an answer",
		superseded: "This questionnaire was superseded by a later message",
	};

export function buildAnswersMessage(
	toolCallId: string,
	args: AskUserQuestionArgs,
	result: AskUserQuestionResult,
): Pick<AskUserAnswersMessage, "customType" | "content" | "display" | "details"> {
	const envelope = buildQuestionnaireResponse(result, args);
	return {
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: envelope.content.map((c) => c.text).join(""),
		display: true,
		details: { toolCallId, result },
	};
}

export type AskUserQuestionWaitOutcome =
	| { kind: "answer"; result: AskUserQuestionResult }
	| { kind: "superseded" }
	| { kind: "abandoned" };

type LiveQuestionPhase =
	| "expected"
	| "waiting"
	| "answer-accepted-uncommitted"
	| "superseded"
	| "stopped";

interface LiveQuestionWaiter {
	phase: LiveQuestionPhase;
	executeStarted: boolean;
	acceptedResult: AskUserQuestionResult | undefined;
	answerPromise: Promise<AskUserQuestionWaitOutcome>;
	resolveAnswer: (outcome: AskUserQuestionWaitOutcome) => void;
	rejectAnswer: (error: Error) => void;
	persisted: Promise<void>;
	resolvePersisted: () => void;
	rejectPersisted: (error: Error) => void;
	cleanupAbort: () => void;
}

function createLiveQuestionWaiter(): LiveQuestionWaiter {
	let resolveAnswer: (outcome: AskUserQuestionWaitOutcome) => void = () => {};
	let rejectAnswer: (error: Error) => void = () => {};
	const answerPromise = new Promise<AskUserQuestionWaitOutcome>((resolve, reject) => {
		resolveAnswer = resolve;
		rejectAnswer = reject;
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
		acceptedResult: undefined,
		answerPromise,
		resolveAnswer,
		rejectAnswer,
		persisted,
		resolvePersisted,
		rejectPersisted,
		cleanupAbort: () => {},
	};
}

export interface AskUserQuestionWaiters {
	expect(toolCallId: string): void;
	wait(toolCallId: string, signal: AbortSignal | undefined): Promise<AskUserQuestionWaitOutcome>;
	answer(
		toolCallId: string,
		result: AskUserQuestionResult,
	): { handled: false } | { handled: true; persisted: Promise<void> };
	persistTurn(
		toolResults: readonly {
			toolCallId: string;
			toolName: string;
			details?: unknown;
			isError?: boolean;
		}[],
	): void;
	supersede(): boolean;
	currentQuestion(): { interactionId: string; needsInput: boolean } | null;
	hasRecoverableCall(): boolean;
	prepareShutdown(): Promise<void> | null;
	prepareAbort(): Promise<void> | null;
	abandon(): void;
}

export function createAskUserQuestionWaiters(): AskUserQuestionWaiters {
	const waiting = new Map<string, LiveQuestionWaiter>();
	let shutdownPrepared = false;
	const waiterFor = (toolCallId: string): LiveQuestionWaiter => {
		let waiter = waiting.get(toolCallId);
		if (!waiter) {
			waiter = createLiveQuestionWaiter();
			waiting.set(toolCallId, waiter);
		}
		return waiter;
	};
	const notAwaiting = (toolCallId: string): Error =>
		new Error(`This questionnaire is not awaiting an answer: ${toolCallId}`);
	const answerNotPersisted = (toolCallId: string): Error =>
		new Error(`This questionnaire's accepted answer was not persisted: ${toolCallId}`);
	const acceptedResultPersistence = (): Promise<void> | null => {
		const accepted = [...waiting.values()]
			.filter((waiter) => waiter.phase === "answer-accepted-uncommitted")
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
				return Promise.reject(new Error(`Duplicate ask_user_question tool call: ${toolCallId}`));
			}
			waiter.executeStarted = true;
			if (waiter.phase === "answer-accepted-uncommitted") return waiter.answerPromise;
			if (waiter.phase === "superseded") return Promise.resolve({ kind: "superseded" });
			if (waiter.phase === "stopped") return Promise.reject(new Error(ASK_STOPPED_ERROR));
			waiter.phase = "waiting";
			if (signal?.aborted) {
				waiter.phase = "stopped";
				waiter.rejectAnswer(new Error(ASK_STOPPED_ERROR));
				return waiter.answerPromise;
			}
			const abort = (): void => {
				if (waiting.get(toolCallId) !== waiter || waiter.phase !== "waiting") return;
				waiter.phase = "stopped";
				waiter.rejectAnswer(new Error(ASK_STOPPED_ERROR));
			};
			signal?.addEventListener("abort", abort, { once: true });
			waiter.cleanupAbort = () => signal?.removeEventListener("abort", abort);
			return waiter.answerPromise;
		},
		answer(toolCallId, result) {
			if (shutdownPrepared) throw notAwaiting(toolCallId);
			const waiter = waiting.get(toolCallId);
			if (!waiter) return { handled: false };
			if (waiter.phase === "stopped") throw notAwaiting(toolCallId);
			if (waiter.phase === "superseded") {
				throw new Error(`${ANSWERABILITY_ERRORS.superseded}: ${toolCallId}`);
			}
			if (waiter.phase === "answer-accepted-uncommitted") {
				throw new Error(`${ANSWERABILITY_ERRORS.already_answered}: ${toolCallId}`);
			}
			waiter.phase = "answer-accepted-uncommitted";
			waiter.acceptedResult = structuredClone(result);
			waiter.resolveAnswer({ kind: "answer", result });
			return { handled: true, persisted: waiter.persisted };
		},
		persistTurn(toolResults) {
			for (const result of toolResults) {
				if (result.toolName !== ASK_USER_QUESTION_TOOL_NAME) continue;
				const waiter = waiting.get(result.toolCallId);
				if (!waiter) continue;
				waiting.delete(result.toolCallId);
				waiter.cleanupAbort();
				if (waiter.phase !== "answer-accepted-uncommitted") continue;
				if (
					waiter.executeStarted &&
					waiter.acceptedResult !== undefined &&
					result.isError !== true &&
					isDeepStrictEqual(result.details, waiter.acceptedResult)
				) {
					waiter.resolvePersisted();
				} else {
					waiter.rejectPersisted(answerNotPersisted(result.toolCallId));
				}
			}
			for (const [toolCallId, waiter] of waiting) {
				waiting.delete(toolCallId);
				waiter.cleanupAbort();
				if (waiter.phase === "waiting") waiter.rejectAnswer(notAwaiting(toolCallId));
				if (waiter.phase === "answer-accepted-uncommitted") {
					waiter.rejectPersisted(answerNotPersisted(toolCallId));
				}
			}
		},
		supersede() {
			let superseded = false;
			for (const waiter of waiting.values()) {
				if (waiter.phase !== "expected" && waiter.phase !== "waiting") continue;
				if (waiter.phase === "waiting") waiter.resolveAnswer({ kind: "superseded" });
				waiter.phase = "superseded";
				superseded = true;
			}
			return superseded;
		},
		currentQuestion() {
			for (const [interactionId, waiter] of waiting) {
				return {
					interactionId,
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
			return acceptedResultPersistence();
		},
		prepareAbort() {
			const accepted: Promise<void>[] = [];
			for (const waiter of waiting.values()) {
				if (waiter.phase === "answer-accepted-uncommitted") {
					accepted.push(waiter.persisted);
					continue;
				}
				if (waiter.phase === "waiting") waiter.rejectAnswer(new Error(ASK_STOPPED_ERROR));
				if (waiter.phase === "expected" || waiter.phase === "waiting") {
					waiter.phase = "stopped";
				}
			}
			return accepted.length > 0 ? Promise.all(accepted).then(() => {}) : null;
		},
		abandon() {
			const error = new Error("Session disposed while waiting for a question");
			for (const waiter of waiting.values()) {
				waiter.cleanupAbort();
				if (waiter.phase === "waiting") waiter.resolveAnswer({ kind: "abandoned" });
				if (waiter.phase === "answer-accepted-uncommitted") waiter.rejectPersisted(error);
			}
			waiting.clear();
		},
	};
}

export function askUserQuestionSessionServices(
	waiters: AskUserQuestionWaiters,
): ExtensionSessionServices {
	return {
		expectToolResponse: (toolCallId) => waiters.expect(toolCallId),
		awaitToolResponse: async (toolCallId, signal) => {
			const outcome = await waiters.wait(toolCallId, signal);
			return outcome.kind === "answer"
				? { kind: "response", value: outcome.result }
				: outcome.kind === "superseded"
					? { kind: "deferred" }
					: { kind: "abandoned" };
		},
	};
}
