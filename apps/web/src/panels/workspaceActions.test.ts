import { expect, test } from "bun:test";
import { WORKSPACE_RENAME_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import {
	canRenameWorkspace,
	createRenameController,
	workspaceRenameValue,
} from "./workspaceActions";

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

function controller(canRename: boolean) {
	const renamed: string[] = [];
	const editing: boolean[] = [];
	const rename = createRenameController({
		canRename,
		onRename: (name) => renamed.push(name),
		onEditingChange: (next) => editing.push(next),
	});
	return { rename, renamed, editing };
}

test("a changed commit dispatches once and closes the editor", () => {
	const { rename, renamed, editing } = controller(true);
	rename.start("Current");
	rename.commit(" Next ");
	expect(renamed).toEqual(["Next"]);
	expect(editing).toEqual([true, false]);
	rename.commit("Again");
	expect(renamed).toEqual(["Next"]);
});

test("blank, unchanged, or cancelled edits close without a request", () => {
	for (const input of ["   ", "Current"]) {
		const { rename, renamed, editing } = controller(true);
		rename.start("Current");
		rename.commit(input);
		expect(renamed).toEqual([]);
		expect(editing).toEqual([true, false]);
	}
	const { rename, renamed, editing } = controller(true);
	rename.start("Current");
	rename.cancel();
	rename.commit("Typed but escaped");
	expect(renamed).toEqual([]);
	expect(editing).toEqual([true, false]);
});

test("a commit while rename capability is unknown stays pending until a capable welcome arrives", () => {
	const { rename, renamed, editing } = controller(true);
	rename.start("Current");
	rename.setCanRename(false);
	rename.commit("Offline edit");
	expect(renamed).toEqual([]);
	expect(editing).toEqual([true]);
	rename.setCanRename(false);
	expect(renamed).toEqual([]);
	rename.setCanRename(true);
	expect(renamed).toEqual(["Offline edit"]);
	expect(editing).toEqual([true, false]);
	rename.setCanRename(true);
	expect(renamed).toEqual(["Offline edit"]);
});

test("escaping a pending edit drops it and a restored capability sends nothing", () => {
	const { rename, renamed, editing } = controller(false);
	rename.start("Current");
	rename.commit("Pending");
	rename.cancel();
	rename.commit("Pending");
	expect(editing).toEqual([true, false]);
	rename.setCanRename(true);
	expect(renamed).toEqual([]);
});
