import { describe, expect, test } from "bun:test";
import type { Project, SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { buildWorkItems, type WorkItemsState, waitingItems } from "./workItems";

const project: Project = {
	id: "p1",
	name: "Project One",
	path: "/path/p1",
	slug: "p1",
	lastOpened: 0,
};

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "Auth refresh",
	branch: "auth-refresh",
	baseBranch: "main",
	worktreePath: "/path/p1-auth",
};

const record = (
	sessionId: string,
	overrides: Partial<SessionStateRecord["state"]> = {},
): SessionStateRecord => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	state: {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
		...overrides,
	},
});

function state(records: SessionStateRecord[], extra: Partial<WorkItemsState> = {}): WorkItemsState {
	return {
		projects: [project],
		workspaces: { p1: [workspace] },
		sessionStateByWorkspace: {
			w1: Object.fromEntries(records.map((entry) => [entry.sessionId, entry])),
		},
		layoutDocumentsByWorkspace: {},
		closedChatsByWorkspace: {},
		activeWorkspaceId: null,
		activeWorkspaceLiveLatch: false,
		workspaceSettlingSupported: false,
		settleIdleDays: null,
		...extra,
	};
}

function items(records: SessionStateRecord[], chatTitles: Record<string, string> = {}) {
	return buildWorkItems({
		t: currentTranslator(),
		state: state(records),
		contextProjectId: null,
		chatTitles,
		nowMs: 0,
		navigateToProject: () => {},
		navigateToWorkspace: () => {},
	});
}

const failedRead = record("s-failed", {
	completion: { completionId: "c1", outcome: "failed", failure: "error" },
});
const waiting = record("s-waiting", { needsInput: { inputKind: "ask_user_question" } });

describe("buildWorkItems", () => {
	test("a read failure still matches is:error, and a workspace carries every chat's states", () => {
		const result = items([failedRead, waiting], { "s-failed": "Broken build" });
		const failedChat = result.find((item) => item.id === "chat:s-failed");
		expect(failedChat?.attention).toBeUndefined();
		expect(failedChat?.states).toEqual(["error"]);
		const row = result.find((item) => item.id === "workspace:w1");
		expect(row?.attention).toBe("needs-input");
		expect([...(row?.states ?? [])].sort()).toEqual(["error", "waiting"]);
	});

	test("an idle chat is listed only once its title is known", () => {
		expect(items([record("s-idle")]).some((item) => item.kind === "chat")).toBe(false);
		const titled = items([record("s-idle")], { "s-idle": "Spec review" });
		expect(titled.find((item) => item.id === "chat:s-idle")?.title).toBe("Spec review");
	});

	test("the waiting section maps switcher sessions onto their chat rows", () => {
		const result = items([waiting]);
		const rows = waitingItems(
			[
				{
					sessionId: "s-waiting",
					workspaceId: "w1",
					projectId: "p1",
					workspaceName: "Auth refresh",
					chatTitle: "",
					attention: "needs-input",
				},
			],
			result,
		);
		expect(rows.map((item) => item.id)).toEqual(["chat:s-waiting"]);
	});
});
