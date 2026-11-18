import { expect, test } from "bun:test";
import { joinWorkspacePath } from "./utils";

test("joinWorkspacePath joins a POSIX worktree with a worktree-relative path", () => {
	expect(joinWorkspacePath("/repo", "apps/web/src/App.tsx")).toBe("/repo/apps/web/src/App.tsx");
	expect(joinWorkspacePath("/repo/", "compact/only/here")).toBe("/repo/compact/only/here");
	expect(joinWorkspacePath("/", "file.ts")).toBe("/file.ts");
});

test("joinWorkspacePath follows a Windows worktree's separators", () => {
	expect(joinWorkspacePath("C:\\repo", "apps/web/src/App.tsx")).toBe(
		"C:\\repo\\apps\\web\\src\\App.tsx",
	);
	expect(joinWorkspacePath("C:\\", "file.ts")).toBe("C:\\file.ts");
	expect(joinWorkspacePath("C:/repo", "apps/web/src/App.tsx")).toBe("C:/repo/apps/web/src/App.tsx");
	expect(joinWorkspacePath("C:/", "file.ts")).toBe("C:/file.ts");
});

test("joinWorkspacePath keeps a UNC worktree prefix", () => {
	expect(joinWorkspacePath("\\\\server\\share\\repo", "src/App.tsx")).toBe(
		"\\\\server\\share\\repo\\src\\App.tsx",
	);
	expect(joinWorkspacePath("\\\\server\\share\\repo\\", "README.md")).toBe(
		"\\\\server\\share\\repo\\README.md",
	);
});

test("joinWorkspacePath keeps a POSIX name's literal backslash", () => {
	expect(joinWorkspacePath("/repo", "a\\b.ts")).toBe("/repo/a\\b.ts");
	expect(joinWorkspacePath("/repo\\name", "file.ts")).toBe("/repo\\name/file.ts");
});

test("joinWorkspacePath leaves a path outside the worktree as it is", () => {
	expect(joinWorkspacePath("/repo", "/elsewhere/file.ts")).toBe("/elsewhere/file.ts");
	expect(joinWorkspacePath("C:\\repo", "D:/elsewhere/file.ts")).toBe("D:/elsewhere/file.ts");
	expect(joinWorkspacePath("", "src/App.tsx")).toBe("src/App.tsx");
});
