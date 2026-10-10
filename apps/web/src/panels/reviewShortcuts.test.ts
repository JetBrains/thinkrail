import { afterEach, expect, test } from "bun:test";
import type { WorkspaceLayoutDocument } from "../shell/layout/types";
import { createChangesTab, useAppStore } from "../store";
import { ownsReviewShortcut } from "./reviewShortcuts";

const initial = useAppStore.getState();
afterEach(() => useAppStore.setState(initial, true));

const quiet = { querySelector: () => null };
const modal = { querySelector: () => ({}) as Element };
const key = (target: EventTarget | null = null) => ({ target }) as KeyboardEvent;

test("a review tab answers its shortcuts only while it is the tab the center is looking at", () => {
	const branch = createChangesTab("ws1", "ws1:changes:branch", "Changes", { kind: "branch" });
	const uncommitted = createChangesTab("ws1", "ws1:changes:uncommitted", "Changes · uncommitted", {
		kind: "uncommitted",
	});
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
					tabs: [{ kind: "changes", id: branch.id, name: branch.name, scope: branch.scope }],
				},
				{
					kind: "group",
					id: "b",
					tabs: [
						{
							kind: "changes",
							id: uncommitted.id,
							name: uncommitted.name,
							scope: uncommitted.scope,
						},
					],
				},
			],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		tabsByWorkspace: { ws1: [branch, uncommitted] },
		layoutDocumentsByWorkspace: { ws1: layout },
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { a: branch.id, b: uncommitted.id },
				lastFocusedCenterGroupId: "b",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { a: 0, b: 0 },
			},
		},
	});

	expect(ownsReviewShortcut(key(), uncommitted, quiet)).toBe(true);
	expect(ownsReviewShortcut(key(), branch, quiet)).toBe(false);
	expect(ownsReviewShortcut(key(), uncommitted, modal)).toBe(false);
	const textarea = { isContentEditable: false, tagName: "TEXTAREA" } as unknown as EventTarget;
	const editable = { isContentEditable: true, tagName: "DIV" } as unknown as EventTarget;
	const button = { isContentEditable: false, tagName: "BUTTON" } as unknown as EventTarget;
	expect(ownsReviewShortcut(key(textarea), uncommitted, quiet)).toBe(false);
	expect(ownsReviewShortcut(key(editable), uncommitted, quiet)).toBe(false);
	expect(ownsReviewShortcut(key(button), uncommitted, quiet)).toBe(true);
});
