import { expect, test } from "bun:test";
import { joinWorkspacePath, workspaceFileCopyText } from "./utils";

test("joinWorkspacePath joins a posix worktree with a nested relative path", () => {
	expect(joinWorkspacePath("/repo", "apps/web/src/App.tsx")).toBe("/repo/apps/web/src/App.tsx");
	expect(joinWorkspacePath("/repo/", "apps/web/src/App.tsx")).toBe("/repo/apps/web/src/App.tsx");
	expect(joinWorkspacePath("/repo", "./apps/web/src/App.tsx")).toBe("/repo/apps/web/src/App.tsx");
});

test("joinWorkspacePath follows a Windows worktree's separators", () => {
	expect(joinWorkspacePath("C:\\repo", "apps/web/src/App.tsx")).toBe(
		"C:\\repo\\apps\\web\\src\\App.tsx",
	);
	expect(joinWorkspacePath("C:\\repo\\", "apps\\web\\src\\App.tsx")).toBe(
		"C:\\repo\\apps\\web\\src\\App.tsx",
	);
	expect(joinWorkspacePath("C:\\repo", "C:\\repo\\apps\\web\\src\\App.tsx")).toBe(
		"C:\\repo\\apps\\web\\src\\App.tsx",
	);
});

test("joinWorkspacePath keeps forward slashes when the worktree already uses them", () => {
	expect(joinWorkspacePath("C:/repo", "apps/web/src/App.tsx")).toBe("C:/repo/apps/web/src/App.tsx");
});

test("joinWorkspacePath joins a compacted directory chain as its deepest path", () => {
	expect(joinWorkspacePath("/repo", "compact/only/here")).toBe("/repo/compact/only/here");
	expect(joinWorkspacePath("C:\\repo", "compact/only/here")).toBe("C:\\repo\\compact\\only\\here");
});

test("joinWorkspacePath joins onto a Windows drive root without doubling separators", () => {
	expect(joinWorkspacePath("C:\\", "file.ts")).toBe("C:\\file.ts");
	expect(joinWorkspacePath("C:/", "file.ts")).toBe("C:/file.ts");
});

test("joinWorkspacePath preserves a UNC worktree prefix", () => {
	expect(joinWorkspacePath("\\\\server\\share\\repo", "README.md")).toBe(
		"\\\\server\\share\\repo\\README.md",
	);
	expect(joinWorkspacePath("\\\\server\\share\\repo\\", "src/App.tsx")).toBe(
		"\\\\server\\share\\repo\\src\\App.tsx",
	);
});

test("workspaceFileCopyText returns the relative posix path or the joined absolute path", () => {
	expect(workspaceFileCopyText("/repo", "apps/web/src/App.tsx", "relative")).toBe(
		"apps/web/src/App.tsx",
	);
	expect(workspaceFileCopyText("/repo", "/repo/apps/web/src/App.tsx", "relative")).toBe(
		"apps/web/src/App.tsx",
	);
	expect(workspaceFileCopyText("C:\\repo", "apps/web/src/App.tsx", "absolute")).toBe(
		"C:\\repo\\apps\\web\\src\\App.tsx",
	);
	expect(workspaceFileCopyText("C:\\repo", "apps/web/src/App.tsx", "relative")).toBe(
		"apps/web/src/App.tsx",
	);
});

test("workspaceFileCopyText keeps a UNC worktree prefix", () => {
	expect(workspaceFileCopyText("\\\\server\\share\\repo", "README.md", "absolute")).toBe(
		"\\\\server\\share\\repo\\README.md",
	);
	expect(workspaceFileCopyText("\\\\server\\share\\repo", "README.md", "relative")).toBe(
		"README.md",
	);
});

test("workspaceFileCopyText joins onto a Windows drive root", () => {
	expect(workspaceFileCopyText("C:\\", "file.ts", "absolute")).toBe("C:\\file.ts");
	expect(workspaceFileCopyText("C:/", "file.ts", "absolute")).toBe("C:/file.ts");
	expect(workspaceFileCopyText("C:\\", "file.ts", "relative")).toBe("file.ts");
});

test("workspaceFileCopyText keeps a POSIX name with a literal backslash", () => {
	expect(workspaceFileCopyText("/repo", "a\\b.ts", "relative")).toBe("a\\b.ts");
	expect(workspaceFileCopyText("/repo", "a\\b.ts", "absolute")).toBe("/repo/a\\b.ts");
	expect(workspaceFileCopyText("/repo", "/repo/a\\b.ts", "relative")).toBe("a\\b.ts");
	expect(joinWorkspacePath("/repo\\name", "file.ts")).toBe("/repo\\name/file.ts");
});
