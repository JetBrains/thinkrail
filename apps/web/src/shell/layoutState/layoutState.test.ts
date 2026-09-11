import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../../store";
import {
	BUILTIN_LAYOUT_PRESETS,
	closeLayoutTab,
	collectAllGroups,
	findTabLocation,
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
	setLayoutStateStablePreferencesForTests,
	setLayoutStateStorageForTests,
	transitionTodoViewMode,
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
		sessionMembershipGenerationByWorkspace: {},
		workbenchFrame: null,
		workspaceViewsByWorkspace: {},
		layoutStateReady: false,
		localLayoutPreferences: {
			defaultPresetId: "balanced",
			maxSideGroups: 6,
			maxBottomGroups: 3,
		},
		todoViewMode: "chat-popover",
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutProjectionEpochByWorkspace: {},
		toasts: [],
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

	test("TODO mode changes stay gated until the local layout is ready", () => {
		expect(() => transitionTodoViewMode("side-tool")).not.toThrow();
		expect(useAppStore.getState()).toMatchObject({
			layoutStateReady: false,
			workbenchFrame: null,
			todoViewMode: "chat-popover",
		});
	});

	test("TODO mode changes atomically hide and intentionally restore the singleton", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		await ensureWorkspaceLayoutState("workspace");
		await ensureWorkspaceLayoutState("retained");
		for (const [workspaceId, sessionId] of [
			["workspace", "session-a"],
			["retained", "session-b"],
		] as const) {
			const attention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!attention) throw new Error(`missing ${workspaceId} attention`);
			useAppStore.getState().setLayoutAttention(workspaceId, {
				...attention,
				lastFocusedChatSessionId: sessionId,
			});
		}
		let transitions = 0;
		const unsubscribe = useAppStore.subscribe(() => {
			transitions += 1;
		});

		transitionTodoViewMode("side-tool");
		unsubscribe();
		expect(transitions).toBe(1);
		let state = useAppStore.getState();
		expect(state.todoViewMode).toBe("side-tool");
		expect(
			state.layoutDocumentsByWorkspace.workspace?.right.groups.flatMap((group) =>
				group.tabs.filter((tab) => tab.kind === "tool").map((tab) => tab.tool),
			),
		).toEqual(["specs", "files", "changes", "todos", "review"]);
		for (const [workspaceId, sessionId] of [
			["workspace", "session-a"],
			["retained", "session-b"],
		] as const) {
			const document = state.layoutDocumentsByWorkspace[workspaceId];
			const attention = state.layoutAttentionByWorkspace[workspaceId];
			if (!document || !attention) throw new Error(`missing ${workspaceId} layout`);
			const location = findTabLocation(document, "tool:todos");
			if (!location || location.area === "center") throw new Error("missing TODO placement");
			expect(attention.selectedByGroup[location.groupId]).toBe("tool:todos");
			expect(attention.lastFocusedSideGroupId[location.area]).toBe(location.groupId);
			expect(attention.lastFocusedChatSessionId).toBe(sessionId);
		}
		await ensureWorkspaceLayoutState("future");
		state = useAppStore.getState();
		const futureDocument = state.layoutDocumentsByWorkspace.future;
		const futureAttention = state.layoutAttentionByWorkspace.future;
		if (!futureDocument || !futureAttention) throw new Error("missing future layout");
		const futureLocation = findTabLocation(futureDocument, "tool:todos");
		if (!futureLocation || futureLocation.area === "center") {
			throw new Error("missing future TODO placement");
		}
		expect(futureAttention.selectedByGroup[futureLocation.groupId]).toBe("tool:todos");
		expect(futureAttention.lastFocusedSideGroupId[futureLocation.area]).toBe(
			futureLocation.groupId,
		);

		const placed = state.layoutDocumentsByWorkspace.workspace;
		if (!placed) throw new Error("missing workspace layout");
		await commitWorkspaceLayout("workspace", closeLayoutTab(placed, "tool:todos").document);
		const hidden = useAppStore.getState().layoutDocumentsByWorkspace.workspace;
		if (!hidden) throw new Error("missing hidden workspace layout");
		expect(
			collectAllGroups(hidden).some((group) =>
				group.tabs.some((tab) => tab.kind === "tool" && tab.tool === "todos"),
			),
		).toBe(false);
		transitionTodoViewMode("side-tool");
		state = useAppStore.getState();
		expect(
			state.layoutDocumentsByWorkspace.workspace?.right.groups.flatMap((group) =>
				group.tabs.filter((tab) => tab.kind === "tool").map((tab) => tab.tool),
			),
		).toEqual(["specs", "files", "changes", "todos", "review"]);
		transitionTodoViewMode("chat-popover");
		state = useAppStore.getState();
		expect(state.todoViewMode).toBe("chat-popover");
		expect(state.workbenchFrame?.toolRestoreTargets.todos).toMatchObject({ region: "right" });
	});

	test("TODO mode claims its placement id against hidden workspace resources", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		await ensureWorkspaceLayoutState("active");
		const hidden = structuredClone(await ensureWorkspaceLayoutState("hidden"));
		if (hidden.center.kind !== "group") throw new Error("missing hidden center group");
		hidden.center.tabs = [
			{
				kind: "terminal",
				id: "tool:todos",
				name: "Collision",
				tabKey: "collision",
			},
		];
		await commitWorkspaceLayout("hidden", hidden);

		transitionTodoViewMode("side-tool");

		const state = useAppStore.getState();
		const todo = state.workbenchFrame?.right.groups
			.flatMap((group) => group.tools)
			.find((tool) => tool.tool === "todos");
		expect(todo?.id).toBeDefined();
		expect(todo?.id).not.toBe("tool:todos");
		const hiddenAfter = state.layoutDocumentsByWorkspace.hidden;
		const ids = hiddenAfter
			? collectAllGroups(hiddenAfter).flatMap((group) => group.tabs.map((tab) => tab.id))
			: [];
		expect(new Set(ids).size).toBe(ids.length);
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

	test("side mode hydration preserves a manual TODO hide and remembered chat focus", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		await ensureWorkspaceLayoutState("workspace");
		transitionTodoViewMode("side-tool");
		const withTodo = useAppStore.getState().layoutDocumentsByWorkspace.workspace;
		if (!withTodo) throw new Error("missing TODO layout");
		await commitWorkspaceLayout("workspace", closeLayoutTab(withTodo, "tool:todos").document);
		const attention = useAppStore.getState().layoutAttentionByWorkspace.workspace;
		if (!attention) throw new Error("missing layout attention");
		useAppStore.getState().setLayoutAttention("workspace", {
			...attention,
			lastFocusedChatSessionId: "session",
		});

		resetLayoutStateForTests();
		resetStore();
		setLayoutStateStorageForTests({ local, session }, endpoint);
		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(useAppStore.getState().todoViewMode).toBe("side-tool");
		expect(
			collectAllGroups(restored).some((group) =>
				group.tabs.some((tab) => tab.kind === "tool" && tab.tool === "todos"),
			),
		).toBe(false);
		expect(
			useAppStore.getState().layoutAttentionByWorkspace.workspace?.lastFocusedChatSessionId,
		).toBe("session");
	});

	test("missing or invalid TODO modes default fieldwise without discarding the frame", async () => {
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		session.setItem("thinkrail:layout-surface-id", "surface-a");
		setLayoutStateStorageForTests({ local, session }, endpoint);
		const initial = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(initial, "left", 0.34));
		transitionTodoViewMode("side-tool");
		const key = localLayoutStorageKey(endpoint, "surface-a");
		const base = local.getItem(key);
		if (!base) throw new Error("missing persisted layout");
		const variants = [
			base.replace(',"todoViewMode":"side-tool"', ""),
			base.replace('"todoViewMode":"side-tool"', '"todoViewMode":"invalid"'),
		];
		for (const variant of variants) {
			resetLayoutStateForTests();
			resetStore();
			local.setItem(key, variant);
			setLayoutStateStorageForTests({ local, session }, endpoint);
			const restored = await ensureWorkspaceLayoutState("workspace");
			expect(useAppStore.getState().todoViewMode).toBe("chat-popover");
			expect(restored.left.width).toBe(0.34);
			expect(
				collectAllGroups(restored).some((group) =>
					group.tabs.some((tab) => tab.kind === "tool" && tab.tool === "todos"),
				),
			).toBe(false);
		}
	});

	test("native stable preferences restore layout after the host port changes", async () => {
		const stablePreferences = new MemoryStorage();
		const local = new MemoryStorage();
		const session = new MemoryStorage();
		setLayoutStateStorageForTests({ local, session }, "http://127.0.0.1:4311");
		setLayoutStateStablePreferencesForTests(stablePreferences);
		const initial = await ensureWorkspaceLayoutState("workspace");
		await commitWorkspaceLayout("workspace", resizeSideRegion(initial, "left", 0.29));

		resetLayoutStateForTests();
		resetStore();
		setLayoutStateStorageForTests({ local, session }, "http://127.0.0.1:5099");
		setLayoutStateStablePreferencesForTests(stablePreferences);

		const restored = await ensureWorkspaceLayoutState("workspace");
		expect(restored.left.width).toBe(0.29);
		expect(local.length).toBe(0);
		expect(session.length).toBe(0);
	});

	test("oversized native documents fail visibly without a partial preference write", async () => {
		const stablePreferences = new MemoryStorage();
		setLayoutStateStorageForTests(
			{ local: new MemoryStorage(), session: new MemoryStorage() },
			"http://127.0.0.1:4311",
		);
		setLayoutStateStablePreferencesForTests(stablePreferences);
		await initializeLocalLayoutState();

		const oversizedWorkspaceId = `workspace-${"x".repeat(256 * 1024)}`;
		useAppStore.setState({
			workspaceViewsByWorkspace: { [oversizedWorkspaceId]: { groups: {} } },
		});

		expect(stablePreferences.length).toBe(0);
		expect(useAppStore.getState().toasts.at(-1)).toMatchObject({
			title: "Couldn't save the local layout",
			message: "The local layout is too large to save in this native window",
		});
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
