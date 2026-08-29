import { beforeEach, expect, mock, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { diffTabId } from "./changesModel";

let pending: { resolve: (value: unknown) => void } | null = null;
const requests: { method: string; params: unknown }[] = [];
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return new Promise((resolve) => {
				pending = { resolve };
			});
		},
	}),
}));

const { useAppStore } = await import("../store");
type WorkspaceLayoutDocument = ReturnType<
	typeof useAppStore.getState
>["layoutDocumentsByWorkspace"][string];
const { openDiffInTab } = await import("./openTabs");

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	id: "w1",
	projectId: "p1",
	name: "workspace-1",
	branch: "workspace-1",
	worktreePath: "/wt/w1",
	baseBranch: "main",
	...overrides,
});

beforeEach(() => {
	pending = null;
	requests.length = 0;
	useAppStore.setState({
		workspaces: { p1: [workspace()] },
		removedWorkspaceIds: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutIntents: [],
		navTickByWorkspace: {},
		fsChangesByWorkspace: {},
	});
});

const openedDiffTab = () => {
	const tab = (useAppStore.getState().tabsByWorkspace.w1 ?? [])[0];
	if (tab?.kind !== "diff") throw new Error("no diff tab opened");
	return tab;
};

test("a diff tab is stamped with the target and tick captured BEFORE its read, not after", async () => {
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	expect(requests).toEqual([
		{
			method: "git.diffFile",
			params: { workspaceId: "w1", path: "README.md", scope: { kind: "branch" } },
		},
	]);

	useAppStore.getState().updateWorkspace(workspace({ diffBase: "develop" }));
	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["README.md"],
		truncated: false,
		skillChange: "none",
	});

	pending?.resolve({ original: "old", modified: "new" });
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main");
	expect(tab.loadedTick).toBe(0);
});

test("a fast leading click upgraded by dblclick publishes only the final keep intent", async () => {
	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	pending?.resolve({ original: "old", modified: "new" });
	await Promise.resolve();
	const keep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	await Promise.all([preview, keep]);

	expect(requests).toHaveLength(1);
	const opens = useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open" && intent.workspaceId === "w1");
	expect(opens).toHaveLength(1);
	expect(opens[0]).toMatchObject({ kind: "open", intent: "keep", claimPreview: true });
});

test("a cached double click also publishes only one final keep intent", async () => {
	useAppStore.getState().openTab(
		{
			kind: "diff",
			id: diffTabId("w1", { kind: "branch" }, "README.md"),
			workspaceId: "w1",
			name: "README.md",
			path: "README.md",
			scope: { kind: "branch" },
			original: "old",
			modified: "new",
			loadedTarget: "main",
		},
		"keep",
		false,
	);
	useAppStore.setState({ layoutIntents: [] });

	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	const cached = openedDiffTab();
	useAppStore.getState().updateDiffTabContent("w1", cached.id, "fresh old", "fresh new", 1, "main");
	const keep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	await Promise.all([preview, keep]);

	expect(requests).toHaveLength(0);
	const opens = useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open" && intent.workspaceId === "w1");
	expect(opens).toHaveLength(1);
	expect(opens[0]).toMatchObject({
		kind: "open",
		intent: "keep",
		claimPreview: true,
		tab: { kind: "diff", original: "fresh old", modified: "fresh new", loadedTick: 1 },
	});
});

test("an overtaken double click keeps its tab without claiming a newer preview slot", async () => {
	useAppStore.setState({
		activeWorkspaceId: "w1",
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: {},
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 0 },
			},
		},
	});
	const firstPreview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	const resolveFirst = pending?.resolve;
	const firstKeep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	const newerPreview = openDiffInTab("w1", { kind: "branch" }, "notes.txt", "preview");
	const resolveNewer = pending?.resolve;
	resolveNewer?.({ original: "old notes", modified: "new notes" });
	await newerPreview;
	resolveFirst?.({ original: "old readme", modified: "new readme" });
	await Promise.all([firstPreview, firstKeep]);

	const opens = useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open" && intent.workspaceId === "w1");
	const olderKeep = opens.find(
		(intent) =>
			intent.kind === "open" && intent.tab.kind === "diff" && intent.tab.path === "README.md",
	);
	expect(olderKeep).toMatchObject({ kind: "open", intent: "keep", activate: false });
	expect(olderKeep).not.toHaveProperty("claimPreview");
});

