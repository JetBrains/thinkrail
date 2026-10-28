import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
	PiEvent,
	Project,
	SessionStateRecord,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import { selectKnownChatTitle, useAppStore } from "../store";
import {
	backfillOrder,
	createPaletteBackfill,
	mergeProjectWorkspaces,
	noteListedSessions,
	projectNeedsWorkspaceList,
} from "./paletteBackfill";

const project = (id: string): Project => ({
	id,
	name: id,
	path: `/repos/${id}`,
	slug: id,
	lastOpened: 0,
});

const workspace = (id: string, projectId: string, name = id): Workspace => ({
	id,
	projectId,
	name,
	branch: name,
	baseBranch: "main",
	worktreePath: `/worktrees/${id}`,
});

const record = (sessionId: string, workspaceId: string, projectId: string): SessionStateRecord => ({
	sessionId,
	workspaceId,
	projectId,
	state: {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
	},
});

const summary = (sessionId: string, workspaceId: string, title: string): SessionSummary => ({
	sessionId,
	workspaceId,
	title,
	model: null,
	thinkingLevel: "medium",
	isStreaming: false,
	messageCount: 2,
	updatedAt: 1_000,
	live: false,
});

const rename = (sessionId: string, name: string) => {
	const event: PiEvent = { type: "session_info_changed", name };
	useAppStore.getState().handlePiEvents([{ sessionId, event }]);
};

const title = (workspaceId: string, sessionId: string) =>
	selectKnownChatTitle(useAppStore.getState(), workspaceId, sessionId);

const tick = async () => {
	for (let index = 0; index < 6; index++) await Promise.resolve();
};

const initial = useAppStore.getInitialState();

beforeEach(() => useAppStore.setState(initial, true));
afterEach(() => useAppStore.setState(initial, true));

describe("listed sessions join the history projection", () => {
	test("a backfilled chat in an unvisited workspace follows a rename broadcast to every client", () => {
		useAppStore.setState({ projects: [project("p1")] });
		noteListedSessions("w1", [summary("s1", "w1", "Old title"), summary("x", "other", "Not here")]);
		expect(title("w1", "s1")).toBe("Old title");
		expect(title("w1", "x")).toBeNull();
		rename("s1", "New title");
		expect(title("w1", "s1")).toBe("New title");
	});

	test("an unnamed tab kept in an inactive layout does not hide the title the history holds", () => {
		useAppStore.setState({
			layoutDocumentsByWorkspace: {
				w1: {
					center: {
						kind: "group",
						id: "g1",
						tabs: [{ kind: "chat", id: "t1", sessionId: "s1", name: "" }],
					},
				} as never,
			},
			closedChatsByWorkspace: { w1: [{ sessionId: "s1", title: "Durable name", closedAt: 0 }] },
		});
		expect(title("w1", "s1")).toBe("Durable name");
	});
});

describe("project membership refresh", () => {
	test("a project is listed when it has no list, or when a reported workspace is missing from it", () => {
		useAppStore.setState({
			projects: [project("p1"), project("p2"), project("p3")],
			workspaces: { p2: [workspace("w2", "p2")], p3: [workspace("w3", "p3")] },
			sessionStateByWorkspace: {
				w2: { s2: record("s2", "w2", "p2") },
				"w-new": { s3: record("s3", "w-new", "p3") },
				"w-gone": { s4: record("s4", "w-gone", "p2") },
			},
			removedWorkspaceIds: { "w-gone": true },
		});
		const state = useAppStore.getState();
		expect(projectNeedsWorkspaceList(state, "p1")).toBe(true);
		expect(projectNeedsWorkspaceList(state, "p2")).toBe(false);
		expect(projectNeedsWorkspaceList(state, "p3")).toBe(true);
		expect(projectNeedsWorkspaceList(state, "closed")).toBe(false);
		expect(backfillOrder(state).projectIds).toEqual(["p1", "p3"]);
	});

	test("a refresh keeps the host's order, keeps rows that arrived meanwhile, and never replaces them", () => {
		const fresh = workspace("w1", "p1", "renamed by a push");
		const pushed = workspace("w9", "p1");
		useAppStore.setState({
			projects: [project("p1")],
			workspaces: { p1: [fresh, workspace("w3", "p1"), pushed] },
		});
		mergeProjectWorkspaces("p1", [
			workspace("w1", "p1", "stale name"),
			workspace("w2", "p1"),
			workspace("w3", "p1"),
		]);
		const rows = useAppStore.getState().workspaces.p1 ?? [];
		expect(rows.map((row) => row.id)).toEqual(["w1", "w2", "w3", "w9"]);
		expect(rows[0]).toBe(fresh);

		mergeProjectWorkspaces("p9", [workspace("w9", "p9")]);
		expect(useAppStore.getState().workspaces.p9).toBeUndefined();
	});
});

