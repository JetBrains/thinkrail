import { describe, expect, test } from "bun:test";
import {
	MODEL_PICKER_PROTOCOL_VERSION,
	type Project,
	type SessionState,
	type SessionStateRecord,
	type WireModel,
	type Workspace,
} from "@thinkrail/contracts";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import type { WorkspaceLayoutDocument } from "../shell/layout";
import { type EditorTab, EMPTY_RUNTIME } from "./appStore";
import {
	fsChangedPaths,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	isUserOwnedWorkspace,
	matchesWorktreePath,
	selectActiveEditorTab,
	selectActiveWorkspace,
	selectActiveWorkspaceProjectId,
	selectAgentReviewCommentCount,
	selectAttentionCenterResourceCacheKey,
	selectAttentionCenterResourceReady,
	selectAttentionCenterTab,
	selectCanRenameChat,
	selectCatalogModel,
	selectChatAttended,
	selectChatFirstPrompt,
	selectChatTitle,
	selectChatWorkspaceFirstPrompt,
	selectCompletionMarkedUnread,
	selectContextProject,
	selectFileChangeSince,
	selectHistoryTarget,
	selectKnownChatLocation,
	selectLayoutResourcePlacement,
	selectLayoutTabPlaced,
	selectLayoutTabPlacement,
	selectProjectIsRunning,
	selectProjectNeedsAttention,
	selectReadyCompletionAck,
	selectSkillsStale,
	selectSupportsModelPicker,
	selectUnnamedChatFirstPrompts,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspaceReadAction,
	specPathMatcher,
	workspaceName,
} from "./selectors";

const projects: Project[] = [
	{ id: "p1", name: "One", path: "/one", slug: "one", lastOpened: 1 },
	{ id: "p2", name: "Two", path: "/two", slug: "two", lastOpened: 2 },
];
const workspace: Workspace = {
	id: "w2",
	projectId: "p2",
	name: "Second workspace",
	branch: "second-workspace",
	worktreePath: "/two/workspace",
	baseBranch: "main",
};
const workspaces = { p1: [], p2: [workspace] };

test("connection generations reject stale or disconnected read settlements", () => {
	expect(isConnectedGeneration({ status: "connected", connectionGeneration: 4 }, 4)).toBe(true);
	expect(isConnectedGeneration({ status: "connected", connectionGeneration: 5 }, 4)).toBe(false);
	expect(isConnectedGeneration({ status: "disconnected", connectionGeneration: 4 }, 4)).toBe(false);
});

test("chat rename capability follows the host protocol snapshot", () => {
	expect(selectCanRenameChat({ protocolVersion: 66 })).toBe(true);
	expect(selectCanRenameChat({ protocolVersion: 65 })).toBe(false);
	expect(selectCanRenameChat({ protocolVersion: null })).toBe(false);
});

test("normalized rail flags keep attention binary and working orthogonal", () => {
	const record = (
		sessionId: string,
		projectId: string,
		workspaceId: string,
		state: SessionStateRecord["state"],
	): SessionStateRecord => ({ sessionId, projectId, workspaceId, state });
	const quiet = {
		execution: "idle" as const,
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
	};
	const working = { ...quiet, execution: "running" as const, runId: "run-working" };
	const delegating = { ...quiet, runId: "run-delegating", backgroundWork: true };
	const finished = {
		...quiet,
		runId: "run-finished",
		completion: { completionId: "done", outcome: "succeeded" as const },
		completionUnread: true,
	};
	const needsInput = {
		...working,
		needsInput: { interactionId: "tool:q1", kind: "tool-response" as const, toolCallId: "q1" },
	};
	const state = {
		sessionStateByWorkspace: {
			w1: {
				a: record("a", "p1", "w1", working),
				b: record("b", "p1", "w1", finished),
			},
			w2: { c: record("c", "p1", "w2", needsInput) },
			w3: { d: record("d", "p2", "w3", quiet) },
			w4: { e: record("e", "p3", "w4", delegating) },
		},
	};
	expect(selectWorkspaceNeedsAttention(state, "w1")).toBe(true);
	expect(selectWorkspaceIsRunning(state, "w1")).toBe(true);
	expect(selectWorkspaceNeedsAttention(state, "w2")).toBe(true);
	expect(selectWorkspaceIsRunning(state, "w2")).toBe(true);
	expect(selectProjectNeedsAttention(state, "p1")).toBe(true);
	expect(selectProjectIsRunning(state, "p1")).toBe(true);
	expect(selectProjectNeedsAttention(state, "p2")).toBe(false);
	expect(selectProjectIsRunning(state, "p2")).toBe(false);
	expect(selectWorkspaceIsRunning(state, "w4")).toBe(true);
	expect(selectProjectIsRunning(state, "p3")).toBe(true);
});

