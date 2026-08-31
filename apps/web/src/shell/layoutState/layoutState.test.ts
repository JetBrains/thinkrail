import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../../store";
import {
	BUILTIN_LAYOUT_PRESETS,
	closeLayoutTab,
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

	test("a pristine surface initializes a Balanced workspace locally without transport", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);

		const first = await ensureWorkspaceLayoutState("workspace");
		const second = await ensureWorkspaceLayoutState("workspace");

		expect(first.center).toMatchObject({ kind: "group", tabs: [] });
		expect(first.left.groups[0]?.tabs).toEqual([toolTab("projects")]);
		expect(first.right.groups.flatMap((group) => group.tabs)).toEqual([
			toolTab("specs"),
			toolTab("files"),
			toolTab("changes"),
			toolTab("review"),
		]);
		expect(first.bottom).toMatchObject({ visible: true, groups: [{ tabs: [] }] });
		expect(second).toBe(first);
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-a"))).not.toBeNull();
	});

	test("an invalid local frame falls back directly to Balanced", async () => {
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
			}),
		);
		setLayoutStateStorageForTests({ local, session }, endpoint);

		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(restored.center).toMatchObject({ kind: "group", tabs: [] });
		expect(restored.left.groups[0]?.tabs).toEqual([toolTab("projects")]);
		expect(restored.bottom.visible).toBe(true);
	});

	test("reload restores the same surface without another host read", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		const initial = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(initial, "left", 0.31));

		resetLayoutStateForTests();
		resetStore();
		setLayoutStateStorageForTests({ local, session }, endpoint);

		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(restored.left.width).toBe(0.31);
	});

	test("a stale region callback rebases its change without reverting a newer frame region", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
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
		await ensureWorkspaceLayoutState("workspace-one");
		await ensureWorkspaceLayoutState("workspace-two");
		const withReview = useAppStore.getState().layoutDocumentsByWorkspace["workspace-one"];
		if (!withReview) throw new Error("missing first workspace");
		await commitWorkspaceLayout(
			"workspace-one",
			closeLayoutTab(withReview, "tool:review").document,
		);

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
		for (const [workspaceId, path] of [
			["workspace", "one.ts"],
			["other", "two.ts"],
		] as const) {
			const document = structuredClone(await ensureWorkspaceLayoutState(workspaceId));
			if (document.center.kind !== "group") throw new Error("missing center group");
			document.center.tabs = [{ kind: "file", id: path, name: path, path }];
			await commitWorkspaceLayout(workspaceId, document);
		}
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
		).toEqual(["one.ts"]);
		expect(
			collectAllGroups(second).flatMap((group) =>
				group.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path),
			),
		).toEqual(["two.ts"]);
	});

	test("simultaneous surface identities use independent persisted frames", async () => {
		const local = new MemoryStorage();
		const firstSession = new MemoryStorage();
		firstSession.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session: firstSession }, endpoint);
		const first = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(first, "left", 0.33));

		resetLayoutStateForTests();
		resetStore();
		const secondSession = new MemoryStorage();
		secondSession.setItem("thinkrail:layout-surface-id", "surface-b");
		setLayoutStateStorageForTests({ local, session: secondSession }, endpoint);

		const second = await ensureWorkspaceLayoutState("workspace");
		expect(second.left.width).toBe(0.18);
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-a"))).not.toBeNull();
		expect(local.getItem(localLayoutStorageKey(endpoint, "surface-b"))).not.toBeNull();
	});
});
