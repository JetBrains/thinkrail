import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { ChatContinuation, Project, Workspace } from "@thinkrail/contracts";

interface Request {
	method: string;
	params: { operationId?: string; projectId?: string; workspaceId?: string };
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}

const requests: Request[] = [];
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: Request["params"]) =>
			new Promise((resolve, reject) => {
				requests.push({ method, params, resolve, reject });
			}),
	}),
}));
const { RequestError } = actualTransport;
const { useAppStore } = await import("../store");
const {
	followContinuation,
	reconcileContinuations,
	refreshContinuation,
	resetContinuationReadsForTests,
} = await import("./continuations");

const initial = useAppStore.getInitialState();
const project: Project = { id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 0 };
const destination: Workspace = {
	id: "w-new",
	projectId: "p1",
	name: "continued",
	branch: "continued",
	baseBranch: "main",
	worktreePath: "/repo/.worktrees/continued",
};

function continuation(over: Partial<ChatContinuation> = {}): ChatContinuation {
	return {
		operationId: "op1",
		sourceWorkspaceId: "chat-1",
		sourceSessionId: "s-chat",
		projectId: "p1",
		phase: "summarizing",
		...over,
	};
}

function take(method: string): Request {
	const index = requests.findIndex((request) => request.method === method);
	const [request] = requests.splice(index, 1);
	if (index < 0 || !request) throw new Error(`no ${method} request`);
	return request;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	requests.length = 0;
	resetContinuationReadsForTests();
	useAppStore.setState(initial, true);
	useAppStore.setState({ projects: [project], welcomeGeneration: 1 });
});
afterAll(() => useAppStore.setState(initial, true));

test("after a welcome every unsettled operation and every one this client started is read again, once per connection", async () => {
	useAppStore.getState().applyChatContinuation(continuation());
	useAppStore
		.getState()
		.applyChatContinuation(continuation({ operationId: "done", phase: "started" }));
	useAppStore.getState().noteInitiatedContinuation("mine");
	reconcileContinuations();
	reconcileContinuations();
	expect(requests.map((request) => request.params.operationId).sort()).toEqual(["mine", "op1"]);

	take("chat.continuationStatus").resolve(continuation({ phase: "started", workspaceId: "w-new" }));
	await settle();
	expect(useAppStore.getState().chatContinuations.op1?.phase).toBe("started");

	take("chat.continuationStatus").reject(new Error("socket closed"));
	await settle();
	reconcileContinuations();
	expect(requests).toEqual([]);
	useAppStore.setState({ welcomeGeneration: 2 });
	reconcileContinuations();
	expect(requests.map((request) => request.params.operationId)).toEqual(["mine"]);
});

test("an operation the host no longer knows becomes lost, and a push that lands first wins over the read", async () => {
	useAppStore.getState().applyChatContinuation(continuation());
	refreshContinuation("op1");
	take("chat.continuationStatus").reject(new RequestError("CONTINUATION_UNKNOWN", "unknown"));
	await settle();
	expect(useAppStore.getState().chatContinuations.op1?.phase).toBe("lost");

	refreshContinuation("op2", { workspaceId: "chat-1", sessionId: "s-chat" });
	take("chat.continuationStatus").reject(new RequestError("CONTINUATION_UNKNOWN", "unknown"));
	await settle();
	expect(useAppStore.getState().chatContinuations.op2).toMatchObject({
		sourceWorkspaceId: "chat-1",
		sourceSessionId: "s-chat",
		phase: "lost",
	});

	useAppStore.getState().applyChatContinuation(continuation({ operationId: "op3" }));
	refreshContinuation("op3");
	const read = take("chat.continuationStatus");
	useAppStore
		.getState()
		.applyChatContinuation(
			continuation({ operationId: "op3", phase: "started", workspaceId: "w" }),
		);
	read.resolve(continuation({ operationId: "op3", phase: "creating" }));
	await settle();
	expect(useAppStore.getState().chatContinuations.op3?.phase).toBe("started");

	useAppStore.getState().noteInitiatedContinuation("op4");
	refreshContinuation("op4");
	take("chat.continuationStatus").reject(new RequestError("CONTINUATION_UNKNOWN", "unknown"));
	await settle();
	expect(useAppStore.getState().initiatedContinuations.op4).toBeUndefined();
	expect(useAppStore.getState().chatContinuations.op4).toBeUndefined();
});

test("a card's read that failed is asked again on the next connection, never twice on one", async () => {
	const source = { workspaceId: "chat-1", sessionId: "s-chat" };
	refreshContinuation("card", source);
	take("chat.continuationStatus").reject(new Error("socket closed"));
	await settle();
	refreshContinuation("card", source);
	expect(requests).toEqual([]);
	useAppStore.setState({ welcomeGeneration: 2 });
	refreshContinuation("card", source);
	take("chat.continuationStatus").resolve(continuation({ operationId: "card", phase: "started" }));
	await settle();
	expect(useAppStore.getState().chatContinuations.card?.phase).toBe("started");
});

test("a follow a reconnect overtook is armed again and followed on the connection that overtook it", async () => {
	const started = continuation({ phase: "started", workspaceId: "w-new", sessionId: "s-new" });
	useAppStore.getState().noteInitiatedContinuation("op1");
	followContinuation(started);
	useAppStore.setState({ welcomeGeneration: 2 });
	take("workspace.list").resolve([destination]);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBeNull();
	expect(useAppStore.getState().initiatedContinuations.op1).toBe(true);

	followContinuation(started);
	take("workspace.list").resolve([destination]);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w-new");
	expect(useAppStore.getState().initiatedContinuations.op1).toBeUndefined();
	followContinuation(started);
	expect(requests).toEqual([]);
});

test("only the initiating client follows a started operation, once", async () => {
	const started = continuation({ phase: "started", workspaceId: "w-new", sessionId: "s-new" });
	followContinuation(started);
	expect(requests).toEqual([]);

	useAppStore.getState().noteInitiatedContinuation("op1");
	followContinuation(continuation({ phase: "creating" }));
	expect(requests).toEqual([]);
	followContinuation(started);
	followContinuation(started);
	expect(requests.map((request) => request.method)).toEqual(["workspace.list"]);
	take("workspace.list").resolve([destination]);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w-new");
	expect(useAppStore.getState().initiatedContinuations.op1).toBeUndefined();
});