test("the workspace read action offers read over unread and hides with nothing to relight", () => {
	const base = {
		execution: "idle" as const,
		runId: "u1",
		needsInput: null,
		queuedCount: 0,
		backgroundWork: false,
	};
	const finished = (id: string, unread: boolean) => ({
		...base,
		completion: { completionId: `completion:${id}`, outcome: "succeeded" as const },
		completionUnread: unread,
	});
	const cancelled = {
		...base,
		completion: { completionId: "interrupted:u1", outcome: "cancelled" as const },
		completionUnread: false,
	};
	const row = (sessionId: string, state: SessionState) => ({
		sessionId,
		workspaceId: "w",
		projectId: "p",
		state,
	});
	const action = (...states: SessionState[]) =>
		selectWorkspaceReadAction(
			{
				sessionStateByWorkspace: {
					w: Object.fromEntries(states.map((st, i) => [`s${i}`, row(`s${i}`, st)])),
				},
			},
			"w",
		);
	expect(action(finished("a", false))).toBe("markUnread");
	expect(action(finished("a", false), finished("b", true))).toBe("markRead");
	expect(action(cancelled)).toBeNull();
	expect(action({ ...finished("a", false), backgroundWork: true })).toBeNull();
	expect(action({ ...finished("a", false), execution: "running" })).toBeNull();
	expect(action()).toBeNull();
});

test("a result counts as marked unread only for the exact completion this window relit", () => {
	const state = {
		execution: "idle" as const,
		runId: "u1",
		needsInput: null,
		completion: { completionId: "completion:a", outcome: "succeeded" as const },
		completionUnread: true,
		queuedCount: 0,
		backgroundWork: false,
	};
	const record = { sessionId: "s", workspaceId: "w", projectId: "p", state };
	const none = { markingUnreadWorkspaces: {}, markedUnreadBySession: {} };
	const mark = { workspaceId: "w", completionId: "completion:a", held: false };
	expect(selectCompletionMarkedUnread(none, record)).toBe(false);
	const pending = (candidates: Record<string, string>) => ({
		...none,
		markingUnreadWorkspaces: { w: { candidates, attendedSessionId: null } },
	});
	expect(selectCompletionMarkedUnread(pending({ s: "completion:a" }), record)).toBe(true);
	expect(selectCompletionMarkedUnread(pending({ s: "completion:old" }), record)).toBe(false);
	expect(selectCompletionMarkedUnread(pending({ other: "completion:a" }), record)).toBe(false);
	expect(
		selectCompletionMarkedUnread({ ...none, markedUnreadBySession: { s: mark } }, record),
	).toBe(true);
	expect(
		selectCompletionMarkedUnread({ ...none, markedUnreadBySession: { s: mark } }, record, {
			heldOnly: true,
		}),
	).toBe(false);
	expect(
		selectCompletionMarkedUnread(
			{ ...none, markedUnreadBySession: { s: { ...mark, completionId: "completion:old" } } },
			record,
		),
	).toBe(false);
	expect(
		selectCompletionMarkedUnread(
			{ ...none, markedUnreadBySession: { s: mark } },
			{ ...record, state: { ...state, completionUnread: false } },
		),
	).toBe(false);
});