describe("title backfill order", () => {
	test("only workspaces with an untitled chat are listed, the active one first, then the context project", () => {
		useAppStore.setState({
			projects: [project("p1"), project("p2")],
			workspaces: {
				p1: [workspace("w1", "p1"), workspace("w4", "p1")],
				p2: [workspace("w2", "p2"), workspace("w3", "p2")],
			},
			activeWorkspaceId: "w1",
			sessionStateByWorkspace: {
				w2: { b: record("b", "w2", "p2") },
				w3: { c: record("c", "w3", "p2") },
				w4: { d: record("d", "w4", "p1") },
				w1: { a: record("a", "w1", "p1") },
			},
			closedChatsByWorkspace: { w3: [{ sessionId: "c", title: "Known", closedAt: 0 }] },
		});
		expect(backfillOrder(useAppStore.getState()).workspaceIds).toEqual(["w1", "w4", "w2"]);
		expect(backfillOrder(useAppStore.getState(), (id) => id === "w3").workspaceIds).toEqual([
			"w1",
			"w4",
			"w2",
			"w3",
		]);
	});
});

describe("the palette backfill against deferred host replies", () => {
	function connectedWorkspace() {
		useAppStore.setState({
			status: "connected",
			connectionGeneration: 1,
			welcomeGeneration: 1,
			projects: [project("p1")],
			workspaces: { p1: [workspace("w1", "p1")] },
			sessionStateByWorkspace: { w1: { s1: record("s1", "w1", "p1") } },
		});
	}

	function deferredSources() {
		const calls: {
			workspaceId: string;
			resolve: (titles: string) => void;
			reject: (e: unknown) => void;
		}[] = [];
		const backfill = createPaletteBackfill({
			listSessions: (workspaceId) =>
				new Promise((resolve, reject) => {
					calls.push({
						workspaceId,
						resolve: (name) => resolve([summary("s1", workspaceId, name)]),
						reject,
					});
				}),
			listWorkspaces: async () => [workspace("w1", "p1")],
			isRefusal: (error) => error instanceof Error && error.message === "refused",
			concurrency: 4,
		});
		return { calls, backfill };
	}

	test("a rename that lands while a listing is in flight wins over the listing's older title", async () => {
		connectedWorkspace();
		const { calls, backfill } = deferredSources();
		backfill.schedule();
		expect(calls).toHaveLength(1);
		rename("s1", "Named by the agent");
		calls[0]?.resolve("");
		await tick();
		expect(title("w1", "s1")).not.toBe("");

		backfill.schedule();
		expect(calls).toHaveLength(2);
		calls[1]?.resolve("Named by the agent");
		await tick();
		expect(title("w1", "s1")).toBe("Named by the agent");
		backfill.schedule();
		expect(calls).toHaveLength(2);
	});

	test("a reconnect lists a workspace again, so a rename missed while away is picked up", async () => {
		connectedWorkspace();
		const { calls, backfill } = deferredSources();
		backfill.schedule();
		calls[0]?.resolve("Before");
		await tick();
		expect(title("w1", "s1")).toBe("Before");
		backfill.schedule();
		expect(calls).toHaveLength(1);

		useAppStore.setState({ connectionGeneration: 2, welcomeGeneration: 2 });
		backfill.schedule();
		expect(calls).toHaveLength(2);
		calls[1]?.resolve("Renamed while away");
		await tick();
		expect(title("w1", "s1")).toBe("Renamed while away");
	});

	test("a reply from an earlier connection is dropped and the listing runs again on the new one", async () => {
		connectedWorkspace();
		const { calls, backfill } = deferredSources();
		backfill.schedule();
		useAppStore.setState({ connectionGeneration: 2, welcomeGeneration: 2 });
		backfill.schedule();
		expect(calls).toHaveLength(1);
		calls[0]?.resolve("From the old connection");
		await tick();
		expect(title("w1", "s1")).toBeNull();
		expect(calls).toHaveLength(2);
		calls[1]?.resolve("Current");
		await tick();
		expect(title("w1", "s1")).toBe("Current");
	});

	test("a refusal marks the workspace listed; a timeout leaves it for the next schedule", async () => {
		connectedWorkspace();
		const { calls, backfill } = deferredSources();
		backfill.schedule();
		calls[0]?.reject(new Error("timed out"));
		await tick();
		backfill.schedule();
		expect(calls).toHaveLength(2);
		calls[1]?.reject(new Error("refused"));
		await tick();
		backfill.schedule();
		expect(calls).toHaveLength(2);
	});
});
