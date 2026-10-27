import { afterEach, expect, test } from "bun:test";
import { copyText, workspaceFileCopyText } from "../../lib";
import type { LayoutTab } from "./types";
import { tabCopyRelativePath } from "./workbenchTabs";

const clipboardWrites: string[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

function stubClipboard(): void {
	clipboardWrites.length = 0;
	Object.defineProperty(globalThis.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				clipboardWrites.push(text);
			},
		},
	});
}

afterEach(() => {
	if (originalClipboard)
		Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
	else Reflect.deleteProperty(globalThis.navigator, "clipboard");
});

const fileTab: LayoutTab = { kind: "file", id: "f1", name: "App.tsx", path: "src/App.tsx" };
const diffTab: LayoutTab = {
	kind: "diff",
	id: "d1",
	name: "App.tsx",
	path: "src/App.tsx",
	scope: { kind: "uncommitted" },
};
const compareTab: LayoutTab = {
	kind: "diff",
	id: "d2",
	name: "App.tsx",
	path: "src/App.tsx",
	before: "src/old.tsx",
};

test("file and diff tabs expose the clicked file path for copy", () => {
	expect(tabCopyRelativePath(fileTab)).toBe("src/App.tsx");
	expect(tabCopyRelativePath(diffTab)).toBe("src/App.tsx");
	expect(tabCopyRelativePath(compareTab)).toBe("src/App.tsx");
});

test("chat, terminal, tool, document, and changes tabs omit path copy", () => {
	expect(tabCopyRelativePath({ kind: "chat", id: "c", name: "", sessionId: "s" })).toBeNull();
	expect(tabCopyRelativePath({ kind: "terminal", id: "t", name: "", tabKey: "k" })).toBeNull();
	expect(tabCopyRelativePath({ kind: "tool", id: "x", name: "", tool: "files" })).toBeNull();
	expect(
		tabCopyRelativePath({
			kind: "document",
			id: "d",
			name: "",
			documentKind: "todo-plan",
			sourceId: "s",
			docPath: "plan.md",
		}),
	).toBeNull();
	expect(
		tabCopyRelativePath({ kind: "changes", id: "ch", name: "", scope: { kind: "uncommitted" } }),
	).toBeNull();
});

test("copying a file tab writes the absolute or relative path and does not select the tab", async () => {
	stubClipboard();
	const relative = tabCopyRelativePath(fileTab);
	if (!relative) throw new Error("file tab must expose a copy path");
	expect(await copyText(workspaceFileCopyText("/repo", relative, "absolute"))).toBe(true);
	expect(await copyText(workspaceFileCopyText("/repo", relative, "relative"))).toBe(true);
	expect(clipboardWrites).toEqual(["/repo/src/App.tsx", "src/App.tsx"]);
});