test("completion acknowledgement requires the exact current result to have rendered", () => {
	const completion = { completionId: "completion:a1", outcome: "succeeded" as const };
	const hostState = {
		execution: "idle" as const,
		runId: "u1",
		needsInput: null,
		completion,
		completionUnread: true,
		queuedCount: 0,
		backgroundWork: false,
	};
	const state = {
		status: "connected",
		connectionGeneration: 4,
		sessionStateByWorkspace: {
			w1: { s1: { sessionId: "s1", workspaceId: "w1", projectId: "p1", state: hostState } },
		},
		sessions: {
			s1: { ...EMPTY_RUNTIME, hostState, syncedConnectionGeneration: 4 },
		},
		renderedCompletionBySession: { s1: completion.completionId },
		markingUnreadWorkspaces: {},
		markedUnreadBySession: {},
	};
	expect(selectReadyCompletionAck(state, "w1", "s1")).toBe(completion.completionId);
	expect(
		selectReadyCompletionAck(
			{
				...state,
				markingUnreadWorkspaces: {
					w1: { candidates: { s1: completion.completionId }, attendedSessionId: null },
				},
			},
			"w1",
			"s1",
		),
	).toBeNull();
	expect(
		selectReadyCompletionAck(
			{
				...state,
				markingUnreadWorkspaces: { w1: { candidates: { s1: "older" }, attendedSessionId: null } },
			},
			"w1",
			"s1",
		),
	).toBe(completion.completionId);
	const mark = { workspaceId: "w1", completionId: completion.completionId, held: true };
	expect(
		selectReadyCompletionAck({ ...state, markedUnreadBySession: { s1: mark } }, "w1", "s1"),
	).toBeNull();
	expect(
		selectReadyCompletionAck(
			{ ...state, markedUnreadBySession: { s1: { ...mark, held: false } } },
			"w1",
			"s1",
		),
	).toBe(completion.completionId);
	expect(
		selectReadyCompletionAck(
			{ ...state, markedUnreadBySession: { s1: { ...mark, completionId: "older" } } },
			"w1",
			"s1",
		),
	).toBe(completion.completionId);
	expect(
		selectReadyCompletionAck(
			{ ...state, renderedCompletionBySession: { s1: "older" } },
			"w1",
			"s1",
		),
	).toBeNull();
	expect(selectReadyCompletionAck({ ...state, status: "disconnected" }, "w1", "s1")).toBeNull();
	expect(
		selectReadyCompletionAck(
			{ ...state, sessions: { s1: { ...state.sessions.s1, syncedConnectionGeneration: 3 } } },
			"w1",
			"s1",
		),
	).toBeNull();
	const read = { ...hostState, completionUnread: false };
	expect(
		selectReadyCompletionAck(
			{
				...state,
				sessionStateByWorkspace: {
					w1: { s1: { sessionId: "s1", workspaceId: "w1", projectId: "p1", state: read } },
				},
			},
			"w1",
			"s1",
		),
	).toBeNull();
});

test("a chat is attended only as the selected tab of the last-focused center group in the active workspace", () => {
	const chat = (id: string, sessionId: string) => ({
		kind: "chat" as const,
		id,
		name: id,
		sessionId,
	});
	const state = {
		activeWorkspaceId: "w1",
		obscuredChatSessions: {},
		historyOpenRequest: null,
		layoutDocumentsByWorkspace: {
			w1: {
				center: {
					kind: "split" as const,
					id: "split",
					orientation: "horizontal" as const,
					ratio: 0.5,
					children: [
						{ kind: "group" as const, id: "left", tabs: [chat("t-a", "a")] },
						{ kind: "group" as const, id: "right", tabs: [chat("t-b", "b"), chat("t-c", "c")] },
					],
				},
			},
		},
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: { left: "t-a", right: "t-b" },
				lastFocusedCenterGroupId: "right",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: {},
			},
		},
	} as unknown as Parameters<typeof selectChatAttended>[0];
	expect(selectChatAttended(state, "w1", "b")).toBe(true);
	expect(selectChatAttended(state, "w1", "a")).toBe(false);
	expect(selectChatAttended(state, "w1", "c")).toBe(false);
	expect(selectChatAttended({ ...state, activeWorkspaceId: "w2" }, "w1", "b")).toBe(false);
	expect(selectChatAttended({ ...state, obscuredChatSessions: { b: true } }, "w1", "b")).toBe(
		false,
	);
	expect(selectChatAttended({ ...state, historyOpenRequest: { sessionId: "b" } }, "w1", "b")).toBe(
		false,
	);
	expect(selectChatAttended({ ...state, historyOpenRequest: { sessionId: "a" } }, "w1", "b")).toBe(
		true,
	);
});

