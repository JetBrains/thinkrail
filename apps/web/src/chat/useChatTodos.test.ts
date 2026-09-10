import { expect, test } from "bun:test";
import {
	type AssistantMessage,
	type PiEvent,
	type SessionSummary,
	TODO_NUDGE_PREFIX,
} from "@thinkrail/contracts";
import { EMPTY_RUNTIME, useAppStore } from "../store";
import {
	createTodoInvalidationSignal,
	nudgeAgent,
	shouldRefreshTodos,
	type TodoNudgeDependencies,
	todoReadFailureState,
} from "./useChatTodos";

test("TODO refreshes follow tool completion and final settlement, not attempt-level agent_end", () => {
	expect(shouldRefreshTodos({ type: "tool_execution_end" } as PiEvent)).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_settled", terminal: null })).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		false,
	);
});

test("a latest automatic TODO read failure superseding Retry is blocking only without a plan", () => {
	const retryRead = 1;
	const automaticRead = 2;
	expect(todoReadFailureState(retryRead, automaticRead, false)).toBeNull();
	expect(todoReadFailureState(automaticRead, automaticRead, false)).toBe(true);
	expect(todoReadFailureState(automaticRead, automaticRead, true)).toBe(false);
});

test("TODO invalidation is identity-scoped, data-free, and skips its source", () => {
	const signal = createTodoInvalidationSignal();
	const source = {};
	const sibling = {};
	let sourceReads = 0;
	let siblingReads = 0;
	let siblingArguments: unknown[] = [];
	let otherReads = 0;
	const stopSource = signal.subscribe("workspace:session", {
		source,
		invalidate: () => {
			sourceReads += 1;
		},
	});
	const stopSibling = signal.subscribe("workspace:session", {
		source: sibling,
		invalidate: (...args: unknown[]) => {
			siblingReads += 1;
			siblingArguments = args;
		},
	});
	signal.subscribe("workspace:other", {
		source: {},
		invalidate: () => {
			otherReads += 1;
		},
	});

	signal.invalidate("workspace:session", source);
	expect(sourceReads).toBe(0);
	expect(siblingReads).toBe(1);
	expect(siblingArguments).toEqual([]);
	expect(otherReads).toBe(0);

	stopSource();
	stopSibling();
	signal.invalidate("workspace:session", {});
	expect(siblingReads).toBe(1);
});

function sessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: "session-1",
		workspaceId: "workspace-1",
		title: "History chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		updatedAt: 1,
		live: true,
		...overrides,
	};
}

function installNudgeState(runtime: typeof EMPTY_RUNTIME | null) {
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 5,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		sessions: runtime ? { "session-1": runtime } : {},
		closedChatsByWorkspace: {
			"workspace-1": [{ sessionId: "session-1", title: "History chat", closedAt: 1 }],
		},
		tabsByWorkspace: { "workspace-1": [] },
	});
}

function nudgeDependencies(
	summary: SessionSummary,
	send: TodoNudgeDependencies["send"],
): TodoNudgeDependencies {
	return {
		state: useAppStore.getState,
		read: async () => ({ summary, messages: [] }),
		send,
	};
}

test("a stale history runtime reads streaming authority and follows up without hydrating the store", async () => {
	installNudgeState({
		...EMPTY_RUNTIME,
		isStreaming: false,
		syncedConnectionGeneration: 4,
	});
	const runtimeBefore = useAppStore.getState().sessions["session-1"];
	const historyBefore = useAppStore.getState().closedChatsByWorkspace["workspace-1"];
	const methods: string[] = [];

	await nudgeAgent(
		"workspace-1",
		"session-1",
		"Cover checkout",
		nudgeDependencies(sessionSummary({ isStreaming: true }), async (method) => {
			methods.push(method);
		}),
	);

	expect(methods).toEqual(["session.followUp"]);
	expect(useAppStore.getState().sessions["session-1"]).toBe(runtimeBefore);
	expect(useAppStore.getState().closedChatsByWorkspace["workspace-1"]).toBe(historyBefore);
	expect(useAppStore.getState().tabsByWorkspace["workspace-1"]).toEqual([]);
});

test("a missing history runtime with an awaiting question skips its TODO nudge", async () => {
	installNudgeState(null);
	const historyBefore = useAppStore.getState().closedChatsByWorkspace["workspace-1"];
	const methods: string[] = [];
	const askMessage = {
		role: "assistant",
		content: [{ type: "toolCall", id: "question-1", name: "ask_user_question", arguments: {} }],
	} as unknown as AssistantMessage;

	const deps = nudgeDependencies(sessionSummary(), async (method) => {
		methods.push(method);
	});
	deps.read = async () => ({ summary: sessionSummary(), messages: [askMessage] });

	await nudgeAgent("workspace-1", "session-1", "Cover checkout", deps);

	expect(methods).toEqual([]);
	expect(useAppStore.getState().sessions["session-1"]).toBeUndefined();
	expect(useAppStore.getState().closedChatsByWorkspace["workspace-1"]).toBe(historyBefore);
});

test("a later hidden TODO control supersedes an unanswered question for nudge classification", async () => {
	installNudgeState(null);
	const methods: string[] = [];
	const askMessage = {
		role: "assistant",
		content: [{ type: "toolCall", id: "question-1", name: "ask_user_question", arguments: {} }],
	} as unknown as AssistantMessage;
	const previousNudge = {
		role: "user",
		content: `${TODO_NUDGE_PREFIX}Earlier TODO`,
		timestamp: 2,
	} as const;
	const deps = nudgeDependencies(sessionSummary(), async (method) => {
		methods.push(method);
	});
	deps.read = async () => ({
		summary: sessionSummary(),
		messages: [askMessage, previousNudge],
	});

	await nudgeAgent("workspace-1", "session-1", "Cover checkout", deps);

	expect(methods).toEqual(["session.prompt"]);
});

test("stale nudge reads are fenced by generation, workspace removal, and session deletion", async () => {
	const mutations = [
		() => useAppStore.setState({ connectionGeneration: 6 }),
		() => useAppStore.setState({ removedWorkspaceIds: { "workspace-1": true } }),
		() =>
			useAppStore.setState({
				deletedSessionsByWorkspace: { "workspace-1": { "session-1": true } },
			}),
	];
	for (const mutate of mutations) {
		installNudgeState({ ...EMPTY_RUNTIME, syncedConnectionGeneration: 4 });
		const methods: string[] = [];
		const deps = nudgeDependencies(sessionSummary({ isStreaming: true }), async (method) => {
			methods.push(method);
		});
		deps.read = async () => {
			mutate();
			return { summary: sessionSummary({ isStreaming: true }), messages: [] };
		};

		await nudgeAgent("workspace-1", "session-1", "Cover checkout", deps);
		expect(methods).toEqual([]);
	}
});

test("a failed current-runtime nudge rereads authority and retries the current method", async () => {
	installNudgeState({
		...EMPTY_RUNTIME,
		isStreaming: true,
		syncedConnectionGeneration: 5,
	});
	const methods: string[] = [];
	let reads = 0;
	const deps = nudgeDependencies(sessionSummary(), async (method) => {
		methods.push(method);
		if (methods.length === 1) throw new Error("session changed state");
	});
	deps.read = async () => {
		reads += 1;
		return { summary: sessionSummary(), messages: [] };
	};

	await nudgeAgent("workspace-1", "session-1", "Cover checkout", deps);

	expect(reads).toBe(1);
	expect(methods).toEqual(["session.followUp", "session.prompt"]);
});
