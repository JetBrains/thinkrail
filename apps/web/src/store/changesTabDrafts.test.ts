import { beforeEach, expect, test } from "bun:test";
import { createChangesTab, useAppStore } from "./appStore";

beforeEach(() => {
	useAppStore.setState(useAppStore.getInitialState(), true);
});

test("switching a Changes section renderer retains transient review drafts but drops view geometry", () => {
	const tab = createChangesTab("ws", "changes", "Changes", { kind: "branch" });
	const reviewDrafts = { selection: { text: "not saved", start: 3, end: 7 } };
	tab.sections["file.json"] = {
		rendererId: "thinkrail/json",
		viewState: { scroll: 42 },
		reviewDrafts,
	};
	useAppStore.getState().openTab(tab, "keep");
	useAppStore
		.getState()
		.setChangesTabSectionRenderer("ws", "changes", "file.json", "thinkrail/code");
	const restored = useAppStore
		.getState()
		.tabsByWorkspace.ws?.find((candidate) => candidate.id === tab.id);
	expect(restored?.kind).toBe("changes");
	if (restored?.kind !== "changes") throw new Error("Missing Changes tab");
	expect(restored.sections["file.json"]?.reviewDrafts).toEqual(reviewDrafts);
	expect(restored.sections["file.json"]?.viewState).toBeUndefined();
});

test("the first scratch write keeps the preview atomically without repeating layout intents per keystroke", () => {
	const tab = createChangesTab("ws", "changes", "Changes", { kind: "branch" });
	useAppStore.getState().openTab(tab, "preview");
	expect(useAppStore.getState().previewTabByWorkspace.ws).toBe("changes");
	const before = useAppStore.getState().layoutIntents.length;
	let updates = 0;
	const unsubscribe = useAppStore.subscribe(() => {
		updates += 1;
	});
	useAppStore
		.getState()
		.setChangesTabSectionReviewDraft("ws", "changes", "file.ts", "selection", () => "a");
	unsubscribe();
	expect(updates).toBe(1);
	expect(useAppStore.getState().previewTabByWorkspace.ws).toBeUndefined();
	expect(useAppStore.getState().layoutIntents.length).toBe(before + 1);
	useAppStore
		.getState()
		.setChangesTabSectionReviewDraft(
			"ws",
			"changes",
			"file.ts",
			"selection",
			(current) => `${current}b`,
		);
	expect(useAppStore.getState().layoutIntents.length).toBe(before + 1);
});

test("tab close retires scratch and a late callback cannot recreate the closed tab", () => {
	const tab = createChangesTab("ws", "changes", "Changes", { kind: "branch" });
	useAppStore.getState().openTab(tab, "keep");
	const { setChangesTabSectionReviewDraft, closeTab } = useAppStore.getState();
	setChangesTabSectionReviewDraft("ws", "changes", "file.ts", "selection", () => "unsaved");
	closeTab("changes", false, false, "ws");
	setChangesTabSectionReviewDraft("ws", "changes", "file.ts", "selection", () => "late");
	expect(useAppStore.getState().tabsByWorkspace.ws).toEqual([]);
	useAppStore
		.getState()
		.openTab(createChangesTab("ws", "changes", "Changes", { kind: "branch" }), "keep");
	const restored = useAppStore.getState().tabsByWorkspace.ws?.[0];
	if (restored?.kind !== "changes") throw new Error("Missing Changes tab");
	expect(restored.sections).toEqual({});
});
