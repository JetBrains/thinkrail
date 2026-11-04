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
		...extra,
	};
}

function items(
	records: SessionStateRecord[],
	knownTitles: Record<string, string> = {},
	firstPrompts: Record<string, string> = {},
) {
	const closed = Object.entries(knownTitles).map(([sessionId, title]) => ({
		sessionId,
		title,
		closedAt: 0,
	}));
	return buildWorkItems({
		t: currentTranslator(),
		state: state(records, { closedChatsByWorkspace: { w1: closed } }),
		contextProjectId: null,
		firstPrompts,
		navigateToProject: () => {},
		navigateToWorkspace: () => {},
	});
}

const failedRead = record("s-failed", {
	completion: { completionId: "c1", outcome: "failed", failure: "error" },
});
const waiting = record("s-waiting", {
	needsInput: { interactionId: "i1", kind: "tool-response", toolCallId: "q1" },
});

describe("buildWorkItems", () => {
	test("a read failure is listed by title without attention, and a workspace carries its strongest chat attention", () => {
		const result = items([failedRead, waiting], { "s-failed": "Broken build" });
		const failedChat = result.find((item) => item.id === "chat:s-failed");
		expect(failedChat?.title).toBe("Broken build");
		expect(failedChat?.attention).toBeUndefined();
		expect(result.find((item) => item.id === "workspace:w1")?.attention).toBe("needs-input");
	});

	test("an idle chat is listed only once its title is known", () => {
		expect(items([record("s-idle")]).some((item) => item.kind === "chat")).toBe(false);
		const titled = items([record("s-idle")], { "s-idle": "Spec review" });
		expect(titled.find((item) => item.id === "chat:s-idle")?.title).toBe("Spec review");
	});

	test("an unnamed chat reads as its first prompt, findable by the whole prompt", () => {
		const prompt = "Please refactor the authentication module so that tokens refresh quietly";
		const idle = items([record("s-idle")], {}, { "s-idle": prompt }).find(
			(item) => item.id === "chat:s-idle",
		);
		expect(idle).toMatchObject({
			title: "Please refactor the authentication module so\u2026",
			titleSource: "prompt",
			titleTooltip: prompt,
			keywords: [prompt],
		});
		const named = items([record("s-idle")], { "s-idle": "Spec review" }, { "s-idle": prompt }).find(
			(item) => item.id === "chat:s-idle",
		);
		expect(named).toMatchObject({ title: "Spec review", titleSource: "name" });
		expect(named?.titleTooltip).toBeUndefined();
		expect(items([waiting]).find((item) => item.id === "chat:s-waiting")).toMatchObject({
			title: "Chat",
			titleSource: "default",
		});
	});

	test("Waiting lists chats that need you by urgency, leaving running and quiet chats out", () => {
		const result = items(
			[
				record("s-running", { execution: "running", runId: "r1" }),
				record("s-idle"),
				record("s-unread", {
					completionUnread: true,
					completion: { completionId: "c2", outcome: "succeeded" },
				}),
				record("s-error", {
					completionUnread: true,
					completion: { completionId: "c1", outcome: "failed", failure: "error" },
				}),
				waiting,
			],
			{ "s-running": "Long build", "s-idle": "Quiet" },
		);
		expect(waitingItems(result).map((item) => item.id)).toEqual([
			"chat:s-waiting",
			"chat:s-error",
			"chat:s-unread",
		]);
	});

	test("a chat that needs input in a later project is not hidden behind unread chats of an earlier one, and ties keep project order", () => {
		const second: Project = { ...project, id: "p2", name: "Project Two", slug: "p2" };
		const unread = (sessionId: string) =>
			record(sessionId, {
				completionUnread: true,
				completion: { completionId: `c-${sessionId}`, outcome: "succeeded" },
			});
		const blocked: SessionStateRecord = { ...waiting, workspaceId: "w2", projectId: "p2" };
		const laterUnread: SessionStateRecord = {
			...unread("u-p2"),
			workspaceId: "w2",
			projectId: "p2",
		};
		const result = buildWorkItems({
			t: currentTranslator(),
			state: {
				...state([unread("u1"), unread("u2"), unread("u3")]),
				projects: [project, second],
				workspaces: {
					p1: [workspace],
					p2: [{ ...workspace, id: "w2", projectId: "p2" }],
				},
				sessionStateByWorkspace: {
					w2: { [blocked.sessionId]: blocked, [laterUnread.sessionId]: laterUnread },
					w1: {
						u1: unread("u1"),
						u2: unread("u2"),
						u3: unread("u3"),
					},
				},
			},
			contextProjectId: null,
			firstPrompts: {},
			navigateToProject: () => {},
			navigateToWorkspace: () => {},
		});
		expect(waitingItems(result).map((item) => item.id)).toEqual([
			"chat:s-waiting",
			"chat:u1",
			"chat:u2",
			"chat:u3",
			"chat:u-p2",
		]);
	});
});
