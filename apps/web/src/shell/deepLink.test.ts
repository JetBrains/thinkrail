import { expect, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import {
	fileIsInsideWorkspace,
	findWorkspaceForFile,
	getNativeDeepLinkBridge,
	workspaceFilePath,
} from "./deepLink";

function workspace(id: string, worktreePath: string): Workspace {
	return {
		id,
		projectId: "p",
		kind: "default",
		name: id,
		branch: "main",
		worktreePath,
		baseBranch: "main",
	};
}

test("matches a file under a workspace root, not a sibling with the same prefix", () => {
	expect(fileIsInsideWorkspace("/repo/src/a.ts", "/repo")).toBe(true);
	expect(fileIsInsideWorkspace("/repo", "/repo")).toBe(true);
	expect(fileIsInsideWorkspace("/repo-other/a.ts", "/repo")).toBe(false);
	expect(fileIsInsideWorkspace("C:\\Repo\\src\\a.ts", "c:\\repo")).toBe(true);
});

test("prefers the most specific workspace and breaks ties with the active one", () => {
	const project = workspace("default", "/repo");
	const nested = workspace("nested", "/repo/packages/app");
	expect(findWorkspaceForFile("/repo/packages/app/src/a.ts", [project, nested])?.id).toBe("nested");
	expect(findWorkspaceForFile("/repo/src/a.ts", [project, nested])?.id).toBe("default");
	expect(
		findWorkspaceForFile(
			"/repo/packages/app/src/a.ts",
			[nested, workspace("same-length", "/repo/packages/app")],
			"same-length",
		)?.id,
	).toBe("same-length");
});

test("returns null when no workspace contains the file", () => {
	expect(findWorkspaceForFile("/elsewhere/a.ts", [workspace("default", "/repo")])).toBeNull();
});

test("opens and reveals with the workspace-relative identity", () => {
	expect(workspaceFilePath("/repo/src/a.ts", workspace("default", "/repo"))).toBe("src/a.ts");
	expect(workspaceFilePath("C:\\Repo\\src\\a.ts", workspace("default", "c:\\repo"))).toBe(
		"src/a.ts",
	);
});

test("accepts only a bridge with subscribe()", () => {
	expect(getNativeDeepLinkBridge(undefined)).toBeNull();
	expect(getNativeDeepLinkBridge({})).toBeNull();
	const bridge = { subscribe: () => () => {} };
	expect(getNativeDeepLinkBridge(bridge)).toBe(bridge);
});
