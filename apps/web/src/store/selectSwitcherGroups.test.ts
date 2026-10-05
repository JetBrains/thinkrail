import { describe, expect, test } from "bun:test";
import type { Project, SessionStateRecord, Workspace } from "@thinkrail/contracts";
import type { WorkspaceLayoutDocument } from "../shell/layout";
import { selectSwitcherGroups } from "./selectSwitcherGroups";

const project = (id: string, name: string): Project => ({
	id,
	name,
	path: `/path/${id}`,
	slug: id,
	lastOpened: Date.now(),
});

const workspace = (id: string, projectId: string, name: string): Workspace => ({
	id,
	projectId,
	name,
	branch: "main",
	baseBranch: "main",
	kind: "default",
});

const layoutWithChat = (sessionId: string, name: string): WorkspaceLayoutDocument => ({
	version: 2,
	center: {
		kind: "group",
		id: "center",
		tabs: [{ kind: "chat", id: `chat-${sessionId}`, sessionId, name, workspaceId: "w1" }],
	},
	left: { groups: [], visible: true, width: 200, alignment: "start" },
	right: { groups: [], visible: true, width: 200, alignment: "end" },
	bottom: { groups: [], visible: true, height: 200, alignment: "end" },
});

const stateRecord = (
	sessionId: string,
	workspaceId: string,
	projectId: string,
	overrides: Partial<SessionStateRecord["state"]> = {},
): SessionStateRecord => ({
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
		...overrides,
	},
});

const baseState = (records: SessionStateRecord[]) => {
	const sessionStateByWorkspace: Record<string, Record<string, SessionStateRecord>> = {};
	for (const record of records) {
		const byWorkspace = sessionStateByWorkspace[record.workspaceId] ?? {};
		byWorkspace[record.sessionId] = record;
		sessionStateByWorkspace[record.workspaceId] = byWorkspace;
	}
	return {
		projects: [project("p1", "Project One")],
		workspaces: { p1: [workspace("w1", "p1", "Workspace 1")] },
		sessionStateByWorkspace,
		layoutDocumentsByWorkspace: {},
		closedChatsByWorkspace: {},
	};
};

describe("selectSwitcherGroups", () => {
	test("excludes idle sessions entirely", () => {
		const state = baseState([stateRecord("s1", "w1", "p1")]);
		expect(selectSwitcherGroups(state)).toEqual([]);
	});

	test("includes sessions needing attention or running, drops idle", () => {
		const state = baseState([
			stateRecord("s_needs", "w1", "p1", { needsInput: { inputKind: "ask_user_question" } }),
			stateRecord("s_running", "w1", "p1", { execution: "running" }),
			stateRecord("s_idle", "w1", "p1"),
		]);
		const groups = selectSwitcherGroups(state);
		expect(groups).toHaveLength(1);
		const ids = groups[0]?.sessions.map((s) => s.sessionId) ?? [];
		expect(ids).toEqual(["s_needs", "s_running"]);
	});

	test("computes attention status and sorts by priority", () => {
		const state = baseState([
			stateRecord("s_running", "w1", "p1", { execution: "running" }),
			stateRecord("s_idle", "w1", "p1"),
			stateRecord("s_unread", "w1", "p1", {
				completionUnread: true,
				completion: { completionId: "c2", outcome: "succeeded" },
			}),
			stateRecord("s_error", "w1", "p1", {
				completionUnread: true,
				completion: { completionId: "c1", outcome: "failed", failure: "error" },
			}),
			stateRecord("s_needs", "w1", "p1", { needsInput: { inputKind: "ask_user_question" } }),
		]);
		const sessions = selectSwitcherGroups(state)[0]?.sessions ?? [];
		expect(sessions.map((s) => s.attention)).toEqual(["needs-input", "error", "unread", "running"]);
	});

	test("resolves chat title from layout document, else leaves it empty for backfill", () => {
		const state = {
			...baseState([
				stateRecord("s1", "w1", "p1", { execution: "running" }),
				stateRecord("s2", "w1", "p1", { execution: "running" }),
			]),
			layoutDocumentsByWorkspace: { w1: layoutWithChat("s1", "Fix login") },
		};
		const sessions = selectSwitcherGroups(state)[0]?.sessions ?? [];
		expect(sessions.find((s) => s.sessionId === "s1")?.chatTitle).toBe("Fix login");
		expect(sessions.find((s) => s.sessionId === "s2")?.chatTitle).toBe("");
	});

	test("resolves workspace name from store, else empty", () => {
		const state = baseState([stateRecord("s1", "w1", "p1", { execution: "running" })]);
		expect(selectSwitcherGroups(state)[0]?.sessions[0]?.workspaceName).toBe("Workspace 1");

		const stateUnknownWs = baseState([stateRecord("s1", "w9", "p1", { execution: "running" })]);
		expect(selectSwitcherGroups(stateUnknownWs)[0]?.sessions[0]?.workspaceName).toBe("");
	});

	test("needsAttention is false when only running sessions", () => {
		const running = baseState([stateRecord("s1", "w1", "p1", { execution: "running" })]);
		expect(selectSwitcherGroups(running)[0]?.needsAttention).toBe(false);

		const needs = baseState([
			stateRecord("s1", "w1", "p1", { needsInput: { inputKind: "ask_user_question" } }),
		]);
		expect(selectSwitcherGroups(needs)[0]?.needsAttention).toBe(true);
	});

	test("groups by project in nav order, omitting projects without live sessions", () => {
		const state = {
			projects: [project("p2", "Project Two"), project("p1", "Project One")],
			workspaces: {
				p1: [workspace("w1", "p1", "Workspace 1")],
				p2: [workspace("w2", "p2", "Workspace 2")],
			},
			sessionStateByWorkspace: {
				w1: { s1: stateRecord("s1", "w1", "p1", { execution: "running" }) },
				w2: { s2: stateRecord("s2", "w2", "p2") },
			},
			layoutDocumentsByWorkspace: {},
			closedChatsByWorkspace: {},
		};
		const groups = selectSwitcherGroups(state);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.projectId).toBe("p1");
	});
});
