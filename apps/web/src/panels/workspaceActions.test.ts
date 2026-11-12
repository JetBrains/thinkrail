import { afterEach, expect, spyOn, test } from "bun:test";
import {
	type Project,
	WORKSPACE_RENAME_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import * as wireTransport from "../transport/wireTransport";
import {
	canRenameWorkspace,
	canSettleWorkspace,
	createRenameController,
	moveProject,
	workspaceRenameValue,
} from "./workspaceActions";

let restoreTransport: () => void = () => {};

afterEach(() => restoreTransport());

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

test("settling is offered for a worktree only — never the Default workspace or a chat without a project", () => {
	expect(canSettleWorkspace(WORKSPACE_SETTLE_PROTOCOL_VERSION, managed)).toBe(true);
	expect(
		canSettleWorkspace(WORKSPACE_SETTLE_PROTOCOL_VERSION, { ...managed, kind: "default" }),
	).toBe(false);
	expect(canSettleWorkspace(WORKSPACE_SETTLE_PROTOCOL_VERSION, { ...managed, kind: "chat" })).toBe(
		false,
	);
	expect(canSettleWorkspace(WORKSPACE_SETTLE_PROTOCOL_VERSION - 1, managed)).toBe(false);
});

test("a replayed move reply never reopens a project the host's newer snapshot closed", async () => {
	const project = (id: string, rank: number): Project => ({
		id,
		name: id,
		path: `/projects/${id}`,
		slug: id,
		lastOpened: 100,
		rank,
	});
	const moved = project("p1", 300);
	const target = project("p2", 200);
	useAppStore.getState().installProjectSnapshot([target], [{ ...moved, closed: true }, target]);
	const requests: [string, unknown][] = [];
	const transport = {
		request: (method: string, params: unknown) => {
			requests.push([method, params]);
			return Promise.resolve(moved);
		},
	} as unknown as ReturnType<typeof wireTransport.getTransport>;
	const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
	restoreTransport = () => spy.mockRestore();

	expect(await moveProject("p1", "p2", "before")).toBe(true);

	expect(requests).toEqual([["project.move", { id: "p1", targetId: "p2", placement: "before" }]]);
	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p2"]);
	expect(state.recentProjects.find((candidate) => candidate.id === "p1")?.closed).toBe(true);
});
