import { expect, test } from "bun:test";
import type { LayoutTab } from "./types";
import { tabCopyRelativePath } from "./workbenchTabs";

const fileTab = {
	kind: "file",
	id: "file:src/App.tsx",
	name: "App.tsx",
	path: "src/App.tsx",
} as const satisfies LayoutTab;

const diffTab = {
	kind: "diff",
	id: "diff:src/App.tsx",
	name: "App.tsx",
	path: "src/App.tsx",
	scope: { kind: "branch" },
} as const satisfies LayoutTab;

test("file and diff tabs expose their relative path for copy actions", () => {
	expect(tabCopyRelativePath(fileTab)).toBe("src/App.tsx");
	expect(tabCopyRelativePath(diffTab)).toBe("src/App.tsx");
});

test("other tab kinds omit path copy actions", () => {
	const tabs = [
		{ kind: "chat", id: "chat", name: "Chat", sessionId: "session" },
		{ kind: "changes", id: "changes", name: "Changes", scope: { kind: "branch" } },
		{
			kind: "document",
			id: "document",
			name: "Plan",
			documentKind: "todo-plan",
			sourceId: "session",
			docPath: "TODO.md",
		},
		{ kind: "terminal", id: "terminal", name: "Terminal", tabKey: "terminal" },
		{ kind: "tool", id: "tool", name: "Files", tool: "files" },
	] as const satisfies readonly LayoutTab[];

	for (const tab of tabs) expect(tabCopyRelativePath(tab)).toBeNull();
});
