import type { AskUserQuestionArgs, AskUserQuestionResult, PiEvent } from "@thinkrail/contracts";
import { TODO_NUDGE_PREFIX } from "@thinkrail/contracts";
import { buildTimedOutQuestionResult } from "../agent";

const MINUTE_MS = 60_000;

const CONTINUE_TODOS_PROMPT = `${TODO_NUDGE_PREFIX}The automatic continuation timeout expired while this chat still has open TODOs. Read the current plan with todo_list, continue the in-progress item (or the next pending item if none is in progress), and keep item statuses current. When a decision is needed and it is safe to proceed without user-specific information, follow your recommended option rather than waiting again.`;

export interface AutoResumeSessionState {
	workspaceId: string;
	streaming: boolean;
	question: { toolCallId: string; args: AskUserQuestionArgs } | null;
}

export interface AutoResumeDependencies {
	getTimeoutMinutes(): number | null;
	getSessionState(sessionId: string): AutoResumeSessionState | null;
	countOpenTodos(workspaceId: string, sessionId: string): number;
	answerQuestion(
		sessionId: string,
		toolCallId: string,
		result: AskUserQuestionResult,
	): Promise<void>;
	promptSession(sessionId: string, text: string): Promise<void>;
	reportFailure?(sessionId: string): void;
}

interface PendingTimer {
	handle: ReturnType<typeof setTimeout>;
	token: symbol;
}

export class AutoResumeScheduler {
	private readonly attached = new Set<string>();
	private readonly timers = new Map<string, PendingTimer>();
	private timeoutMinutes: number | null;

	constructor(private readonly dependencies: AutoResumeDependencies) {
		this.timeoutMinutes = dependencies.getTimeoutMinutes();
	}

	handleAttached(sessionId: string): void {
		this.attached.add(sessionId);
		this.reconcile(sessionId);
	}

	handleRemoved(sessionId: string): void {
		this.attached.delete(sessionId);
		this.cancel(sessionId);
	}

	handleWorkspaceRemoved(workspaceId: string): void {
		for (const sessionId of this.attached) {
			if (this.readState(sessionId)?.workspaceId === workspaceId) this.handleRemoved(sessionId);
		}
	}

	handleEvent(sessionId: string, event: PiEvent): void {
		this.attached.add(sessionId);
		if (event.type === "agent_start") this.cancel(sessionId);
		else if (event.type === "agent_settled") this.reconcile(sessionId);
	}

	handleConfigChanged(): void {
		const next = this.dependencies.getTimeoutMinutes();
		if (next === this.timeoutMinutes) return;
		this.timeoutMinutes = next;
		for (const sessionId of this.attached) this.reconcile(sessionId);
	}

	dispose(): void {
		for (const sessionId of this.timers.keys()) this.cancel(sessionId);
		this.attached.clear();
	}

	private reconcile(sessionId: string): void {
		this.cancel(sessionId);
		const minutes = this.timeoutMinutes;
		if (minutes === null) return;
		const state = this.readState(sessionId);
		if (!state || state.streaming) return;
		if (!state.question && this.openTodoCount(state.workspaceId, sessionId) === 0) return;

		const token = Symbol(sessionId);
		const handle = setTimeout(() => {
			if (this.timers.get(sessionId)?.token !== token) return;
			this.timers.delete(sessionId);
			void this.expire(sessionId, minutes).catch(() =>
				this.dependencies.reportFailure?.(sessionId),
			);
		}, minutes * MINUTE_MS);
		if (typeof handle === "object" && "unref" in handle) handle.unref();
		this.timers.set(sessionId, { handle, token });
	}

	private async expire(sessionId: string, armedMinutes: number): Promise<void> {
		const currentMinutes = this.dependencies.getTimeoutMinutes();
		if (currentMinutes !== armedMinutes) {
			this.timeoutMinutes = currentMinutes;
			this.reconcile(sessionId);
			return;
		}
		const state = this.readState(sessionId);
		if (!state || state.streaming) return;
		if (state.question) {
			await this.dependencies.answerQuestion(
				sessionId,
				state.question.toolCallId,
				buildTimedOutQuestionResult(state.question.args),
			);
			return;
		}
		if (this.openTodoCount(state.workspaceId, sessionId) === 0) return;
		await this.dependencies.promptSession(sessionId, CONTINUE_TODOS_PROMPT);
	}

	private readState(sessionId: string): AutoResumeSessionState | null {
		try {
			const state = this.dependencies.getSessionState(sessionId);
			if (!state) this.handleRemoved(sessionId);
			return state;
		} catch {
			this.handleRemoved(sessionId);
			return null;
		}
	}

	private openTodoCount(workspaceId: string, sessionId: string): number {
		try {
			return this.dependencies.countOpenTodos(workspaceId, sessionId);
		} catch {
			return 0;
		}
	}

	private cancel(sessionId: string): void {
		const pending = this.timers.get(sessionId);
		if (!pending) return;
		clearTimeout(pending.handle);
		this.timers.delete(sessionId);
	}
}
