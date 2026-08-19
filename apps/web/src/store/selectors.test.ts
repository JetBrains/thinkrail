import { expect, test } from "bun:test";
import type { Project, WireModel, Workspace, WorkspaceLayoutDocument } from "@thinkrail/contracts";
import type { EditorTab } from "./appStore";
import {
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	isUserOwnedWorkspace,
	matchesWorktreePath,
	selectActiveEditorTab,
	selectActiveWorkspace,
	selectActiveWorkspaceProjectId,
	selectAttentionCenterResourceCacheKey,
	selectAttentionCenterResourceReady,
	selectAttentionCenterTab,
	selectCatalogModel,
	selectContextProject,
	selectHistoryTarget,
	selectLayoutResourcePlacement,
	selectLayoutTabPlaced,
	selectLayoutTabPlacement,
	selectSkillsStale,
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

test("layout placement lookup traverses recursive center and side groups", () => {
	const layout: WorkspaceLayoutDocument = {
		version: 1,
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
	// A synchronized placement keeps its stable id while the browser cache uses its own canonical id.
	expect(selectAttentionCenterResourceReady(state, "ws")).toBe(true);
	expect(selectAttentionCenterResourceCacheKey(state, "ws")).toBe("file:a");
	state.tabsByWorkspace.ws[0] = { ...cachedResource, id: "legacy-file-placement" };
	expect(selectAttentionCenterResourceCacheKey(state, "ws")).toBe("legacy-file-placement");
});

test("registered documents participate in legacy selection readiness", () => {
	const layout: WorkspaceLayoutDocument = {
		version: 1,
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
	// Synced at or past the last skill change → not stale.
	const synced = { skillChangeTickByWorkspace: { w: 2 }, skillsSyncedTickBySession: { s: 2 } };
	expect(selectSkillsStale(synced, "w", "s")).toBe(false);
	// A skill change with no recorded sync (→ 0) is stale; nothing recorded at all is not.
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

// The shell swallows Ctrl+R app-wide, so "which chat did that mean" has to be answerable from store state
// alone — and must resolve to SOMETHING whenever the workspace has a chat at all, or the chord silently
// dies over a file/diff tab.
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
	// The regression this guards: returning null here made Ctrl+R a silent no-op over Monaco/diffs —
	// exactly the tabs the app-wide swallow exists to cover. `chat2` is last in open order, so it wins.
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
	// No chat tab in the workspace at all.
	expect(
		selectHistoryTarget({
			activeWorkspaceId: "w2",
			tabsByWorkspace: { w2: [fileTab] },
			activeTabByWorkspace: { w2: "w2:src/a.ts" },
		}),
	).toBeNull();
	// No active workspace.
	expect(
		selectHistoryTarget({
			activeWorkspaceId: null,
			tabsByWorkspace: { w2: [chat1] },
			activeTabByWorkspace: { w2: "w2:s1" },
		}),
	).toBeNull();
	// Another workspace's chats are never reachable through the active one.
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
	// Anchored: a sibling whose name merely ends with the entry must not match.
	expect(matchesWorktreePath("/wt/src/a-foo.ts", "src/foo.ts")).toBe(false);
	expect(matchesWorktreePath("src/other.ts", "src/foo.ts")).toBe(false);
	// A `./`-prefixed report is the same file (the old suffix rule absorbed the prefix by accident; the
	// anchored rule would drop it, so `normalizePath` strips it for every predicate).
	expect(matchesWorktreePath("./src/foo.ts", "src/foo.ts")).toBe(true);
});

test("matchesWorktreePath does not let a RELATIVE report match a shorter entry by suffix", () => {
	// The suffix rule exists to absorb an absolute report; letting it apply to relative ones made every
	// `<module>/SPEC.md` in a repo match the ROOT `SPEC.md` entry — one spec impersonating all of them.
	expect(matchesWorktreePath("module-b/SPEC.md", "SPEC.md")).toBe(false);
	expect(matchesWorktreePath("packages/server/SPEC.md", "SPEC.md")).toBe(false);
	// The absolute form of the same pair still resolves, since there the prefix IS the worktree root.
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
	// An empty graph (never fetched) classifies nothing as a spec — the single-chip fallback.
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
	// The point of the selector: a session's model snapshot keeps whatever `thinkingLevels` it was
	// created with, so reading them off the snapshot would miss a `model.refresh`.
	const stale = catalogModel("anthropic", "opus-5", ["off", "low"]);
	const live = catalogModel("anthropic", "opus-5", ["off", "low", "medium", "high"]);
	expect(selectCatalogModel([live], stale)?.thinkingLevels).toEqual(live.thinkingLevels);
});

test("selectCatalogModel is null when the ref left the catalog (caller keeps its snapshot)", () => {
	const gone = catalogModel("anthropic", "opus-4", ["off"]);
	expect(selectCatalogModel([catalogModel("anthropic", "opus-5", ["off"])], gone)).toBeNull();
});