test("workspace kind predicates distinguish managed and user-owned checkouts", () => {
	const managed = {};
	const external = { kind: "external" as const };
	const defaultWorkspace = { kind: "default" as const };

	expect(isDefaultWorkspace(defaultWorkspace)).toBe(true);
	expect(isExternalWorkspace(external)).toBe(true);
	expect(isUserOwnedWorkspace(managed)).toBe(false);
	expect(isUserOwnedWorkspace(defaultWorkspace)).toBe(true);
	expect(isUserOwnedWorkspace(external)).toBe(true);
});

test("layout placement lookup traverses recursive center and every auxiliary region", () => {
	const layout: WorkspaceLayoutDocument = {
		version: 2,
		center: {
			kind: "split",
			id: "split",
			direction: "horizontal",
			weights: [0.5, 0.5],
			children: [
				{ kind: "group", id: "a", tabs: [] },
				{
					kind: "group",
					id: "b",
					tabs: [{ kind: "file", id: "legacy-file-placement", name: "a", path: "a" }],
				},
			],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: {
			visible: true,
			width: 0.2,
			groups: [
				{
					id: "right",
					weight: 1,
					folded: false,
					tabs: [{ kind: "tool", id: "tool:files", name: "Files", tool: "files" }],
				},
			],
		},
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [
				{
					id: "bottom",
					weight: 1,
					folded: false,
					tabs: [
						{
							kind: "terminal",
							id: "bottom-terminal",
							name: "Terminal 1",
							tabKey: "terminal-1",
						},
					],
				},
			],
		},
		toolRestoreTargets: {},
	};
	const state = {
		layoutDocumentsByWorkspace: { ws: layout },
		layoutAttentionByWorkspace: {
			ws: {
				selectedByGroup: { b: "legacy-file-placement" },
				lastFocusedCenterGroupId: "b",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { a: 0, b: 0 },
			},
		},
		tabsByWorkspace: {
			ws: [
				{
					kind: "file" as const,
					id: "file:a",
					workspaceId: "ws",
					name: "a",
					path: "a",
					content: "",
				},
			],
		},
		terminalsByWorkspace: {},
	};
	expect(selectLayoutTabPlaced(state, "ws", "legacy-file-placement")).toBe(true);
	expect(selectLayoutTabPlacement(state, "ws", "legacy-file-placement")).toEqual({
		area: "center",
		groupId: "b",
	});
	expect(selectLayoutTabPlaced(state, "ws", "tool:files")).toBe(true);
	expect(selectLayoutTabPlacement(state, "ws", "bottom-terminal")).toEqual({
		area: "bottom",
		groupId: "bottom",
	});
	expect(
		selectLayoutResourcePlacement(state, "ws", {
			kind: "terminal",
			id: "another-placement-id",
			name: "Terminal",
			tabKey: "terminal-1",
		}),
	).toMatchObject({ area: "bottom", groupId: "bottom", tabId: "bottom-terminal" });
	expect(selectLayoutTabPlaced(state, "ws", "missing")).toBe(false);
	expect(selectAttentionCenterTab(state, "ws")?.id).toBe("legacy-file-placement");
	const cachedResource = state.tabsByWorkspace.ws[0];
	if (!cachedResource) throw new Error("missing editor cache fixture");
	expect(selectLayoutResourcePlacement(state, "ws", cachedResource)).toEqual({
		area: "center",
		groupId: "b",
		tabId: "legacy-file-placement",
		tab: { kind: "file", id: "legacy-file-placement", name: "a", path: "a" },
	});
	expect(selectAttentionCenterResourceReady(state, "ws")).toBe(true);
	expect(selectAttentionCenterResourceCacheKey(state, "ws")).toBe("file:a");
	state.tabsByWorkspace.ws[0] = { ...cachedResource, id: "legacy-file-placement" };
	expect(selectAttentionCenterResourceCacheKey(state, "ws")).toBe("legacy-file-placement");
});

