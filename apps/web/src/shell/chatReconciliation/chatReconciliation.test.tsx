import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import type { SessionSummary } from "@thinkrail/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceLayoutDocument } from "../layout";

const catalogs: { resolve: (summaries: SessionSummary[]) => void }[] = [];
const actualTransport = { ...(await import("../../transport")) };
type LoadedMessages = Awaited<
	ReturnType<typeof actualTransport.getSessionMessagesWithSkillBaseline>
>;
const transcripts: { sessionId: string; resolve: (loaded: LoadedMessages) => void }[] = [];
mock.module("../../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string) => {
			if (method !== "session.list") throw new Error(`Unexpected request: ${method}`);
			return new Promise<SessionSummary[]>((resolve) => catalogs.push({ resolve }));
		},
	}),
	getSessionMessagesWithSkillBaseline: ({ sessionId }: { sessionId: string }) =>
		new Promise<LoadedMessages>((resolve) => transcripts.push({ sessionId, resolve })),
}));

const { chatTabId, useAppStore } = await import("../../store");
const { useWorkspaceChatCatalogReconciliation } = await import("./chatReconciliation");
type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };
const initial = useAppStore.getInitialState();
let workspaceId: string;
let sequence = 0;
let root: Root | undefined;

beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
	mock.module("../../transport", () => actualTransport);
});
beforeEach(() => {
	workspaceId = `entry-${++sequence}`;
	catalogs.length = 0;
	transcripts.length = 0;
	useAppStore.setState(initial, true);
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 1,
		activeWorkspaceId: workspaceId,
		layoutDocumentsByWorkspace: { [workspaceId]: documentFor(["kept", "closed"]) },
		layoutAttentionByWorkspace: {
			[workspaceId]: {
				selectedByGroup: { center: chatTabId(workspaceId, "kept") },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 0 },
			},
		},
		activeTabByWorkspace: { [workspaceId]: chatTabId(workspaceId, "kept") },
	});
	for (const sessionId of ["kept", "closed", "todo"]) hydrate(summary(sessionId));
});
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = undefined;
	useAppStore.setState(initial, true);
});

function documentFor(sessionIds: string[]): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: sessionIds.map((sessionId) => ({
				kind: "chat",
				id: chatTabId(workspaceId, sessionId),
				name: sessionId,
				sessionId,
			})),
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

function summary(sessionId: string, live = true): SessionSummary {
	return {
		sessionId,
		workspaceId,
		title: sessionId,
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		updatedAt: sessionId === "closed" ? 2 : 1,
		live,
	};
}

function hydrate(value: SessionSummary): void {
	useAppStore
		.getState()
		.hydrateSession(
			value,
			{ turns: [], toolResults: {}, toolResponses: {}, turnIdByMessageIndex: [] },
			false,
			undefined,
			{ activate: false },
		);
}

function commit(document: WorkspaceLayoutDocument): void {
	useAppStore.setState({ layoutDocumentsByWorkspace: { [workspaceId]: document } });
}

function Reconciliation() {
	useWorkspaceChatCatalogReconciliation(workspaceId, commit);
	return null;
}

async function mount(): Promise<void> {
	const noop = () => {};
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element);
	await act(async () => root?.render(<Reconciliation />));
}

async function close(sessionId: string, remaining: string[]): Promise<void> {
	await act(async () => {
		commit(documentFor(remaining));
		useAppStore.getState().closeChatToHistory(sessionId, false, workspaceId, false);
	});
}

async function reconnect(): Promise<void> {
	await act(async () => useAppStore.setState({ status: "disconnected" }));
	await act(async () => useAppStore.setState({ status: "connected", connectionGeneration: 2 }));
}

async function reply(values: SessionSummary[]): Promise<void> {
	const catalog = catalogs.at(-1);
	if (!catalog) throw new Error("No pending catalog");
	await act(async () => catalog.resolve(values));
}

const opens = () =>
	useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open")
		.map((intent) => ({
			sessionId: intent.tab.kind === "chat" ? intent.tab.sessionId : null,
			activate: intent.activate,
		}));

for (const cut of [false, true]) {
	test(`a close before the first catalog survives ${cut ? "reconnect" : "a late reply"} without another chat taking focus`, async () => {
		await mount();
		await close("closed", ["kept"]);
		if (cut) await reconnect();
		await reply([summary("closed"), summary("kept"), summary("todo")]);

		expect(opens()).toEqual([{ sessionId: "todo", activate: false }]);
		expect(useAppStore.getState().closedChatsByWorkspace[workspaceId]).toContainEqual(
			expect.objectContaining({ sessionId: "closed" }),
		);
		expect(useAppStore.getState().activeTabByWorkspace[workspaceId]).toBe(
			chatTabId(workspaceId, "kept"),
		);
	});
}

test("closing the last restored chat does not reopen it as the empty-workspace fallback", async () => {
	commit(documentFor(["closed"]));
	await mount();
	await close("closed", []);
	await reply([summary("closed", false)]);
	expect(opens()).toEqual([]);
});

test("an empty workspace can fall back to a never-placed chat after a newer one was closed", async () => {
	commit(documentFor(["closed"]));
	await mount();
	await close("closed", []);
	await reply([summary("closed", false), summary("todo", false)]);
	expect(opens()).toEqual([{ sessionId: "todo", activate: true }]);
});

test("navigation during the first catalog wait still wins after reconnect", async () => {
	await mount();
	await act(async () => useAppStore.getState().beginCenterNavigation(workspaceId));
	await reconnect();
	await reply([summary("kept"), summary("closed"), summary("todo")]);
	expect(opens()).toEqual([{ sessionId: "todo", activate: false }]);
});

test("a candidate placed and closed while its transcript loads is not opened by the late read", async () => {
	useAppStore.getState().closeChatRuntime("todo");
	await mount();
	await reply([summary("kept"), summary("closed"), summary("todo")]);
	expect(transcripts.map((read) => read.sessionId)).toEqual(["todo"]);
	await act(async () => {
		hydrate(summary("todo"));
		commit(documentFor(["kept", "closed", "todo"]));
	});
	await close("todo", ["kept", "closed"]);
	await act(async () =>
		transcripts[0]?.resolve({ result: { summary: summary("todo"), messages: [] }, syncedTick: 0 }),
	);
	expect(opens()).toEqual([]);
});

test("an explicit chat route still reopens a previously closed chat", async () => {
	await mount();
	await close("closed", ["kept"]);
	await reply([summary("closed"), summary("kept")]);
	useAppStore.setState({ layoutIntents: [] });
	await act(async () =>
		useAppStore
			.getState()
			.activateWorkspaceFromRoute({ id: workspaceId, projectId: "project" }, "closed"),
	);
	await reply([summary("closed"), summary("kept")]);
	expect(opens()).toEqual([{ sessionId: "closed", activate: undefined }]);
});
