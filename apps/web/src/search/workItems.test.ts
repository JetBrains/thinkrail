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
	extra: Partial<WorkItemsState> & { transcriptPreviews?: boolean } = {},
) {
	const closed = Object.entries(knownTitles).map(([sessionId, title]) => ({
		sessionId,
		title,
		closedAt: 0,
	}));
	const { transcriptPreviews = false, ...stateExtra } = extra;
	return buildWorkItems({
		t: currentTranslator(),
		state: state(records, { closedChatsByWorkspace: { w1: closed }, ...stateExtra }),
		contextProjectId: null,
		firstPrompts,
		transcriptPreviews,
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

	test("a chat without a project whose deletion is pending is never offered as a destination", () => {
		const chatRecord = (pending: boolean) =>
			items(
				[waiting],
				{},
				{ "s-waiting": "Draft the release notes" },
				{
					workspaces: {
						p1: [{ ...workspace, kind: "chat", ...(pending ? { deletionPending: true } : {}) }],
					},
				},
			).filter((item) => item.kind === "chat");
		expect(chatRecord(false)).toHaveLength(1);
		expect(chatRecord(true)).toEqual([]);
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

	test("a chat previews its transcript only against a host that searches, and the project folder is found by its branch", () => {
		const titles = { "s-idle": "Spec review" };
		const plain = items([record("s-idle")], titles);
		expect(plain.find((item) => item.id === "chat:s-idle")?.previewTarget).toBeUndefined();
		const searching = items([record("s-idle")], titles, {}, { transcriptPreviews: true });
		expect(searching.find((item) => item.id === "chat:s-idle")?.previewTarget).toEqual({
			kind: "chat",
			sessionId: "s-idle",
		});
		const folder: Workspace = { ...workspace, id: "w-def", kind: "default", branch: "release-zqx" };
		const withFolder = items([], {}, {}, { workspaces: { p1: [workspace, folder] } });
		expect(withFolder.find((item) => item.id === "workspace:w-def")?.keywords).toEqual([
			"release-zqx",
		]);
		expect(withFolder.find((item) => item.id === "workspace:w1")?.keywords).toEqual([]);
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
			transcriptPreviews: false,
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

	test("within an urgency the newest activity leads, a chat without a project competing equally, and equal stamps follow the rail", () => {
		const second: Project = { ...project, id: "p2", name: "Project Two", slug: "p2" };
		const chats: Project = { ...project, id: "chats", name: "Chats", slug: "chats", kind: "chats" };
		const row = (
			id: string,
			projectId: string,
			lastActiveAt: number,
			extra: Partial<Workspace> = {},
		) => ({ ...workspace, id, projectId, lastActiveAt, ...extra }) satisfies Workspace;
		const unreadIn = (sessionId: string, workspaceId: string, projectId: string) => ({
			[sessionId]: {
				...record(sessionId, {
					completionUnread: true,
					completion: { completionId: `c-${sessionId}`, outcome: "succeeded" },
				}),
				workspaceId,
				projectId,
			},
		});
		const result = buildWorkItems({
			t: currentTranslator(),
			state: {
				...state([]),
				projects: [project, chats, second],
				workspaces: {
					p1: [row("w-def", "p1", 100, { kind: "default" }), row("w1", "p1", 300)],
					chats: [
						row("c-old", "chats", 300, { kind: "chat" }),
						row("c-new", "chats", 500, { kind: "chat" }),
					],
					p2: [row("w2", "p2", 300)],
				},
				sessionStateByWorkspace: {
					"w-def": {
						...unreadIn("u-def", "w-def", "p1"),
						"s-waiting": { ...waiting, workspaceId: "w-def" },
					},
					w2: unreadIn("u-w2", "w2", "p2"),
					w1: unreadIn("u-w1", "w1", "p1"),
					"c-old": unreadIn("u-c-old", "c-old", "chats"),
					"c-new": unreadIn("u-c-new", "c-new", "chats"),
				},
			},
			contextProjectId: null,
			firstPrompts: {},
			transcriptPreviews: false,
			navigateToProject: () => {},
			navigateToWorkspace: () => {},
		});
		expect(waitingItems(result).map((item) => item.id)).toEqual([
			"chat:s-waiting",
			"chat:u-c-new",
			"chat:u-c-old",
			"chat:u-w1",
			"chat:u-w2",
			"chat:u-def",
		]);
		expect(result.filter((item) => item.kind === "workspace").map((item) => item.id)).toEqual([
			"workspace:w1",
			"workspace:w2",
			"workspace:w-def",
		]);
	});

	test("without activity stamps the order is the rail's: Default first, then the newest created", () => {
		const older: Workspace = { ...workspace, id: "w-old" };
		const newer: Workspace = { ...workspace, id: "w-new" };
		const folder: Workspace = { ...workspace, id: "w-def", kind: "default" };
		const result = items([], {}, {}, { workspaces: { p1: [folder, older, newer] } });
		expect(result.filter((item) => item.kind === "workspace").map((item) => item.id)).toEqual([
			"workspace:w-def",
			"workspace:w-new",
			"workspace:w-old",
		]);
	});
});
