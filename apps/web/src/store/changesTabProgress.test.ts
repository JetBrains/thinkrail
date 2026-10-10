import { beforeEach, expect, test } from "bun:test";
import { createChangesTab, useAppStore } from "./appStore";

beforeEach(() => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	useAppStore.getState().openTab(createChangesTab("ws", "changes", "Changes", { kind: "branch" }));
});

function changesTab() {
	const tab = useAppStore.getState().tabsByWorkspace.ws?.find((tab) => tab.id === "changes");
	if (tab?.kind !== "changes") throw new Error("Missing changes tab");
	return tab;
}

test("keeping the last hunk records hunk and file progress in one store update", () => {
	const { setChangesTabHunkKept, setChangesTabViewed } = useAppStore.getState();
	setChangesTabHunkKept("ws", "changes", "file.ts", "first", true, ["first", "last"]);
	expect(changesTab().viewed).toEqual([]);

	let updates = 0;
	const unsubscribe = useAppStore.subscribe(() => {
		updates += 1;
	});
	try {
		setChangesTabHunkKept("ws", "changes", "file.ts", "last", true, ["first", "last"]);
	} finally {
		unsubscribe();
	}
	expect(updates).toBe(1);
	expect(changesTab().kept["file.ts"]).toEqual(["first", "last"]);
	expect(changesTab().viewed).toEqual(["file.ts"]);

	setChangesTabViewed("ws", "changes", "file.ts", false);
	setChangesTabHunkKept("ws", "changes", "file.ts", "last", true, ["first", "last"]);
	expect(changesTab().viewed).toEqual([]);
});

test("progress promotes the canonical restored placement without consuming another group's preview", () => {
	useAppStore.setState({
		layoutDocumentsByWorkspace: {
			ws: {
				version: 2,
				center: {
					kind: "group",
					id: "center",
					tabs: [{ kind: "changes", id: "restored", name: "Changes", scope: { kind: "branch" } }],
					previewTabId: "restored",
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
				toolRestoreTargets: {},
			},
		},
		previewTabByWorkspace: { ws: "other-group-preview" },
		layoutIntents: [],
	});
	useAppStore.getState().setChangesTabViewed("ws", "changes", "file.ts", true);
	expect(useAppStore.getState().layoutIntents).toMatchObject([
		{ kind: "select", tabId: "restored", keep: true, focus: false, countNavigation: false },
	]);
	expect(useAppStore.getState().previewTabByWorkspace.ws).toBe("other-group-preview");
});

test("marking a scope viewed is one atomic update and retains earlier file progress", () => {
	useAppStore.getState().setChangesTabViewed("ws", "changes", "earlier.ts", true);
	let updates = 0;
	const unsubscribe = useAppStore.subscribe(() => {
		updates += 1;
	});
	try {
		useAppStore.getState().setChangesTabViewed("ws", "changes", ["a.ts", "b.ts", "a.ts"], true);
	} finally {
		unsubscribe();
	}
	expect(changesTab().viewed).toEqual(["earlier.ts", "a.ts", "b.ts"]);
	expect(updates).toBe(1);
});
