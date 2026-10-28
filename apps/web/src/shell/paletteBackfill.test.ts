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

const initial = useAppStore.getInitialState();

beforeEach(() => useAppStore.setState(initial, true));
afterEach(() => useAppStore.setState(initial, true));

describe("listed sessions join the history projection", () => {
	test("a backfilled chat in an unvisited workspace follows a rename broadcast to every client", () => {
		useAppStore.setState({ projects: [project("p1")] });
		noteListedSessions("w1", [summary("s1", "w1", "Old title"), summary("x", "other", "Not here")]);
		const state = () => useAppStore.getState();
		expect(selectKnownChatTitle(state(), "w1", "s1")).toBe("Old title");
		expect(selectKnownChatTitle(state(), "w1", "x")).toBeNull();

		const renamed: PiEvent = { type: "session_info_changed", name: "New title" };
		state().handlePiEvents([{ sessionId: "s1", event: renamed }]);
		expect(selectKnownChatTitle(state(), "w1", "s1")).toBe("New title");
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

	test("a refresh adds the missing workspaces and never replaces rows that arrived meanwhile", () => {
		const fresh = workspace("w1", "p1", "renamed by a push");
		useAppStore.setState({ projects: [project("p1")], workspaces: { p1: [fresh] } });
		mergeProjectWorkspaces("p1", [workspace("w1", "p1", "stale name"), workspace("w2", "p1")]);
		const rows = useAppStore.getState().workspaces.p1 ?? [];
		expect(rows.map((row) => row.id)).toEqual(["w1", "w2"]);
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
	});
});