test("a deferred keep refreshes a semantically placed legacy cache without stealing focus", async () => {
	const placementId = "legacy-diff-placement";
	const layout: WorkspaceLayoutDocument = {
		version: 2,
		center: {
			kind: "split",
			id: "split",
			direction: "horizontal",
			weights: [0.5, 0.5],
			children: [
				{
					kind: "group",
					id: "a",
					tabs: [
						{
							kind: "diff",
							id: placementId,
							name: "README.md",
							path: "README.md",
							scope: { kind: "branch" },
						},
					],
				},
				{ kind: "group", id: "b", tabs: [] },
			],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
	useAppStore.setState({
		layoutDocumentsByWorkspace: { w1: layout },
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: { a: placementId },
				lastFocusedCenterGroupId: "b",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { a: 4, b: 2 },
			},
		},
		tabsByWorkspace: {
			w1: [
				{
					kind: "diff",
					id: placementId,
					workspaceId: "w1",
					name: "README.md",
					path: "README.md",
					scope: { kind: "branch" },
					original: "old",
					modified: "new",
					loadedTarget: "main",
				},
			],
		},
		activeTabByWorkspace: { w1: "something-else" },
		layoutIntents: [],
	});

	await openDiffInTab("w1", { kind: "branch" }, "README.md", "keep", {
		groupId: "a",
		clock: 4,
	});

	expect(requests).toHaveLength(0);
	expect(useAppStore.getState().activeTabByWorkspace.w1).toBe("something-else");
	expect(useAppStore.getState().layoutIntents).toHaveLength(1);
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "open",
		activate: false,
		targetGroupId: "a",
	});
});

test("a cache-id collision mints an alias instead of focusing an unrelated resource", async () => {
	const collidingId = diffTabId("w1", { kind: "branch" }, "README.md");
	useAppStore.setState({
		tabsByWorkspace: {
			w1: [
				{
					kind: "chat",
					id: collidingId,
					workspaceId: "w1",
					name: "Unrelated chat",
					sessionId: "chat",
				},
			],
		},
	});
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	pending?.resolve({ original: "old", modified: "new" });
	await open;

	const tabs = useAppStore.getState().tabsByWorkspace.w1 ?? [];
	expect(tabs.find((tab) => tab.kind === "chat")?.id).toBe(collidingId);
	const diff = tabs.find((tab) => tab.kind === "diff");
	expect(diff?.id).not.toBe(collidingId);
	expect(diff?.path).toBe("README.md");
});

test("a read settling after another cache install keeps the newer semantic cache", async () => {
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	useAppStore.getState().openTab(
		{
			kind: "diff",
			id: "peer-cache",
			workspaceId: "w1",
			name: "README.md",
			path: "README.md",
			scope: { kind: "branch" },
			original: "peer old",
			modified: "peer new",
			loadedTarget: "main",
			loadedTick: 3,
		},
		"keep",
		false,
	);
	pending?.resolve({ original: "stale old", modified: "stale new" });
	await open;

	const diff = openedDiffTab();
	expect(diff).toMatchObject({
		id: "peer-cache",
		original: "peer old",
		modified: "peer new",
		loadedTick: 3,
	});
	const intent = useAppStore
		.getState()
		.layoutIntents.find((candidate) => candidate.kind === "open" && candidate.tab.kind === "diff");
	expect(intent).toMatchObject({ tab: { id: "peer-cache", modified: "peer new" } });
});

test("a removed workspace rejects a late editor request before it reaches the host", async () => {
	useAppStore.setState({ removedWorkspaceIds: { w1: true } });
	await openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	expect(requests).toHaveLength(0);
});

test("an undisturbed open stamps the state it actually read against", async () => {
	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["other.ts"],
		truncated: false,
		skillChange: "none",
	});
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	pending?.resolve({ original: "old", modified: "new" });
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main");
	expect(tab.loadedTick).toBe(1);
});
