import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { copyFileTreePath, FileCopyMenu, fileTreeCopyRelativePath } from "./FileCopyMenu";

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

test("fileTreeCopyRelativePath copies a file path as-is", () => {
	expect(fileTreeCopyRelativePath({ path: "src/App.tsx" }, null)).toBe("src/App.tsx");
});

test("fileTreeCopyRelativePath copies a compacted directory's deepest path", () => {
	const compacted = {
		path: "compact/only/here",
		paths: ["compact", "compact/only", "compact/only/here"],
	};
	expect(fileTreeCopyRelativePath({ path: "compact" }, compacted)).toBe("compact/only/here");
});

test("copying a Files row writes the absolute or relative path and does not open the file", async () => {
	stubClipboard();
	expect(await copyFileTreePath("/repo", "src/App.tsx", "absolute")).toBe(true);
	expect(await copyFileTreePath("/repo", "src/App.tsx", "relative")).toBe(true);
	expect(clipboardWrites).toEqual(["/repo/src/App.tsx", "src/App.tsx"]);
});

test("copying a compacted directory chain writes the deepest path", async () => {
	stubClipboard();
	const compacted = {
		path: "compact/only/here",
		paths: ["compact", "compact/only", "compact/only/here"],
	};
	const relative = fileTreeCopyRelativePath({ path: "compact" }, compacted);
	expect(await copyFileTreePath("/repo", relative, "relative")).toBe(true);
	expect(await copyFileTreePath("C:\\repo", relative, "absolute")).toBe(true);
	expect(clipboardWrites).toEqual(["compact/only/here", "C:\\repo\\compact\\only\\here"]);
});

test("FileCopyMenu wraps the row trigger without opening it", () => {
	const html = renderToStaticMarkup(
		<FileCopyMenu worktreePath="/repo" relativePath="README.md">
			<button type="button" data-testid="file-node" data-kind="file">
				README.md
			</button>
		</FileCopyMenu>,
	);
	expect(html).toContain('data-testid="file-node"');
	expect(html).toContain("README.md");
	expect(html).not.toContain("openFileInTab");
});
