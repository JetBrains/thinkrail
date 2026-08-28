import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceLayoutDocument, WorkspaceLayoutSnapshot } from "@thinkrail/contracts";
import { useAppStore } from "../../store";
import {
	BUILTIN_LAYOUT_PRESETS,
	collectAllGroups,
	resizeBottomRegion,
	resizeSideRegion,
	toolTab,
} from "../layout";
import {
	applyLayoutPresetLocally,
	claimLayoutSurfaceId,
	commitWorkspaceLayout,
	ensureWorkspaceLayoutState,
	initializeLocalLayoutState,
	localLayoutStorageKey,
	resetLayoutStateForTests,
	setLayoutStateStorageForTests,
	setLegacyLayoutRequesterForTests,
} from "./layoutState";

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

const endpoint = "http://host.test";

function legacyDocument(): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: "readme", name: "README.md", path: "README.md" }],
			previewTabId: "readme",
		},
		left: {
			visible: true,
			width: 0.18,
			groups: [{ id: "left", weight: 1, folded: false, tabs: [toolTab("projects")] }],
		},
		right: {
			visible: true,
			width: 0.28,
			groups: [{ id: "right", weight: 1, folded: false, tabs: [toolTab("files")] }],
		},
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [{ id: "bottom", weight: 1, folded: false, tabs: [] }],
		},
		toolRestoreTargets: {},
	};
}

function snapshot(workspaceId = "workspace"): WorkspaceLayoutSnapshot {
	return { workspaceId, revision: 8, document: legacyDocument() };
}

function resetStore(): void {
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 1,
		removedWorkspaceIds: {},
		workbenchFrame: null,
		workspaceViewsByWorkspace: {},
		layoutStateReady: false,
		localLayoutPreferences: {
			defaultPresetId: "balanced",
			maxSideGroups: 6,
			maxBottomGroups: 3,
		},
		legacyLayoutImportAttempted: {},
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutProjectionEpochByWorkspace: {},
	});
}

beforeEach(() => {
	resetLayoutStateForTests();
	resetStore();
});