test("registered documents participate in legacy selection readiness", () => {
	const layout: WorkspaceLayoutDocument = {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [
				{
					kind: "document",
					id: "shared-todo",
					name: "TODO",
					documentKind: "todo-plan",
					sourceId: "session",
					docPath: "TODO.md",
				},
			],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
	const state = {
		layoutDocumentsByWorkspace: { ws: layout },
		layoutAttentionByWorkspace: {
			ws: {
				selectedByGroup: { center: "shared-todo" },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 0 },
			},
		},
		tabsByWorkspace: {
			ws: [
				{
					kind: "doc" as const,
					id: "local-todo",
					workspaceId: "ws",
					name: "TODO",
					content: "",
					docPath: "TODO.md",
					sourceId: "session",
				},
			],
		},
		terminalsByWorkspace: {},
	};
	expect(selectAttentionCenterResourceReady(state, "ws")).toBe(true);
	expect(selectAttentionCenterResourceCacheKey(state, "ws")).toBe("local-todo");
});

test("active workspace selectors resolve the workspace and its owning project", () => {
	const state = { activeWorkspaceId: "w2", workspaces };

	expect(selectActiveWorkspace(state)).toBe(workspace);
	expect(selectActiveWorkspaceProjectId(state)).toBe("p2");
});

test("active workspace selectors return null when the workspace is absent", () => {
	const state = { activeWorkspaceId: "missing", workspaces };

	expect(selectActiveWorkspace(state)).toBeNull();
	expect(selectActiveWorkspaceProjectId(state)).toBeNull();
});

test("context project prefers the active workspace owner", () => {
	expect(
		selectContextProject({
			activeWorkspaceId: "w2",
			selectedProjectId: "p1",
			projects,
			workspaces,
		}),
	).toBe(projects[1]);
});

test("context project falls back to the selected Project Home", () => {
	expect(
		selectContextProject({
			activeWorkspaceId: null,
			selectedProjectId: "p1",
			projects,
			workspaces,
		}),
	).toBe(projects[0]);
});

test("selectSkillsStale is a strict tick comparison, defaulting missing ticks to 0", () => {
	const stale = { skillChangeTickByWorkspace: { w: 2 }, skillsSyncedTickBySession: { s: 1 } };
	expect(selectSkillsStale(stale, "w", "s")).toBe(true);
	const synced = { skillChangeTickByWorkspace: { w: 2 }, skillsSyncedTickBySession: { s: 2 } };
	expect(selectSkillsStale(synced, "w", "s")).toBe(false);
	expect(
		selectSkillsStale(
			{ skillChangeTickByWorkspace: { w: 1 }, skillsSyncedTickBySession: {} },
			"w",
			"s",
		),
	).toBe(true);
	expect(
		selectSkillsStale({ skillChangeTickByWorkspace: {}, skillsSyncedTickBySession: {} }, "w", "s"),
	).toBe(false);
});

const chat1: EditorTab = {
	kind: "chat",
	id: "w2:s1",
	workspaceId: "w2",
	name: "One",
	sessionId: "s1",
};
const chat2: EditorTab = {
	kind: "chat",
	id: "w2:s2",
	workspaceId: "w2",
	name: "Two",
	sessionId: "s2",
};
const fileTab: EditorTab = {
	kind: "file",
	id: "w2:src/a.ts",
	workspaceId: "w2",
	name: "a.ts",
	path: "src/a.ts",
};

test("selectKnownChatLocation resolves open and history chats without guessing unknown sessions", () => {
	const state = {
		tabsByWorkspace: { w2: [fileTab, chat1] },
		closedChatsByWorkspace: {
			w3: [{ sessionId: "closed-session", title: "Closed chat", closedAt: 1 }],
		},
	};
	expect(selectKnownChatLocation(state, "s1")).toEqual({ workspaceId: "w2", title: "One" });
	expect(selectKnownChatLocation(state, "closed-session")).toEqual({
		workspaceId: "w3",
		title: "Closed chat",
	});
	expect(selectKnownChatLocation(state, "other-client-session")).toBeNull();
});

