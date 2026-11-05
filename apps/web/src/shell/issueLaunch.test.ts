import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import * as openChat from "../panels/openChat";
import { useAppStore } from "../store";
import * as wireTransport from "../transport/wireTransport";
import { openIssueSession } from "./WorkspaceWorkbench";

const row = (id: string, projectId: string): Workspace => ({
	id,
	projectId,
	name: id,
	branch: id,
	baseBranch: "main",
	worktreePath: `/worktrees/${id}`,
});

const initial = useAppStore.getInitialState();
let restore: Array<() => void> = [];

function stubWorkspaces(rows: Workspace[] | Error): string[] {
	const requested: string[] = [];
	const spy = spyOn(wireTransport, "getTransport").mockReturnValue({
		request: async (method: string, params: { projectId: string }) => {
			if (rows instanceof Error) throw rows;
			requested.push(`${method}:${params.projectId}`);
			return rows;
		},
		httpBase: () => "",
	} as never);
	restore.push(() => spy.mockRestore());
	return requested;
}

function stubOpenChat(): Array<[string, string]> {
	const opened: Array<[string, string]> = [];
	const spy = spyOn(openChat, "openChatInTab").mockImplementation((async (
		workspaceId: string,
		sessionId: string,
	) => {
		opened.push([workspaceId, sessionId]);
	}) as never);
	restore.push(() => spy.mockRestore());
	return opened;
}

beforeEach(() => useAppStore.setState(initial, true));
afterEach(() => {
	for (const undo of restore) undo();
	restore = [];
	useAppStore.setState(initial, true);
});

test("an issue launch refreshes the project's workspaces, activates it and opens its chat", async () => {
	const requested = stubWorkspaces([row("w1", "p1"), row("w2", "p1")]);
	const opened = stubOpenChat();
	await openIssueSession("p1", { workspaceId: "w2", sessionId: "s2" });
	const state = useAppStore.getState();
	expect(requested).toEqual(["workspace.list:p1"]);
	expect(state.workspaces.p1?.map((workspace) => workspace.id)).toEqual(["w1", "w2"]);
	expect(state.selectedProjectId).toBe("p1");
	expect(state.activeWorkspaceId).toBe("w2");
	expect(state.routeChatTarget?.sessionId).toBe("s2");
	expect(opened).toEqual([["w2", "s2"]]);
});

test("a launch whose workspace the project list omits still activates the host's workspace", async () => {
	const requested = stubWorkspaces([row("w1", "p1")]);
	const opened = stubOpenChat();
	await openIssueSession("p1", { workspaceId: "w9", sessionId: "s9" });
	const state = useAppStore.getState();
	expect(requested).toEqual(["workspace.list:p1"]);
	expect(state.activeWorkspaceId).toBe("w9");
	expect(state.selectedProjectId).toBe("p1");
	expect(opened).toEqual([["w9", "s9"]]);
});

test("a failed workspace refresh reports a keyed toast and opens nothing", async () => {
	stubWorkspaces(new Error("offline"));
	const opened = stubOpenChat();
	await openIssueSession("p1", { workspaceId: "w1", sessionId: "s1" });
	const state = useAppStore.getState();
	expect(opened).toEqual([]);
	expect(state.activeWorkspaceId).toBeNull();
	expect(state.toasts.map((toast) => toast.message)).toEqual([
		EN["shell.workbench.issueLaunchFailed"] ?? "",
	]);
});
