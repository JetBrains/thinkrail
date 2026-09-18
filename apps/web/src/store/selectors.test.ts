import { expect, test } from "bun:test";
import type { Project, SessionStateRecord, WireModel, Workspace } from "@thinkrail/contracts";
import type { WorkspaceLayoutDocument } from "../shell/layout";
import { type EditorTab, EMPTY_RUNTIME } from "./appStore";
import {
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
	selectContextProject,
	selectHistoryTarget,
	selectKnownChatLocation,
	selectLayoutResourcePlacement,
	selectLayoutTabPlaced,
	selectLayoutTabPlacement,
	selectProjectIsRunning,
	selectProjectNeedsAttention,
	selectProjectSessionPresentation,
	selectReadyCompletionActivation,
	selectSkillsStale,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspaceSessionPresentation,
	sessionPresentation,
	specPathMatcher,
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

test("normalized session presentation keeps needs-input above finished above ambient working", () => {
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
	};
	const working = { ...quiet, execution: "running" as const, runId: "run-working" };
	const finished = {
		...quiet,
		runId: "run-finished",
		completion: { completionId: "done", outcome: "succeeded" as const },
		completionUnread: true,
	};
	const needsInput = {
		...working,
		needsInput: { interactionId: "question:q1", kind: "question" as const },
	};
	const state = {
		sessionStateByWorkspace: {
			w1: {
				a: record("a", "p1", "w1", working),
				b: record("b", "p1", "w1", finished),
			},
			w2: { c: record("c", "p1", "w2", needsInput) },
			w3: { d: record("d", "p2", "w3", quiet) },
		},
	};
	expect(sessionPresentation(working)).toBe("working");
	expect(selectWorkspaceSessionPresentation(state, "w1")).toBe("finished");
	expect(selectWorkspaceNeedsAttention(state, "w1")).toBe(true);
	expect(selectWorkspaceIsRunning(state, "w1")).toBe(true);
	expect(selectWorkspaceNeedsAttention(state, "w2")).toBe(true);
	expect(selectWorkspaceIsRunning(state, "w2")).toBe(true);
	expect(selectProjectSessionPresentation(state, "p1")).toBe("needs_input");
	expect(selectProjectNeedsAttention(state, "p1")).toBe(true);
	expect(selectProjectIsRunning(state, "p1")).toBe(true);
	expect(selectProjectSessionPresentation(state, "p2")).toBe("quiet");
});

test("completion acknowledgement requires exact render, current connection, and later direct activation", () => {
	const completion = { completionId: "completion:a1", outcome: "succeeded" as const };
	const hostState = {
		execution: "idle" as const,
		runId: "u1",
		needsInput: null,
		completion,
		completionUnread: true,
		queuedCount: 0,
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
		sessionStateTickBySession: { s1: 8 },
		directChatActivationTickBySession: { s1: 9 },
		renderedCompletionBySession: { s1: completion.completionId },
		renderedCompletionTickBySession: { s1: 8 },
	};
	expect(selectReadyCompletionActivation(state, "w1", "s1")).toBe(completion.completionId);
	expect(
		selectReadyCompletionActivation(
			{ ...state, directChatActivationTickBySession: { s1: 8 } },
			"w1",
			"s1",
		),
	).toBeNull();
	expect(
		selectReadyCompletionActivation(
			{ ...state, renderedCompletionTickBySession: { s1: 10 } },
			"w1",
			"s1",
		),
	).toBeNull();
	expect(
		selectReadyCompletionActivation(
			{ ...state, renderedCompletionBySession: { s1: "older" } },
			"w1",
			"s1",
		),
	).toBeNull();
	expect(
		selectReadyCompletionActivation({ ...state, status: "disconnected" }, "w1", "s1"),
	).toBeNull();
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
