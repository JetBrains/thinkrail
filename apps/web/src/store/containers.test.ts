import { beforeEach, expect, test } from "bun:test";
import type { Container, Project, SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import {
	containerStacks,
	selectActiveContainerId,
	selectAttachableWorkspaces,
	selectContainerGroup,
	selectContainerIsRunning,
	selectContainerNeedsAttention,
	selectContainerOfWorkspace,
	selectContainerOrchestrator,
	selectContainerOverview,
	selectContainers,
	selectContainerTree,
	selectLastContainerMember,
	selectStandaloneChats,
	selectStandalonePartition,
	selectWorkspaceChatState,
} from "./selectors";

const container = (id: string, workspaceIds: string[], createdAt = 1): Container => ({
	id,
	name: `Container ${id}`,
	workspaceIds,
	createdAt,
	updatedAt: createdAt,
});

beforeEach(() => {
	useAppStore.setState({ containers: {}, collapsedContainerIds: {}, containerDialog: null });
});

const project = (id: string, kind?: Project["kind"]): Project => ({
	id,
	name: id === "chats" ? "Chats" : `Project ${id}`,
	path: `/repo/${id}`,
	slug: id,
	lastOpened: 1,
	...(kind ? { kind } : {}),
});

const ws = (id: string, projectId: string, overrides: Partial<Workspace> = {}): Workspace => ({
	id,
	projectId,
	name: id,
	branch: `branch-${id}`,
	worktreePath: `/tmp/${id}`,
	baseBranch: "main",
	...overrides,
});

const projects = [project("p1"), project("p2"), project("chats", "chats")];
const orchestrator = ws("orch", "chats", { kind: "chat", orchestratorOf: "single" });
const workspaces: Record<string, Workspace[]> = {
	p1: [ws("p1-default", "p1", { kind: "default" }), ws("a", "p1"), ws("b", "p1"), ws("c", "p1")],
	p2: [ws("x", "p2"), ws("y", "p2")],
	chats: [ws("chat", "chats", { kind: "chat", lastActiveAt: 5 }), orchestrator],
};

function treeState(held: Container[]) {
	return {
		containers: Object.fromEntries(held.map((each) => [each.id, each])),
		projects,
		workspaces,
	};
}

function record(workspaceId: string, state: Partial<SessionStateRecord["state"]>) {
	return {
		[workspaceId]: {
			s1: {
				sessionId: "s1",
				workspaceId,
				projectId: "p1",
				state: {
					execution: "idle",
					runId: null,
					needsInput: null,
					completion: null,
					completionUnread: false,
					queuedCount: 0,
					backgroundWork: false,
					...state,
				},
			} as SessionStateRecord,
		},
	};
}

test("a container list replaces the held containers whole", () => {
	const store = useAppStore.getState();
	store.installContainers([container("old", ["w0"])]);
	store.installContainers([container("b", ["w2"], 2), container("a", ["w1"], 2)]);
	expect(Object.keys(useAppStore.getState().containers).sort()).toEqual(["a", "b"]);
	expect(selectContainers(useAppStore.getState()).map((held) => held.id)).toEqual(["a", "b"]);
	store.installContainers([]);
	expect(useAppStore.getState().containers).toEqual({});
});

test("pushes upsert a full snapshot by id and remove by id, idempotently", () => {
	const store = useAppStore.getState();
	store.applyContainerUpdated(container("c1", ["w1"]));
	store.applyContainerUpdated(container("c2", ["w3"], 5));
	store.applyContainerUpdated({ ...container("c1", ["w1", "w2"]), name: "Stack" });
	expect(selectContainers(useAppStore.getState())).toEqual([
		{ ...container("c1", ["w1", "w2"]), name: "Stack" },
		container("c2", ["w3"], 5),
	]);
	store.applyContainerRemoved("c1");
	const afterRemoval = useAppStore.getState().containers;
	store.applyContainerRemoved("c1");
	expect(useAppStore.getState().containers).toBe(afterRemoval);
	expect(Object.keys(afterRemoval)).toEqual(["c2"]);
});

test("a workspace's container is the one listing it; a standalone workspace has none", () => {
	useAppStore
		.getState()
		.installContainers([container("c1", ["w1", "w2"]), container("c2", ["w3"])]);
	const state = useAppStore.getState();
	expect(selectContainerOfWorkspace(state, "w2")?.id).toBe("c1");
	expect(selectContainerOfWorkspace(state, "w3")?.id).toBe("c2");
	expect(selectContainerOfWorkspace(state, "w4")).toBeNull();
});

test("a single-project container nests in its project and a cross-project one gets its own section", () => {
	const tree = selectContainerTree(
		treeState([container("single", ["b", "a"]), container("cross", ["c", "x"], 2)]),
	);
	expect(Object.keys(tree.byProject)).toEqual(["p1"]);
	expect(tree.byProject.p1?.map((group) => group.container.id)).toEqual(["single"]);
	expect(tree.byProject.p1?.[0]?.members.map((member) => member.id)).toEqual(["b", "a"]);
	expect(tree.byProject.p1?.[0]?.projectId).toBe("p1");
	expect(tree.byProject.p1?.[0]?.orchestrator?.id).toBe("orch");
	expect(tree.crossProject.map((group) => group.container.id)).toEqual(["cross"]);
	expect(tree.crossProject[0]?.projectId).toBeNull();
	expect(tree.crossProject[0]?.orchestrator).toBeNull();
	expect([...tree.memberIds].sort()).toEqual(["a", "b", "c", "x"]);
	expect(tree.unresolved).toBe(false);
});

test("a member whose project list is not loaded is unresolved and not shown; an unshown container is skipped", () => {
	const tree = selectContainerTree(
		treeState([container("partial", ["a", "elsewhere"]), container("ghost", ["nowhere"], 3)]),
	);
	expect(tree.unresolved).toBe(true);
	expect(tree.byProject.p1?.[0]?.members.map((member) => member.id)).toEqual(["a"]);
	expect(tree.crossProject).toEqual([]);
	expect(tree.memberIds.has("nowhere")).toBe(true);
});

test("members are not duplicated as flat project rows, and the settled partition still splits the rest", () => {
	const base = {
		...treeState([container("single", ["a", "b"])]),
		workspaceSettlingSupported: true,
		sessionStateByWorkspace: {},
		activeWorkspaceId: null,
		activeWorkspaceLiveLatch: false,
		settleIdleDays: null,
	};
	const partition = selectStandalonePartition(base, "p1", 10);
	expect(partition.live.map((row) => row.id)).toEqual(["p1-default", "c"]);
	const settled = {
		...base,
		workspaces: {
			...workspaces,
			p1: [...(workspaces.p1 ?? []), ws("d", "p1", { settledOverride: "settled" })],
		},
	};
	expect(
		selectStandalonePartition(settled, "p1", 10).settled.map((row) => row.workspace.id),
	).toEqual(["d"]);
	expect(selectStandalonePartition({ ...base, containers: {} }, "p1", 10).live).toHaveLength(4);
});

test("the orchestrator chat is left out of the Chats section while its container is loaded", () => {
	const state = treeState([container("single", ["a", "b"])]);
	expect(selectStandaloneChats(state).map((chat) => chat.id)).toEqual(["chat"]);
});

test("an orchestrator chat whose container is not loaded falls back into the Chats section", () => {
	expect(selectStandaloneChats(treeState([])).map((chat) => chat.id)).toEqual(["chat", "orch"]);
	expect(
		selectStandaloneChats(treeState([container("other", ["a"])])).map((chat) => chat.id),
	).toEqual(["chat", "orch"]);
});

test("a container rolls up its members' and orchestrator's attention and work", () => {
	const group = selectContainerGroup(treeState([container("single", ["a", "b"])]), "single");
	if (!group) throw new Error("container group missing");
	expect(selectContainerNeedsAttention({ sessionStateByWorkspace: {} }, group)).toBe(false);
	expect(
		selectContainerNeedsAttention(
			{ sessionStateByWorkspace: record("orch", { completionUnread: true }) },
			group,
		),
	).toBe(true);
	expect(
		selectContainerIsRunning(
			{ sessionStateByWorkspace: record("b", { execution: "running" }) },
			group,
		),
	).toBe(true);
	expect(
		selectContainerIsRunning(
			{ sessionStateByWorkspace: record("c", { execution: "running" }) },
			group,
		),
	).toBe(false);
	expect(selectContainerGroup(treeState([]), "single")).toBeNull();
});

test("the active container is the member's or the orchestrator's; attachable rows exclude members, Default and chats", () => {
	const state = treeState([container("single", ["a", "b"])]);
	expect(selectActiveContainerId({ ...state, activeWorkspaceId: "b" })).toBe("single");
	expect(selectActiveContainerId({ ...state, activeWorkspaceId: "orch" })).toBe("single");
	expect(selectActiveContainerId({ ...state, activeWorkspaceId: "c" })).toBeNull();
	expect(selectAttachableWorkspaces(state).map((row) => row.id)).toEqual(["c", "y", "x"]);
});

test("collapsing a container is per-browser view state that a removal forgets", () => {
	const store = useAppStore.getState();
	store.installContainers([container("c1", ["w1"])]);
	store.toggleContainerCollapsed("c1");
	expect(useAppStore.getState().collapsedContainerIds).toEqual({ c1: true });
	store.expandContainer("c1");
	expect(useAppStore.getState().collapsedContainerIds).toEqual({});
	store.toggleContainerCollapsed("c1");
	store.applyContainerRemoved("c1");
	expect(useAppStore.getState().collapsedContainerIds).toEqual({});
	store.hydrateCollapsedContainers(["c9"]);
	expect(useAppStore.getState().collapsedContainerIds).toEqual({ c9: true });
});

const names = (rows: readonly Workspace[]) => rows.map((row) => row.id);

test("the stack line follows each member's base to a sibling's branch, independents apart", () => {
	const a = ws("a", "p1", { baseBranch: "origin/main" });
	const b = ws("b", "p1", { baseBranch: "branch-a" });
	const c = ws("c", "p1", { baseBranch: "origin/branch-b" });
	const x = ws("x", "p2", { baseBranch: "branch-a" });
	const y = ws("y", "p2", { baseBranch: "develop" });
	const stacks = containerStacks([c, x, a, b, y]);
	expect(stacks.lines.map((line) => [line.base, names(line.members)])).toEqual([
		["main", ["a", "b", "c"]],
	]);
	expect(names(stacks.independent)).toEqual(["x", "y"]);
	expect(stacks.stackedOn.get("b")?.id).toBe("a");
	expect(stacks.stackedOn.get("c")?.id).toBe("b");
	expect(stacks.stackedOn.has("x")).toBe(false);
});

test("a fork continues on its own line from the member it forks, and a base cycle is broken", () => {
	const a = ws("a", "p1");
	const b = ws("b", "p1", { baseBranch: "branch-a" });
	const c = ws("c", "p1", { baseBranch: "branch-a" });
	const d = ws("d", "p1", { baseBranch: "branch-c" });
	expect(
		containerStacks([a, b, c, d]).lines.map((line) => [line.base, names(line.members)]),
	).toEqual([
		["main", ["a", "b"]],
		["branch-a", ["c", "d"]],
	]);
	const looped = containerStacks([
		ws("p", "p1", { baseBranch: "branch-q" }),
		ws("q", "p1", { baseBranch: "branch-p" }),
	]);
	expect(looped.lines.map((line) => [line.base, names(line.members)])).toEqual([
		["branch-q", ["p", "q"]],
	]);
	expect(looped.independent).toEqual([]);
	expect(containerStacks([a]).lines).toEqual([]);
});

test("a member's chat state is its most urgent chat's", () => {
	const states = (...chats: Partial<SessionStateRecord["state"]>[]) => ({
		sessionStateByWorkspace: {
			a: Object.fromEntries(
				chats.map((chat, index) => {
					const held = record("a", chat).a?.s1;
					if (!held) throw new Error("session record missing");
					return [`s${index}`, { ...held, sessionId: `s${index}` }];
				}),
			),
		},
	});
	expect(selectWorkspaceChatState({ sessionStateByWorkspace: {} }, "a")).toBe("idle");
	expect(selectWorkspaceChatState(states({}, { execution: "running" }), "a")).toBe("working");
	expect(
		selectWorkspaceChatState(
			states(
				{ execution: "running" },
				{ needsInput: { interactionId: "i", kind: "tool-response", toolCallId: "t" } },
			),
			"a",
		),
	).toBe("needs_you");
});

test("the overview resolves members in order with their project, stack parent and chat state", () => {
	const stacked = {
		...treeState([container("single", ["b", "a"])]),
		workspaces: {
			...workspaces,
			p1: [ws("a", "p1"), ws("b", "p1", { baseBranch: "branch-a" })],
		},
		sessionStateByWorkspace: record("b", { execution: "running" }),
	};
	const overview = selectContainerOverview(stacked, "single");
	expect(
		overview?.members.map((member) => [
			member.workspace.id,
			member.projectName,
			member.stackedOn?.id ?? null,
			member.chat,
		]),
	).toEqual([
		["b", "Project p1", "a", "working"],
		["a", "Project p1", null, "idle"],
	]);
	expect(overview?.stacks.lines.map((line) => names(line.members))).toEqual([["a", "b"]]);
	expect(selectContainerOverview(stacked, "gone")).toBeNull();
	expect(selectContainerOrchestrator(stacked, "single")?.id).toBe("orch");
	expect(selectContainerOrchestrator(stacked, "cross")).toBeNull();
});

test("the last member is the one most recently entered, else the first", () => {
	const group = selectContainerGroup(treeState([container("single", ["a", "b"])]), "single");
	if (!group) throw new Error("container group missing");
	expect(selectLastContainerMember({ workspaceSelectionHistory: ["c", "b", "a"] }, group)?.id).toBe(
		"b",
	);
	expect(selectLastContainerMember({ workspaceSelectionHistory: ["x"] }, group)?.id).toBe("a");
});