test("selectActiveEditorTab resolves the mirrored render-cache selection", () => {
	const legacyPlacement: EditorTab = { ...fileTab, id: "legacy-stable-placement" };
	const tabs = [fileTab, legacyPlacement];
	expect(
		selectActiveEditorTab(
			{ tabsByWorkspace: { w2: tabs }, activeTabByWorkspace: { w2: "legacy-stable-placement" } },
			"w2",
		),
	).toBe(tabs[1]);
});

test("selectHistoryTarget prefers the active chat tab", () => {
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w2",
			tabsByWorkspace: { w2: [chat1, chat2, fileTab] },
			activeTabByWorkspace: { w2: "w2:s1" },
		}),
	).toEqual({ workspaceId: "w2", tabId: "w2:s1", sessionId: "s1" });
});

test("selectHistoryTarget falls back to the newest chat tab when a non-chat tab is active", () => {
	for (const activeTabId of ["w2:src/a.ts", null]) {
		expect(
			selectHistoryTarget({
				activeWorkspaceId: "w2",
				tabsByWorkspace: { w2: [chat1, chat2, fileTab] },
				activeTabByWorkspace: { w2: activeTabId },
			}),
		).toEqual({ workspaceId: "w2", tabId: "w2:s2", sessionId: "s2" });
	}
});

test("selectHistoryTarget is null only with no chat to open", () => {
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w2",
			tabsByWorkspace: { w2: [fileTab] },
			activeTabByWorkspace: { w2: "w2:src/a.ts" },
		}),
	).toBeNull();
	expect(
		selectHistoryTarget({
			activeWorkspaceId: null,
			tabsByWorkspace: { w2: [chat1] },
			activeTabByWorkspace: { w2: "w2:s1" },
		}),
	).toBeNull();
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w1",
			tabsByWorkspace: { w2: [chat1] },
			activeTabByWorkspace: { w1: "w2:s1" },
		}),
	).toBeNull();
});

test("matchesWorktreePath accepts the relative form and an absolute report, anchored at a separator", () => {
	expect(matchesWorktreePath("src/foo.ts", "src/foo.ts")).toBe(true);
	expect(matchesWorktreePath("/wt/src/foo.ts", "src/foo.ts")).toBe(true);
	expect(matchesWorktreePath("C:\\wt\\src/foo.ts", "src/foo.ts")).toBe(true);
	expect(matchesWorktreePath("/wt/src/a-foo.ts", "src/foo.ts")).toBe(false);
	expect(matchesWorktreePath("src/other.ts", "src/foo.ts")).toBe(false);
	expect(matchesWorktreePath("./src/foo.ts", "src/foo.ts")).toBe(true);
});

test("matchesWorktreePath does not let a RELATIVE report match a shorter entry by suffix", () => {
	expect(matchesWorktreePath("module-b/SPEC.md", "SPEC.md")).toBe(false);
	expect(matchesWorktreePath("packages/server/SPEC.md", "SPEC.md")).toBe(false);
	expect(matchesWorktreePath("/wt/ws/SPEC.md", "SPEC.md")).toBe(true);
});

