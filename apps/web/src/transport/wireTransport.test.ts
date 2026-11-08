import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	CHANGE_MUTATIONS_PROTOCOL_VERSION,
	HOST_UPDATE_RUN_PROTOCOL_VERSION,
	PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION,
	PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION,
	type Project,
	REVIEW_RICH_ANCHORS_PROTOCOL_VERSION,
	type SessionStateRecord,
	TOOL_RESPONSE_PROTOCOL_VERSION,
	USER_THEMES_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import type { LoginState } from "../auth";
import { useAppStore } from "../store";
import * as wireTransport from "./wireTransport";
import {
	applyWorkspaceListRefresh,
	mergeSessionStateRecords,
	supportsChangeMutations,
	supportsHostUpdateRun,
	supportsPlanReview,
	supportsPlanSummaryGeneration,
	supportsRichAnchors,
	supportsToolResponses,
	supportsUserThemes,
} from "./wireTransport";

test("tool responses go to session.respondToTool only from a v93 host; older hosts take the ask answer", () => {
	expect(supportsToolResponses(TOOL_RESPONSE_PROTOCOL_VERSION)).toBe(true);
	expect(supportsToolResponses(TOOL_RESPONSE_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsToolResponses(null)).toBe(false);
});

test("user theme files are read only from a host at or beyond their capability version", () => {
	expect(supportsUserThemes(USER_THEMES_PROTOCOL_VERSION)).toBe(true);
	expect(supportsUserThemes(USER_THEMES_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsUserThemes(null)).toBe(false);
});

test("host update execution is offered only by a host at or beyond the v70 capability", () => {
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsHostUpdateRun(HOST_UPDATE_RUN_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsHostUpdateRun(null)).toBe(false);
});

test("change mutations are offered only by a host at or beyond their capability version", () => {
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION)).toBe(true);
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsChangeMutations(CHANGE_MUTATIONS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsChangeMutations(null)).toBe(false);
});

test("rich review anchors are authored only against a host that preserves them", () => {
	expect(supportsRichAnchors(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION)).toBe(true);
	expect(supportsRichAnchors(REVIEW_RICH_ANCHORS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsRichAnchors(null)).toBe(false);
});

test("plan review is offered only by a host at or beyond the v67 capability", () => {
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION + 1)).toBe(true);
	expect(supportsPlanReview(PLAN_REVIEW_SUBAGENT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanReview(null)).toBe(false);
});

test("auto plan-summary is requested only from a host at or beyond the v69 capability", () => {
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION)).toBe(true);
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION + 1)).toBe(true);
	// A pre-v69 host serves no todo.generateSummary, so a new client must not issue the request.
	expect(supportsPlanSummaryGeneration(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsPlanSummaryGeneration(null)).toBe(false);
});

function record(sessionId: string, completionId: string): SessionStateRecord {
	return {
		sessionId,
		workspaceId: "workspace",
		projectId: "project",
		state: {
			execution: "idle",
			runId: `run:${sessionId}`,
			needsInput: null,
			completion: { completionId, outcome: "succeeded" },
			completionUnread: true,
			queuedCount: 0,
			backgroundWork: false,
		},
	};
}

test("buffered state replaces its stale snapshot row before activation binding", () => {
	const other = record("other", "completion:other");
	expect(
		mergeSessionStateRecords(
			[record("target", "completion:old"), other],
			[record("target", "completion:newer"), record("target", "completion:latest")],
		),
	).toEqual([record("target", "completion:latest"), other]);
});

describe("the reconnect workspace list refresh", () => {
	const project = (id: string): Project => ({
		id,
		name: id,
		path: `/repos/${id}`,
		slug: id,
		lastOpened: 0,
	});
	const workspace = (id: string, name = id): Workspace => ({
		id,
		projectId: "p1",
		name,
		branch: id,
		baseBranch: "main",
		worktreePath: `/worktrees/${id}`,
	});
	const initial = useAppStore.getInitialState();
	beforeEach(() => useAppStore.setState(initial, true));
	afterEach(() => useAppStore.setState(initial, true));

	test("retires rows the host no longer lists and refreshes the ones it still does", () => {
		useAppStore.setState({
			projects: [project("p1")],
			workspaces: { p1: [workspace("w1"), workspace("w2"), workspace("w3")] },
		});
		applyWorkspaceListRefresh(
			"p1",
			["w1", "w2", "w3"],
			[workspace("w1", "renamed"), workspace("w3")],
		);
		const state = useAppStore.getState();
		expect(state.workspaces.p1?.map((row) => [row.id, row.name])).toEqual([
			["w1", "renamed"],
			["w3", "w3"],
		]);
		expect(state.removedWorkspaceIds.w2).toBe(true);
	});

	test("keeps rows that arrived after the read was sent and adds none of its own", () => {
		useAppStore.setState({
			projects: [project("p1")],
			workspaces: { p1: [workspace("w1"), workspace("w-pushed")] },
		});
		applyWorkspaceListRefresh("p1", ["w1"], [workspace("w1"), workspace("w-unknown")]);
		const state = useAppStore.getState();
		expect(state.workspaces.p1?.map((row) => row.id)).toEqual(["w1", "w-pushed"]);
		expect(state.removedWorkspaceIds["w-pushed"]).toBeUndefined();
	});

	test("ignores a reply for a project that closed meanwhile", () => {
		useAppStore.setState({ projects: [], workspaces: { p1: [workspace("w1")] } });
		applyWorkspaceListRefresh("p1", ["w1"], []);
		const state = useAppStore.getState();
		expect(state.workspaces.p1?.map((row) => row.id)).toEqual(["w1"]);
		expect(state.removedWorkspaceIds.w1).toBeUndefined();
	});

	test("cancels the MCP login of a retired workspace like a live removal does", () => {
		const requests: [string, unknown][] = [];
		const transport = {
			request: (method: string, params: unknown) => {
				requests.push([method, params]);
				return Promise.resolve({ ok: true });
			},
		} as unknown as ReturnType<typeof wireTransport.getTransport>;
		const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
		try {
			const login: LoginState = {
				loginId: "login_1",
				providerId: "mcp",
				target: { kind: "mcp", workspaceId: "w2", serverName: "docs" },
				status: "active",
			};
			useAppStore.setState({
				projects: [project("p1")],
				workspaces: { p1: [workspace("w1"), workspace("w2")] },
				activeLogin: login,
			});
			applyWorkspaceListRefresh("p1", ["w1", "w2"], [workspace("w1")]);
			expect(useAppStore.getState().activeLogin).toBeNull();
			expect(requests).toEqual([["provider.loginCancel", { loginId: "login_1" }]]);
		} finally {
			spy.mockRestore();
		}
	});
});
