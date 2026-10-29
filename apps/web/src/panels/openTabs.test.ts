import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { changesTabId, diffTabId } from "./changesModel";

let pending: { resolve: (value: unknown) => void } | null = null;
const requests: { method: string; params: unknown }[] = [];
const diffResult = (original: string, modified: string) => ({
	original,
	modified,
	originalOid: "0123456789abcdef0123456789abcdef01234567",
	meta: {
		original: { hash: "original", byteLength: original.length, text: true },
		modified: { hash: "modified", byteLength: modified.length, text: true },
	},
});
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
const { openChangesTab, openDiffInTab, openFileAtLine } = await import("./openTabs");

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	id: "w1",
	projectId: "p1",
	name: "workspace-1",
	branch: "workspace-1",
	worktreePath: "/wt/w1",
	baseBranch: "main",
	...overrides,
});

function resetStore(): void {
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
		previewTabByWorkspace: {},
	});
}

beforeEach(resetStore);
afterAll(resetStore);

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

	pending?.resolve(diffResult("old", "new"));
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main");
	expect(tab.loadedTick).toBe(0);
});

test("a single click on an uncached file opens its preview as soon as the read resolves", async () => {
	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	pending?.resolve(diffResult("old", "new"));
	await preview;

	const tab = openedDiffTab();
	expect(useAppStore.getState().previewTabByWorkspace.w1).toBe(tab.id);
});

test("a dblclick arriving while the read is in flight publishes only the final keep intent", async () => {
	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	const keep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	pending?.resolve(diffResult("old", "new"));
	await Promise.all([preview, keep]);

	expect(requests).toHaveLength(1);
	const opens = useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open" && intent.workspaceId === "w1");
	expect(opens).toHaveLength(1);
	expect(opens[0]).toMatchObject({ kind: "open", intent: "keep", claimPreview: true });
});

test("a second open at a line while the file's read is in flight waits for it and reveals last", async () => {
	const first = openFileAtLine("w1", "src/a.ts", { line: 3 }, "keep");
	const second = openFileAtLine("w1", "src/a.ts", { line: 20, column: 2, length: 4 }, "keep");
	expect(requests.map((request) => request.method)).toEqual(["fs.readFile"]);
	pending?.resolve({
		content: { kind: "text", text: "x" },
		meta: { hash: "h", byteLength: 1, text: true },
	});
	await Promise.all([first, second]);

	const tabs = useAppStore.getState().tabsByWorkspace.w1 ?? [];
	expect(tabs).toHaveLength(1);
	const [tab] = tabs;
	expect(tab?.kind === "file" && tab.reveal).toEqual({ line: 20, column: 2, length: 4, tick: 2 });
});

const cacheKeptDiffTab = () => {
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
	return openedDiffTab();
};

const openIntents = () =>
	useAppStore
		.getState()
		.layoutIntents.filter((intent) => intent.kind === "open" && intent.workspaceId === "w1");

test("a cached preview opens synchronously, before any await", () => {
	const cached = cacheKeptDiffTab();
	void openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");

	expect(requests).toHaveLength(0);
	expect(openIntents()).toEqual([expect.objectContaining({ intent: "preview", tab: cached })]);
});

test("a cached double click previews, then keeps the same tab with its latest content", async () => {
	const cached = cacheKeptDiffTab();
	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	useAppStore
		.getState()
		.updateDiffTabContent(
			"w1",
			cached.id,
			"fresh old",
			"fresh new",
			undefined,
			undefined,
			1,
			"main",
		);
	const keep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	await Promise.all([preview, keep]);

	expect(requests).toHaveLength(0);
	const opens = openIntents();
	expect(opens).toHaveLength(2);
	expect(opens[0]).toMatchObject({ intent: "preview", tab: { id: cached.id } });
	expect(opens[1]).toMatchObject({
		intent: "keep",
		tab: { id: cached.id, original: "fresh old", modified: "fresh new", loadedTick: 1 },
	});
	expect(useAppStore.getState().tabsByWorkspace.w1).toHaveLength(1);
});

test("a keep after a landed preview promotes the same tab in place", async () => {
	const preview = openDiffInTab("w1", { kind: "branch" }, "README.md", "preview");
	pending?.resolve(diffResult("old", "new"));
	await preview;
	const previewed = openedDiffTab();
	await openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");

	const state = useAppStore.getState();
	expect(requests).toHaveLength(1);
	expect(state.tabsByWorkspace.w1?.map((tab) => tab.id)).toEqual([previewed.id]);
	expect(state.previewTabByWorkspace.w1).toBeUndefined();
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
	resolveNewer?.(diffResult("old notes", "new notes"));
	await newerPreview;
	resolveFirst?.(diffResult("old readme", "new readme"));
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
	pending?.resolve(diffResult("old", "new"));
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
	pending?.resolve(diffResult("stale old", "stale new"));
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
	pending?.resolve(diffResult("old", "new"));
	await open;

	const tab = openedDiffTab();
	expect(tab.loadedTarget).toBe("main");
	expect(tab.loadedTick).toBe(1);
});