test("specPathMatcher recognizes a spec by graph membership, in either reported form", () => {
	const nodes = [
		{
			id: "task-x",
			type: "task-spec",
			title: "X",
			path: ".thinkrail/context/TASK-x.md",
			dependsOn: [],
			references: [],
			implements: [],
			tags: [],
		},
	];
	const isSpec = specPathMatcher(nodes);

	expect(isSpec(".thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("/wt/ws/.thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("packages/server/src/todos/todos.ts")).toBe(false);
	expect(specPathMatcher([])(".thinkrail/context/TASK-x.md")).toBe(false);
});

const catalogModel = (
	provider: string,
	id: string,
	thinkingLevels: WireModel["thinkingLevels"],
) => ({
	id,
	name: id,
	provider,
	contextWindow: 200_000,
	reasoning: thinkingLevels.length > 1,
	thinkingLevels,
});

test("selectCatalogModel matches on {provider,id} — an id alone is ambiguous across providers", () => {
	const bedrock = catalogModel("bedrock", "opus-5", ["off", "medium"]);
	const anthropic = catalogModel("anthropic", "opus-5", ["off", "high"]);
	expect(selectCatalogModel([bedrock, anthropic], { provider: "anthropic", id: "opus-5" })).toBe(
		anthropic,
	);
	expect(selectCatalogModel([bedrock, anthropic], null)).toBeNull();
});

test("selectCatalogModel returns the LIVE entry, not the stale ref handed to it", () => {
	const stale = catalogModel("anthropic", "opus-5", ["off", "low"]);
	const live = catalogModel("anthropic", "opus-5", ["off", "low", "medium", "high"]);
	expect(selectCatalogModel([live], stale)?.thinkingLevels).toEqual(live.thinkingLevels);
});

test("selectCatalogModel is null when the ref left the catalog (caller keeps its snapshot)", () => {
	const gone = catalogModel("anthropic", "opus-4", ["off"]);
	expect(selectCatalogModel([catalogModel("anthropic", "opus-5", ["off"])], gone)).toBeNull();
});

test("selectAgentReviewCommentCount counts only OPEN agent-authored comments", () => {
	const state = {
		reviewsByWorkspace: {
			w1: {
				comments: [
					{ status: "draft", author: "agent" }, // open agent finding
					{ status: "sent", author: "agent" }, // open (sent to worker) agent finding
					{ status: "resolved", author: "agent" }, // closed → excluded
					{ status: "dismissed", author: "agent" }, // closed → excluded
					{ status: "draft", author: "user" }, // human comment → excluded
					{ status: "draft" }, // author absent (human default) → excluded
				],
			},
		},
	};
	expect(selectAgentReviewCommentCount(state, "w1")).toBe(2);
	expect(selectAgentReviewCommentCount(state, "missing")).toBe(0);
	expect(selectAgentReviewCommentCount(state, null)).toBe(0);
});

describe("selectSupportsModelPicker", () => {
	test("requires a connected host at or above the picker protocol", () => {
		expect(selectSupportsModelPicker({ protocolVersion: null })).toBe(false);
		expect(selectSupportsModelPicker({ protocolVersion: MODEL_PICKER_PROTOCOL_VERSION - 1 })).toBe(
			false,
		);
		expect(selectSupportsModelPicker({ protocolVersion: MODEL_PICKER_PROTOCOL_VERSION })).toBe(
			true,
		);
	});
});

describe("file change signal", () => {
	const batch = (paths: string[], truncated = false) => ({ tick: 1, paths, truncated });

	test("a truncated or pathless batch means anything may have changed", () => {
		expect(fsChangedPaths(batch(["a.html"]))).toEqual(["a.html"]);
		expect(fsChangedPaths(batch(["a.html"], true))).toBeNull();
		expect(fsChangedPaths(batch([]))).toBeNull();
	});

	test("a new connection reports anything; an untouched workspace reports nothing", () => {
		const previous = { connectionGeneration: 1, fsChangesByWorkspace: { ws: batch(["a.html"]) } };
		expect(selectFileChangeSince(previous, previous, "ws")).toBeUndefined();
		expect(
			selectFileChangeSince({ ...previous, connectionGeneration: 2 }, previous, "ws"),
		).toBeNull();
		const next = { ...previous, fsChangesByWorkspace: { ws: batch(["b.html"]) } };
		expect(selectFileChangeSince(next, previous, "ws")).toEqual(["b.html"]);
		expect(selectFileChangeSince(next, previous, "other")).toBeUndefined();
	});
});

test("the host-named default workspace shows in the interface language until it is renamed", () => {
	applyLocale("de", { de: { "store.workspace.defaultName": "Standard" } });
	try {
		const t = currentTranslator();
		expect(workspaceName(t, { kind: "default", name: "Default" })).toBe("Standard");
		expect(workspaceName(t, { kind: "default", name: "Main checkout" })).toBe("Main checkout");
		expect(workspaceName(t, { name: "Default" })).toBe("Default");
	} finally {
		applyLocale("en", {});
	}
});

describe("the first prompt of an unnamed chat", () => {
	const quiet: SessionState = {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
	};
	const record = (sessionId: string, firstPrompt?: string): SessionStateRecord => ({
		sessionId,
		projectId: "p1",
		workspaceId: "w1",
		state: quiet,
		...(firstPrompt ? { firstPrompt } : {}),
	});
	const userTurn = (text: string) => ({
		kind: "user" as const,
		id: `turn-${text}`,
		message: { role: "user" as const, content: text, timestamp: 1 },
	});
	const chatTab = (sessionId: string, name: string): EditorTab => ({
		kind: "chat",
		id: `chat:w1:${sessionId}`,
		workspaceId: "w1",
		name,
		sessionId,
	});

	test("prefers the host's record, then the closed-chat summary, then the loaded runtime's turns", () => {
		const state = {
			sessions: {
				s1: { ...EMPTY_RUNTIME, turns: [userTurn("From the runtime")] },
				s2: { ...EMPTY_RUNTIME, turns: [userTurn("Only the runtime knows")] },
				s4: {
					...EMPTY_RUNTIME,
					turns: [userTurn('<review id="r" branch="b" base="c" comments="0">')],
				},
				s5: {
					...EMPTY_RUNTIME,
					turns: [
						userTurn('<review id="r" branch="b" base="c" comments="0">'),
						userTurn("/skill:brainstorming A later real prompt"),
					],
				},
			},
			sessionStateByWorkspace: {
				w1: {
					s1: record("s1", "From the record"),
					s2: record("s2"),
					s6: record("s6", "Pushed after a peer created it"),
				},
			},
			closedChatsByWorkspace: {
				w1: [
					{ sessionId: "s3", title: "", firstPrompt: "From the closed summary", closedAt: 1 },
					{ sessionId: "s6", title: "", closedAt: 2 },
				],
			},
		};
		expect(selectChatFirstPrompt(state, "w1", "s1")).toBe("From the record");
		expect(selectChatFirstPrompt(state, "w1", "s2")).toBe("Only the runtime knows");
		expect(selectChatFirstPrompt(state, "w1", "s3")).toBe("From the closed summary");
		expect(selectChatFirstPrompt(state, "w1", "s4")).toBeUndefined();
		expect(selectChatFirstPrompt(state, "w1", "s5")).toBe("A later real prompt");
		expect(selectChatFirstPrompt(state, "w1", "s6")).toBe("Pushed after a peer created it");
		expect(selectChatFirstPrompt(state, "w1", "unknown")).toBeUndefined();
	});

	test("a chat workspace reads its conversation's first prompt", () => {
		const state = {
			sessions: {},
			sessionStateByWorkspace: { chat1: { s1: { ...record("s1"), workspaceId: "chat1" } } },
			closedChatsByWorkspace: {},
		};
		expect(selectChatWorkspaceFirstPrompt(state, "chat1")).toBeUndefined();
		state.sessionStateByWorkspace.chat1.s1 = {
			...record("s1", "Plan the trip"),
			workspaceId: "chat1",
		};
		expect(selectChatWorkspaceFirstPrompt(state, "chat1")).toBe("Plan the trip");
		expect(selectChatWorkspaceFirstPrompt(state, "missing")).toBeUndefined();
	});

	test("titles and tab labels fall back to the prompt only while the chat has no name", () => {
		const t = currentTranslator();
		const planTab: EditorTab = {
			kind: "plan",
			id: "plan:w1:s4",
			workspaceId: "w1",
			name: "",
			sessionId: "s4",
		};
		const state = {
			tabsByWorkspace: {
				w1: [chatTab("s1", ""), chatTab("s2", "Named by the agent"), chatTab("s3", ""), planTab],
			},
			sessions: {},
			sessionStateByWorkspace: {
				w1: {
					s1: record("s1", "Fix the login redirect"),
					s2: record("s2", "Please rename me"),
					s4: record("s4", "Plan this one"),
				},
			},
			closedChatsByWorkspace: {},
		};
		expect(selectChatTitle(t, state, "w1", "s1")).toBe("Fix the login redirect");
		expect(selectChatTitle(t, state, "w1", "s2")).toBe("Named by the agent");
		expect(selectChatTitle(t, state, "w1", "s3")).toBe("Chat");
		expect(selectUnnamedChatFirstPrompts(state, "w1")).toEqual({
			s1: "Fix the login redirect",
			s4: "Plan this one",
		});
	});
});
