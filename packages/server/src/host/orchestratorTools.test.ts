import { expect, test } from "bun:test";
import type {
	Container,
	MergePrResult,
	OrchestratorMessageDetails,
	Project,
	SessionState,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import type { HostMessageDelivery, MergeVerdict, StartWorkspaceParams } from "../agent";
import {
	addWorkspace,
	mergeMemberPr,
	messageChat,
	type OrchestratorToolsDeps,
	openMemberPr,
	removeWorkspace,
	stopChat,
} from "./orchestratorTools";

const projects: Project[] = [
	{ id: "p1", name: "ThinkRail", path: "/repos/thinkrail", slug: "thinkrail", lastOpened: 1 },
	{ id: "p2", name: "Website", path: "/repos/website", slug: "website", lastOpened: 1 },
];

const ws = (id: string, projectId: string, branch: string, patch: Partial<Workspace> = {}) =>
	({
		id,
		projectId,
		name: `ws-${branch}`,
		branch,
		worktreePath: `/worktrees/${id}`,
		baseBranch: "main",
		...patch,
	}) as Workspace;

const state = (patch: Partial<SessionState> = {}): SessionState => ({
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
	...patch,
});

const chat = (sessionId: string, updatedAt: number, title = "") =>
	({ sessionId, title, updatedAt, state: state() }) as SessionSummary;

interface Calls {
	sent: {
		sessionId: string;
		content: string;
		details: OrchestratorMessageDetails;
		deliverAs: HostMessageDelivery;
	}[];
	aborted: string[];
	started: StartWorkspaceParams[];
	joined: [string, string][];
	left: [string, string][];
	archived: string[];
	merged: unknown[];
	opened: string[];
	refreshed: string[];
}

function fixture(overrides: Partial<OrchestratorToolsDeps> = {}) {
	const container: Container = {
		id: "c1",
		name: "Docs everywhere",
		workspaceIds: ["w1", "w2"],
		orchestratorSessionId: "orch-1",
		createdAt: 1,
		updatedAt: 1,
	};
	const other: Container = { ...container, id: "c2", name: "Other", workspaceIds: ["w4"] };
	const workspaces = [
		ws("w1", "p1", "board", {
			review: { kind: "pull-request", number: 7, state: "open", url: "https://pr/7" },
		}),
		ws("w2", "p2", "docs"),
		ws("w3", "p1", "outsider"),
		ws("chat-o", "chats", "", { kind: "chat", orchestratorOf: "c1" }),
		ws("chat-x", "chats", "", { kind: "chat" }),
		ws("w4", "p1", "taken"),
	];
	const chats: Record<string, SessionSummary[]> = {
		w1: [chat("s-old", 1, "Old"), chat("s-new", 5, "Board"), chat("s-mid", 3)],
		w2: [chat("s-docs", 2)],
	};
	const streaming = new Set<string>(["s-mid"]);
	const calls: Calls = {
		sent: [],
		aborted: [],
		started: [],
		joined: [],
		left: [],
		archived: [],
		merged: [],
		opened: [],
		refreshed: [],
	};
	const deps: OrchestratorToolsDeps = {
		callerChat: (sessionId) =>
			sessionId === "orch-1"
				? (workspaces[3] ?? null)
				: sessionId === "plain-chat"
					? (workspaces[4] ?? null)
					: null,
		containers: () => [container, other],
		workspaces: () => workspaces,
		projects: () => projects,
		chats: async (workspace) => chats[workspace.id] ?? [],
		attach: async () => true,
		streaming: (sessionId) => streaming.has(sessionId),
		send: async (sessionId, content, details, deliverAs) => {
			calls.sent.push({ sessionId, content, details, deliverAs });
		},
		abort: async (sessionId) => {
			calls.aborted.push(sessionId);
		},
		start: async (_caller, params, join) => {
			calls.started.push(params);
			const created = ws("w9", params.project ?? "p1", "stacked", {
				baseBranch: params.base_branch ?? "main",
			});
			workspaces.push(created);
			join(created);
			return {
				workspaceId: created.id,
				projectId: created.projectId,
				sessionId: "s-9",
				name: created.name,
				branch: created.branch,
				baseBranch: created.baseBranch,
				model: null,
				effort: "medium",
			};
		},
		join: (containerId, workspaceId) => {
			calls.joined.push([containerId, workspaceId]);
			container.workspaceIds.push(workspaceId);
			return container;
		},
		leave: async (containerId, workspaceId) => {
			calls.left.push([containerId, workspaceId]);
			return container;
		},
		archive: (workspaceId) => {
			calls.archived.push(workspaceId);
		},
		refreshReview: async (workspace) => {
			calls.refreshed.push(workspace.id);
			return workspace;
		},
		openPr: async (workspace) => {
			calls.opened.push(workspace.id);
			return {
				action: "created",
				review: { kind: "pull-request", number: 8 },
				url: "https://pr/8",
				dirtyFiles: 0,
				branch: workspace.branch,
			};
		},
		mergePr: async (params): Promise<MergePrResult> => {
			calls.merged.push(params);
			return { merged: true, branchDeleted: false };
		},
		...overrides,
	};
	return { deps, calls, container, workspaces, streaming };
}

const never = async (): Promise<MergeVerdict> => {
	throw new Error("asked");
};

test("every container tool refuses a workspace outside the caller's container, and any caller that is no orchestrator", async () => {
	const { deps, calls } = fixture();
	const outside = 'is not a member of the container "Docs everywhere"';
	await expect(messageChat("orch-1", { workspace: "w3", text: "hi" }, deps)).rejects.toThrow(
		outside,
	);
	await expect(stopChat("orch-1", { workspace: "outsider" }, deps)).rejects.toThrow(outside);
	await expect(removeWorkspace("orch-1", { workspace: "w3" }, deps)).rejects.toThrow(outside);
	await expect(openMemberPr("orch-1", { workspace: "w3" }, deps)).rejects.toThrow(outside);
	await expect(mergeMemberPr("orch-1", { workspace: "w3" }, never, deps)).rejects.toThrow(outside);
	await expect(addWorkspace("orch-1", { attach: "taken" }, undefined, deps)).rejects.toThrow(
		'"ws-taken" belongs to the container "Other": the orchestrator never takes a member from another container.',
	);
	await expect(addWorkspace("plain-chat", { prompt: "x" }, undefined, deps)).rejects.toThrow(
		"Only a container's orchestrator",
	);
	await expect(messageChat("orch-1", { workspace: "nope", text: "hi" }, deps)).rejects.toThrow(
		'No member workspace matches "nope"',
	);
	for (const caller of ["plain-chat", "someone"]) {
		await expect(messageChat(caller, { workspace: "w1", text: "hi" }, deps)).rejects.toThrow(
			"Only a container's orchestrator can use this tool.",
		);
	}
	await expect(
		messageChat("orch-1", { workspace: "w1", session: "s-docs", text: "hi" }, deps),
	).rejects.toThrow('s-docs is not a chat of the member "ws-board"');
	expect(calls.sent).toEqual([]);
	expect(calls.aborted).toEqual([]);
	expect(calls.archived).toEqual([]);
	expect(calls.opened).toEqual([]);
	expect(calls.merged).toEqual([]);
	expect(calls.joined).toEqual([]);
	expect(calls.started).toEqual([]);
});

test("message_chat sends the member's latest chat an internal card that names the orchestrator, in the asked lane", async () => {
	const { deps, calls } = fixture();
	const followUp = await messageChat(
		"orch-1",
		{ workspace: "board", text: "  Rebase first  " },
		deps,
	);
	expect(followUp).toBe(
		'Sent to chat "Board" (s-new) of "ws-board" as a follow-up; it starts a turn now. You are woken when the chat settles.',
	);
	const steer = await messageChat(
		"orch-1",
		{ workspace: "w1", session: "s-mid", text: "Stop editing the docs", mode: "steer" },
		deps,
	);
	expect(steer).toContain("as a steer; it reaches the running turn at its next step");
	expect(calls.sent.map(({ sessionId, deliverAs }) => [sessionId, deliverAs])).toEqual([
		["s-new", "followUp"],
		["s-mid", "steer"],
	]);
	expect(calls.sent[0]?.details).toEqual({
		containerId: "c1",
		containerName: "Docs everywhere",
		orchestratorSessionId: "orch-1",
		mode: "follow_up",
		text: "Rebase first",
	});
	expect(calls.sent[0]?.content).toBe(
		'Message from the orchestrator of the container "Docs everywhere" (another agent coordinating this workspace with the container\'s other workspaces; not the human):\n\nRebase first',
	);
});

test("stop_chat aborts the member's running chats only", async () => {
	const { deps, calls, streaming } = fixture();
	expect(await stopChat("orch-1", { workspace: "board" }, deps)).toBe(
		'Stopped chat unnamed (s-mid) of "ws-board".',
	);
	expect(await stopChat("orch-1", { workspace: "docs" }, deps)).toBe(
		'Nothing stopped: no chat of "ws-docs" is running.',
	);
	streaming.add("s-new");
	expect(await stopChat("orch-1", { workspace: "w1", session: "s-new" }, deps)).toContain("s-new");
	expect(calls.aborted).toEqual(["s-mid", "s-new"]);
});

test("add_workspace stacks a new member on a sibling's branch and project, and attaches a standalone workspace", async () => {
	const { deps, calls, container } = fixture();
	const stacked = await addWorkspace(
		"orch-1",
		{ prompt: "Archive old specs", base: "board", effort: "high" },
		undefined,
		deps,
	);
	expect(calls.started).toEqual([
		{ prompt: "Archive old specs", project: "p1", base_branch: "board", effort: "high" },
	]);
	expect(calls.joined).toEqual([["c1", "w9"]]);
	expect(stacked).toContain('it is a member of the container "Docs everywhere"');
	expect(stacked).toContain('Stacked on "ws-board": its PR targets board.');
	await expect(
		addWorkspace("orch-1", { prompt: "x", base: "board", project: "website" }, undefined, deps),
	).rejects.toThrow('Cannot stack on "ws-board": it belongs to another project');

	expect(await addWorkspace("orch-1", { attach: "outsider" }, undefined, deps)).toContain(
		'Attached "ws-outsider" (id w3, branch outsider) to the container "Docs everywhere"',
	);
	expect(calls.joined.at(-1)).toEqual(["c1", "w3"]);
	expect(container.workspaceIds).toEqual(["w1", "w2", "w9", "w3"]);
	await expect(
		addWorkspace("orch-1", { attach: "w3", prompt: "go" }, undefined, deps),
	).rejects.toThrow("not both");
	await expect(addWorkspace("orch-1", {}, undefined, deps)).rejects.toThrow(
		"Pass the new member's",
	);
	expect(calls.started).toHaveLength(1);
});

test("add_workspace reports a new workspace that could not join instead of hiding it", async () => {
	const { deps } = fixture({
		join: () => {
			throw new Error("ws-stacked already belongs to the container Other");
		},
	});
	expect(await addWorkspace("orch-1", { prompt: "x", project: "p1" }, undefined, deps)).toContain(
		"but it could not join the container: ws-stacked already belongs to the container Other",
	);
});

test("remove_workspace refuses to archive unmerged work, never dissolves its own container, and otherwise leaves or archives", async () => {
	const { deps, calls, container, workspaces } = fixture();
	await expect(
		removeWorkspace("orch-1", { workspace: "board", archive: true }, deps),
	).rejects.toThrow(
		'Not archived: "ws-board" has PR #7 open https://pr/7, so its work is not merged.',
	);
	await expect(
		removeWorkspace("orch-1", { workspace: "docs", archive: true }, deps),
	).rejects.toThrow('"ws-docs" has no PR');
	expect(calls.refreshed).toEqual(["w1", "w2"]);
	expect(calls.archived).toEqual([]);

	const board = workspaces[0] as Workspace;
	board.review = { kind: "pull-request", number: 7, state: "merged" };
	expect(await removeWorkspace("orch-1", { workspace: "board", archive: true }, deps)).toBe(
		'Archived "ws-board" (its PR is merged); it left the container "Docs everywhere".',
	);
	expect(calls.archived).toEqual(["w1"]);

	expect(await removeWorkspace("orch-1", { workspace: "docs" }, deps)).toContain(
		"is a standalone workspace now",
	);
	expect(calls.left).toEqual([["c1", "w2"]]);

	container.workspaceIds = ["w2"];
	await expect(removeWorkspace("orch-1", { workspace: "docs" }, deps)).rejects.toThrow(
		"the container's last member",
	);
	expect(calls.left).toHaveLength(1);
});

test("merge_pr waits for the human's verdict and merges nothing unless it is an approval", async () => {
	const { deps, calls, workspaces } = fixture();
	const questions: string[] = [];
	const answer =
		(verdict: MergeVerdict) =>
		async (question: string): Promise<MergeVerdict> => {
			questions.push(question);
			return verdict;
		};
	await expect(
		mergeMemberPr("orch-1", { workspace: "board" }, answer("denied"), deps),
	).rejects.toThrow("Not merged: the human declined merging PR #7.");
	await expect(
		mergeMemberPr("orch-1", { workspace: "board" }, answer("unanswered"), deps),
	).rejects.toThrow("Not merged: the human did not answer the confirmation");
	expect(calls.merged).toEqual([]);
	expect(questions[0]).toBe(
		'Merge PR #7 of ThinkRail · ws-board (board → main) with squash?\nThe orchestrator of "Docs everywhere" asks to merge it. Only you can approve this; nothing is merged otherwise.',
	);

	expect(
		await mergeMemberPr(
			"orch-1",
			{ workspace: "board", method: "rebase" },
			answer("approved"),
			deps,
		),
	).toBe('Merged PR #7 of "ws-board" into main (rebase); the branch was kept.');
	expect(calls.merged).toEqual([
		{ workspaceId: "w1", branch: "board", number: 7, method: "rebase", deleteBranch: false },
	]);
	expect(calls.refreshed).toEqual(["w1"]);

	await expect(mergeMemberPr("orch-1", { workspace: "docs" }, never, deps)).rejects.toThrow(
		"there is no open pull request to merge",
	);
	(workspaces[1] as Workspace).review = { kind: "merge-request", number: 3, state: "open" };
	await expect(mergeMemberPr("orch-1", { workspace: "docs" }, never, deps)).rejects.toThrow(
		"merge_pr merges GitHub pull requests",
	);
});

test("open_pr opens the member's PR through the host's open path", async () => {
	const { deps, calls } = fixture();
	expect(await openMemberPr("orch-1", { workspace: "docs", draft: true }, deps)).toBe(
		'Opened PR #8 for "ws-docs": https://pr/8.',
	);
	expect(calls.opened).toEqual(["w2"]);
});
