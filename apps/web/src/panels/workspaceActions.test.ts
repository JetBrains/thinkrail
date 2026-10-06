import { expect, test } from "bun:test";
import { WORKSPACE_RENAME_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import {
	canRenameWorkspace,
	createRenameController,
	keptSettledRemovalsText,
	settledRemovalTarget,
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
	const renamed: Array<[string, string]> = [];
	const editing: boolean[] = [];
	const rename = createRenameController<string>({
		canRename,
		onRename: (target, name) => renamed.push([target, name]),
		onEditingChange: (next) => editing.push(next),
	});
	return { rename, renamed, editing };
}

test("a changed commit dispatches once, to the edit-start target, and closes the editor", () => {
	const { rename, renamed, editing } = controller(true);
	rename.start("A", "Current");
	rename.commit(" Next ");
	expect(renamed).toEqual([["A", "Next"]]);
	expect(editing).toEqual([true, false]);
	rename.commit("Again");
	expect(renamed).toEqual([["A", "Next"]]);
});

test("blank, unchanged, or cancelled edits close without a request", () => {
	for (const input of ["   ", "Current"]) {
		const { rename, renamed, editing } = controller(true);
		rename.start("A", "Current");
		rename.commit(input);
		expect(renamed).toEqual([]);
		expect(editing).toEqual([true, false]);
	}
	const { rename, renamed, editing } = controller(true);
	rename.start("A", "Current");
	rename.cancel();
	rename.commit("Typed but escaped");
	expect(renamed).toEqual([]);
	expect(editing).toEqual([true, false]);
});

test("a commit while rename capability is unknown stays pending until a capable welcome arrives", () => {
	const { rename, renamed, editing } = controller(true);
	rename.start("A", "Current");
	rename.setCanRename(false);
	rename.commit("Offline edit");
	expect(renamed).toEqual([]);
	expect(editing).toEqual([true]);
	rename.setCanRename(false);
	expect(renamed).toEqual([]);
	rename.setCanRename(true);
	expect(renamed).toEqual([["A", "Offline edit"]]);
	expect(editing).toEqual([true, false]);
	rename.setCanRename(true);
	expect(renamed).toEqual([["A", "Offline edit"]]);
});

test("escaping a pending edit drops it and a restored capability sends nothing", () => {
	const { rename, renamed, editing } = controller(false);
	rename.start("A", "Current");
	rename.commit("Pending");
	rename.cancel();
	rename.commit("Pending");
	expect(editing).toEqual([true, false]);
	rename.setCanRename(true);
	expect(renamed).toEqual([]);
});

test("reset abandons an open or pending edit so a later capable welcome renames nothing", () => {
	const { rename, renamed, editing } = controller(false);
	rename.start("A", "Current");
	rename.commit("Pending for A");
	rename.reset();
	expect(editing).toEqual([true, false]);
	rename.setCanRename(true);
	rename.commit("Stale blur after reset");
	expect(renamed).toEqual([]);
	rename.reset();
	expect(editing).toEqual([true, false]);
});

test("a bulk remove names the rows the host kept, and says nothing when every row went", () => {
	expect(keptSettledRemovalsText([])).toBeNull();
	expect(keptSettledRemovalsText([{ id: "a", reason: "running" }])).toBe(
		"Kept 1 workspace that became active after the preview.",
	);
	expect(
		keptSettledRemovalsText([
			{ id: "a", reason: "changed" },
			{ id: "b", reason: "active" },
		]),
	).toBe("Kept 2 workspaces that became active after the preview.");
});

test("a bulk-remove target carries exactly the record facts the row was judged settled from", () => {
	expect(settledRemovalTarget(managed)).toEqual({ id: "w1" });
	expect(
		settledRemovalTarget({
			...managed,
			lastActiveAt: 1_000,
			review: { kind: "pull-request", number: 618, state: "merged", changedAt: 900 },
		}),
	).toEqual({ id: "w1", lastActiveAt: 1_000, reviewState: "merged" });
	expect(
		settledRemovalTarget({ ...managed, review: { kind: "pull-request", number: 618 } }),
	).toEqual({ id: "w1" });
});
