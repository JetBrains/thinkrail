import { afterEach, expect, jest, test } from "bun:test";
import type { AskUserQuestionArgs, AskUserQuestionResult } from "@thinkrail/contracts";
import { AutoResumeScheduler, type AutoResumeSessionState } from "./autoResume";

function questionnaire(): AskUserQuestionArgs {
	return {
		questions: [
			{
				question: "Which database?",
				header: "Database",
				options: [
					{
						label: "Postgres (Recommended)",
						description: "Shared",
						recommendedReason: "Best fit",
					},
					{ label: "SQLite", description: "Local" },
				],
			},
		],
	};
}

function harness(overrides: Partial<AutoResumeSessionState> = {}) {
	jest.useFakeTimers();
	let timeoutMinutes: number | null = 1;
	let openTodos = 1;
	let state: AutoResumeSessionState | null = {
		workspaceId: "ws-1",
		streaming: false,
		question: null,
		...overrides,
	};
	const actions: Array<
		| { kind: "answer"; sessionId: string; toolCallId: string; result: AskUserQuestionResult }
		| { kind: "prompt"; sessionId: string; text: string }
	> = [];
	const scheduler = new AutoResumeScheduler({
		getTimeoutMinutes: () => timeoutMinutes,
		getSessionState: () => state,
		countOpenTodos: () => openTodos,
		answerQuestion: async (sessionId, toolCallId, result) => {
			actions.push({ kind: "answer", sessionId, toolCallId, result });
		},
		promptSession: async (sessionId, text) => {
			actions.push({ kind: "prompt", sessionId, text });
		},
	});
	return {
		scheduler,
		actions,
		setTimeoutMinutes: (value: number | null) => {
			timeoutMinutes = value;
		},
		setOpenTodos: (value: number) => {
			openTodos = value;
		},
		setState: (value: AutoResumeSessionState | null) => {
			state = value;
		},
	};
}

async function advance(ms: number): Promise<void> {
	jest.advanceTimersByTime(ms);
	await Promise.resolve();
	await Promise.resolve();
}

afterEach(() => {
	jest.useRealTimers();
});

test("an unanswered question wins over open TODOs and resumes only when the deadline expires", async () => {
	const h = harness({ question: { toolCallId: "q-1", args: questionnaire() } });
	h.scheduler.handleAttached("session-1");

	await advance(59_999);
	expect(h.actions).toEqual([]);
	await advance(1);
	expect(h.actions).toEqual([
		{
			kind: "answer",
			sessionId: "session-1",
			toolCallId: "q-1",
			result: {
				answers: [
					{
						questionIndex: 0,
						question: "Which database?",
						kind: "option",
						answer: "Postgres (Recommended)",
					},
				],
				cancelled: false,
				timedOut: true,
			},
		},
	]);
});

test("plain idle arms only while the session has open TODOs", async () => {
	const h = harness();
	h.setOpenTodos(0);
	h.scheduler.handleAttached("session-1");
	await advance(60_000);
	expect(h.actions).toEqual([]);

	h.setOpenTodos(2);
	h.scheduler.handleEvent("session-1", { type: "agent_settled", terminal: null });
	await advance(60_000);
	expect(h.actions).toHaveLength(1);
	expect(h.actions[0]).toMatchObject({ kind: "prompt", sessionId: "session-1" });
	expect(h.actions[0]?.kind === "prompt" ? h.actions[0].text : "").toStartWith(
		"[thinkrail:todo-nudge] ",
	);
});

test("new work cancels a timer and a later settlement starts a fresh waiting period", async () => {
	const h = harness();
	h.scheduler.handleAttached("session-1");
	await advance(30_000);
	h.scheduler.handleEvent("session-1", { type: "agent_start" });
	await advance(60_000);
	expect(h.actions).toEqual([]);

	h.scheduler.handleEvent("session-1", { type: "agent_settled", terminal: null });
	await advance(60_000);
	expect(h.actions).toHaveLength(1);
});

test("expiry re-checks live state and late question priority instead of trusting the arm snapshot", async () => {
	const h = harness();
	h.scheduler.handleAttached("session-1");
	h.setState({ workspaceId: "ws-1", streaming: true, question: null });
	await advance(60_000);
	expect(h.actions).toEqual([]);

	h.setState({
		workspaceId: "ws-1",
		streaming: false,
		question: { toolCallId: "q-late", args: questionnaire() },
	});
	h.scheduler.handleEvent("session-1", { type: "agent_settled", terminal: null });
	await advance(60_000);
	expect(h.actions[0]).toMatchObject({ kind: "answer", toolCallId: "q-late" });
});

test("workspace removal cancels attached sessions before asynchronous teardown", async () => {
	const h = harness();
	h.scheduler.handleAttached("session-1");
	h.scheduler.handleWorkspaceRemoved("ws-1");
	await advance(60_000);
	expect(h.actions).toEqual([]);
});

test("an unrelated settings broadcast does not postpone an existing deadline", async () => {
	const h = harness();
	h.scheduler.handleAttached("session-1");
	await advance(30_000);
	h.scheduler.handleConfigChanged();
	await advance(29_999);
	expect(h.actions).toEqual([]);
	await advance(1);
	expect(h.actions).toHaveLength(1);
});

test("a settings change re-arms attached sessions from now and disabling or removal cancels", async () => {
	const h = harness();
	h.scheduler.handleAttached("session-1");
	await advance(30_000);
	h.setTimeoutMinutes(2);
	h.scheduler.handleConfigChanged();
	await advance(119_999);
	expect(h.actions).toEqual([]);
	await advance(1);
	expect(h.actions).toHaveLength(1);

	h.scheduler.handleEvent("session-1", { type: "agent_settled", terminal: null });
	h.setTimeoutMinutes(null);
	h.scheduler.handleConfigChanged();
	await advance(120_000);
	expect(h.actions).toHaveLength(1);

	h.setTimeoutMinutes(1);
	h.scheduler.handleConfigChanged();
	h.scheduler.handleRemoved("session-1");
	await advance(60_000);
	expect(h.actions).toHaveLength(1);
});
