import { expect, test } from "bun:test";
import { WORKSPACE_RENAME_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import { canRenameWorkspace, workspaceRenameValue } from "./workspaceActions";

const managed: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "Workspace",
	branch: "workspace",
	worktreePath: "/tmp/workspace",
	baseBranch: "main",
};

test("manual rename requires its introducing host protocol and a ThinkRail-managed workspace", () => {
	expect(WORKSPACE_RENAME_PROTOCOL_VERSION).toBe(55);
	expect(canRenameWorkspace(54, managed)).toBe(false);
	expect(canRenameWorkspace(55, managed)).toBe(true);
	expect(canRenameWorkspace(56, managed)).toBe(true);
	expect(canRenameWorkspace(55, { ...managed, kind: "default" })).toBe(false);
	expect(canRenameWorkspace(55, { ...managed, kind: "external" })).toBe(false);
	expect(canRenameWorkspace(null, managed)).toBe(false);
});

test("inline rename submits only a changed nonblank label", () => {
	expect(workspaceRenameValue("Current", "   ")).toBeNull();
	expect(workspaceRenameValue("Current", " Current ")).toBeNull();
	expect(workspaceRenameValue("Current", " Next name ")).toBe("Next name");
});