describe("frontend-local layout state", () => {
	test("a copied live surface id is reminted while an available reload id is retained", async () => {
		const copied = new MemoryStorage();
		copied.setItem("thinkrail:layout-surface-id", "surface-a");
		const occupied = new Set(["surface-a"]);
		const reminted = await claimLayoutSurfaceId(copied, async (id) => {
			if (occupied.has(id)) return false;
			occupied.add(id);
			return true;
		});
		expect(reminted).not.toBe("surface-a");
		expect(copied.getItem("thinkrail:layout-surface-id")).toBe(reminted);

		const reload = new MemoryStorage();
		reload.setItem("thinkrail:layout-surface-id", "surface-reload");
		expect(await claimLayoutSurfaceId(reload, async () => true)).toBe("surface-reload");
	});

	test("local preferences persist before any workspace is opened", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		await initializeLocalLayoutState();
		useAppStore.getState().setLocalLayoutPreferences({
			defaultPresetId: "focused",
			maxSideGroups: 8,
			maxBottomGroups: 4,
		});

		resetLayoutStateForTests();
		resetStore();
		setLayoutStateStorageForTests({ local, session }, endpoint);
		await initializeLocalLayoutState();
		expect(useAppStore.getState().localLayoutPreferences).toEqual({
			defaultPresetId: "focused",
			maxSideGroups: 8,
			maxBottomGroups: 4,
		});
	});

	test("imports a legacy workspace once and persists the normalized local state", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		let requests = 0;
		setLegacyLayoutRequesterForTests(async () => {
			requests += 1;
			return snapshot();
		});

		const first = await ensureWorkspaceLayoutState("workspace");
		const second = await ensureWorkspaceLayoutState("workspace");

		expect(first).toEqual(legacyDocument());
		expect(second).toBe(first);
		expect(requests).toBe(1);
		expect(useAppStore.getState().legacyLayoutImportAttempted.workspace).toBe(true);
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-a"))).not.toBeNull();
	});

	test("a reconnect starts a fresh import instead of joining the superseded generation", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		const resolve: Array<(value: WorkspaceLayoutSnapshot | null) => void> = [];
		setLegacyLayoutRequesterForTests(
			() =>
				new Promise((done) => {
					resolve.push(done);
				}),
		);

		const first = ensureWorkspaceLayoutState("workspace").then(
			() => true,
			() => false,
		);
		await Bun.sleep(0);
		expect(resolve).toHaveLength(1);
		useAppStore.setState({ connectionGeneration: 2 });
		const second = ensureWorkspaceLayoutState("workspace");
		await Bun.sleep(0);
		expect(resolve).toHaveLength(2);
		resolve[0]?.(snapshot());
		expect(await first).toBe(false);
		resolve[1]?.(snapshot());
		expect(await second).toEqual(legacyDocument());
	});

	test("rejects a local frame that smuggles resource state and falls back to legacy import", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		local.setItem(
			localLayoutStorageKey(endpoint, "surface-a"),
			JSON.stringify({
				version: 1,
				frame: {
					version: 1,
					center: { kind: "group", id: "center", tabs: ["not-frame-state"] },
					left: { visible: false, width: 0.2, groups: [] },
					right: { visible: false, width: 0.2, groups: [] },
					bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
					toolRestoreTargets: {},
				},
				viewsByWorkspace: {},
				attentionByWorkspace: {},
				preferences: {
					defaultPresetId: "balanced",
					maxSideGroups: 6,
					maxBottomGroups: 3,
				},
				legacyImportAttempted: {},
			}),
		);
		setLayoutStateStorageForTests({ local, session }, endpoint);
		let requests = 0;
		setLegacyLayoutRequesterForTests(async () => {
			requests += 1;
			return snapshot();
		});

		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(restored).toEqual(legacyDocument());
		expect(requests).toBe(1);
	});

	test("reload restores the same surface without another host read", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		setLegacyLayoutRequesterForTests(async () => snapshot());
		const imported = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(imported, "left", 0.31));

		resetLayoutStateForTests();
		resetStore();
		setLayoutStateStorageForTests({ local, session }, endpoint);
		setLegacyLayoutRequesterForTests(async () => {
			throw new Error("unexpected legacy read");
		});

		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(restored.left.width).toBe(0.31);
	});

	test("a stale region callback rebases its change without reverting a newer frame region", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		setLegacyLayoutRequesterForTests(async () => snapshot());
		const base = await ensureWorkspaceLayoutState("workspace");

		await commitWorkspaceLayout("workspace", resizeBottomRegion(base, 0.45), base);
		await commitWorkspaceLayout("workspace", resizeSideRegion(base, "left", 0.31), base);

		const current = useAppStore.getState().layoutDocumentsByWorkspace.workspace;
		expect(current?.bottom.height).toBe(0.45);
		expect(current?.left.width).toBe(0.31);
	});

	test("a newly shown singleton tool cannot collide with a hidden workspace resource", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		setLegacyLayoutRequesterForTests(async (workspaceId) => snapshot(workspaceId));
		await ensureWorkspaceLayoutState("workspace-one");
		await ensureWorkspaceLayoutState("workspace-two");

		const hidden = structuredClone(
			useAppStore.getState().layoutDocumentsByWorkspace["workspace-two"],
		);
		if (hidden?.center.kind !== "group") throw new Error("missing hidden group");
		hidden.center.tabs = [
			{
				kind: "terminal",
				id: "tool:review",
				name: "Collision",
				tabKey: "collision",
			},
		];
		delete hidden.center.previewTabId;
		await commitWorkspaceLayout("workspace-two", hidden);

		const active = structuredClone(
			useAppStore.getState().layoutDocumentsByWorkspace["workspace-one"],
		);
		if (!active?.right.groups[0]) throw new Error("missing active right group");
		active.right.groups[0].tabs.push(toolTab("review"));
		await commitWorkspaceLayout("workspace-one", active);

		const hiddenAfter = useAppStore.getState().layoutDocumentsByWorkspace["workspace-two"];
		const allIds = hiddenAfter
			? collectAllGroups(hiddenAfter).flatMap((group) => group.tabs.map((tab) => tab.id))
			: [];
		expect(new Set(allIds).size).toBe(allIds.length);
		const review = hiddenAfter?.right.groups
			.flatMap((group) => group.tabs)
			.find((tab) => tab.kind === "tool" && tab.tool === "review");
		expect(review?.id).not.toBe("tool:review");
	});

	test("applying a preset changes one frame and reflows every local workspace view", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		setLegacyLayoutRequesterForTests(async (workspaceId) => snapshot(workspaceId));
		await ensureWorkspaceLayoutState("workspace");
		await ensureWorkspaceLayoutState("other");
		const focus = BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === "focus");
		if (!focus) throw new Error("missing Focus preset");

		applyLayoutPresetLocally(focus);

		const state = useAppStore.getState();
		const first = state.layoutDocumentsByWorkspace.workspace;
		const second = state.layoutDocumentsByWorkspace.other;
		if (!first || !second) throw new Error("missing projected workspace document");
		expect(first.center.id).toBe(second.center.id);
		expect(
			collectAllGroups(first).flatMap((group) =>
				group.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path),
			),
		).toEqual(["README.md"]);
		expect(
			collectAllGroups(second).flatMap((group) =>
				group.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path),
			),
		).toEqual(["README.md"]);
	});

	test("simultaneous surface identities use independent persisted frames", async () => {
		const local = new MemoryStorage();
		const firstSession = new MemoryStorage();
		firstSession.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session: firstSession }, endpoint);
		setLegacyLayoutRequesterForTests(async () => snapshot());
		const first = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(first, "left", 0.33));

		resetLayoutStateForTests();
		resetStore();
		const secondSession = new MemoryStorage();
		secondSession.setItem("thinkrail:layout-surface-id", "surface-b");
		setLayoutStateStorageForTests({ local, session: secondSession }, endpoint);
		setLegacyLayoutRequesterForTests(async () => snapshot());

		const second = await ensureWorkspaceLayoutState("workspace");
		expect(second.left.width).toBe(0.18);
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-a"))).not.toBeNull();
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-b"))).not.toBeNull();
	});
});