const openedChangesTab = () => {
	const tab = (useAppStore.getState().tabsByWorkspace.w1 ?? []).find(
		(candidate) => candidate.kind === "changes",
	);
	if (tab?.kind !== "changes") throw new Error("no changes tab opened");
	return tab;
};

test("a review tab opens without a host read and carries the clicked file as a one-shot reveal", async () => {
	await openChangesTab("w1", { kind: "branch" }, { revealPath: "/wt/w1/src/a.ts" }, "keep");
	expect(requests).toHaveLength(0);
	const tab = openedChangesTab();
	expect(tab).toMatchObject({
		id: changesTabId("w1", { kind: "branch" }),
		name: "",
		scope: { kind: "branch" },
		reveal: { path: "src/a.ts", tick: 1 },
		viewed: [],
	});
	expect(useAppStore.getState().activeTabByWorkspace.w1).toBe(tab.id);
});

test("re-opening the review tab keeps its review progress and only bumps the reveal", async () => {
	await openChangesTab("w1", { kind: "branch" }, { revealPath: "src/a.ts" }, "keep");
	const tab = openedChangesTab();
	useAppStore.getState().setChangesTabViewed("w1", tab.id, "src/a.ts", true);
	useAppStore.getState().setChangesTabCollapsed("w1", tab.id, { "bun.lock": false });
	useAppStore.getState().consumeChangesTabReveal("w1", tab.id, null);

	await openChangesTab("w1", { kind: "branch" }, { revealPath: "src/b.ts" }, "keep");
	expect(
		useAppStore.getState().tabsByWorkspace.w1?.filter((t) => t.kind === "changes"),
	).toHaveLength(1);
	expect(openedChangesTab()).toMatchObject({
		viewed: ["src/a.ts"],
		collapsed: { "bun.lock": false },
		reveal: { path: "src/b.ts", tick: 1 },
	});

	await openChangesTab("w1", { kind: "branch" }, { revealPath: "src/b.ts" }, "keep");
	expect(openedChangesTab().reveal).toEqual({ path: "src/b.ts", tick: 2 });
	await openChangesTab("w1", { kind: "branch" }, {}, "keep");
	expect(openedChangesTab().reveal).toEqual({ path: "src/b.ts", tick: 2 });
});

test("a Changes double click replaces an earlier preview with its kept per-file tab", async () => {
	useAppStore.getState().openTab(
		{
			kind: "file",
			id: "old-preview",
			workspaceId: "w1",
			name: "old.txt",
			path: "old.txt",
			content: "old",
		},
		"preview",
	);
	const preview = openChangesTab("w1", { kind: "branch" }, { revealPath: "README.md" }, "preview");
	const keep = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep", undefined, {
		claimPreview: true,
	});
	pending?.resolve(diffResult("old", "new"));
	await Promise.all([preview, keep]);

	const tabs = useAppStore.getState().tabsByWorkspace.w1 ?? [];
	expect(tabs.map((tab) => tab.kind)).toEqual(["diff"]);
	expect(useAppStore.getState().previewTabByWorkspace.w1).toBeUndefined();
});

test("an explicit Open as tab retains the existing preview", async () => {
	useAppStore.getState().openTab(
		{
			kind: "file",
			id: "old-preview",
			workspaceId: "w1",
			name: "old.txt",
			path: "old.txt",
			content: "old",
		},
		"preview",
	);
	const open = openDiffInTab("w1", { kind: "branch" }, "README.md", "keep");
	pending?.resolve(diffResult("old", "new"));
	await open;
	expect(useAppStore.getState().tabsByWorkspace.w1?.map((tab) => tab.kind)).toEqual([
		"file",
		"diff",
	]);
	expect(useAppStore.getState().previewTabByWorkspace.w1).toBe("old-preview");
});

test("a lone review-tab preview lands after the settle window and claims the preview slot", async () => {
	await openChangesTab("w1", { kind: "uncommitted" }, { revealPath: "README.md" }, "preview");
	const tab = openedChangesTab();
	expect(tab.scope).toEqual({ kind: "uncommitted" });
	expect(useAppStore.getState().previewTabByWorkspace.w1).toBe(tab.id);
});

test("a removed workspace rejects a late review-tab request", async () => {
	useAppStore.setState({ removedWorkspaceIds: { w1: true } });
	await openChangesTab("w1", { kind: "branch" }, {}, "keep");
	expect(useAppStore.getState().tabsByWorkspace.w1 ?? []).toHaveLength(0);
});
