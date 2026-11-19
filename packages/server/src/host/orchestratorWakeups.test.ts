import { expect, test } from "bun:test";
import type {
	Container,
	ContainerWakeDetails,
	ContainerWakeReason,
	PiEvent,
	SessionState,
	SessionStateRecord,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import {
	createOrchestratorWakeups,
	type WakeCard,
	type WakeupDeps,
	wakeText,
} from "./orchestratorWakeups";

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

const settled: PiEvent = { type: "agent_settled", terminal: null };

const record = (sessionId: string, workspaceId: string, patch: Partial<SessionState>) =>
	({ sessionId, workspaceId, projectId: "p1", state: state(patch) }) as SessionStateRecord;

const member = (id: string, review?: Workspace["review"]) =>
	({
		id,
		projectId: "p1",
		name: `ws-${id}`,
		branch: id,
		worktreePath: `/wt/${id}`,
		baseBranch: "main",
		...(review ? { review } : {}),
	}) as Workspace;

interface Delivered {
	sessionId: string;
	workspaceId: string;
	sessionIds: readonly string[];
	reasons: readonly ContainerWakeReason[];
	details: ContainerWakeDetails;
}

function harness({ orchestrated = true } = {}) {
	const box: Container = {
		id: "c1",
		name: "Docs",
		workspaceIds: ["w1", "w2"],
		...(orchestrated ? { orchestratorSessionId: "orch-1" } : {}),
		createdAt: 1,
		updatedAt: 1,
	};
	const delivered: Delivered[] = [];
	const pending = new Set<ContainerWakeDetails>();
	const deps: WakeupDeps = {
		containerOf: (workspaceId) => (box.workspaceIds.includes(workspaceId) ? box : undefined),
		describe: async (target, workspaceId, sessionIds, reasons): Promise<WakeCard> => ({
			text: `update ${workspaceId}`,
			details: {
				containerId: target.id,
				workspaceId,
				workspaceName: workspaceId,
				reasons: [...reasons],
			},
			...{ sessionIds },
		}),
		deliver: async (_container, sessionId, card) => {
			const { sessionIds } = card as WakeCard & { sessionIds: readonly string[] };
			delivered.push({
				sessionId,
				workspaceId: card.details.workspaceId,
				sessionIds,
				reasons: card.details.reasons,
				details: card.details,
			});
		},
		isPending: (_sessionId, details) => pending.has(details),
		windowMs: 15,
	};
	const wakeups = createOrchestratorWakeups(deps);
	const settle = async () => {
		for (let attempt = 0; attempt < 100 && wakeups.busy(); attempt++) await Bun.sleep(5);
	};
	return { box, delivered, pending, wakeups, settle };
}

test("a member chat's settle wakes the orchestrator once per burst, with every chat that changed", async () => {
	const { wakeups, delivered, settle } = harness();
	wakeups.onSessionState(record("s2", "w1", {}));
	wakeups.onSessionEvent("s1", "w1", settled);
	wakeups.onSessionEvent("s1", "w1", settled);
	wakeups.onSessionState(record("s2", "w1", { needsInput: { kind: "dialog" } as never }));
	wakeups.onSessionEvent("s3", "w2", settled);
	expect(delivered).toEqual([]);
	await settle();
	expect(
		delivered.map(({ sessionId, workspaceId, sessionIds, reasons }) => ({
			sessionId,
			workspaceId,
			sessionIds,
			reasons,
		})),
	).toEqual([
		{ sessionId: "orch-1", workspaceId: "w1", sessionIds: ["s1", "s2"], reasons: ["chat"] },
		{ sessionId: "orch-1", workspaceId: "w2", sessionIds: ["s3"], reasons: ["chat"] },
	]);
	wakeups.dispose();
});

test("needing the human or failing wakes on the change, never on a chat's first record or a repeat", async () => {
	const { wakeups, delivered, settle } = harness();
	wakeups.onSessionState(record("s1", "w1", { needsInput: { kind: "dialog" } as never }));
	wakeups.onSessionState(record("s2", "w1", { execution: "running" }));
	await settle();
	expect(delivered).toEqual([]);
	wakeups.onSessionState(record("s2", "w1", { completion: { outcome: "failed" } as never }));
	await settle();
	wakeups.onSessionState(record("s2", "w1", { completion: { outcome: "failed" } as never }));
	wakeups.onSessionState(record("s2", "w1", { completion: { outcome: "succeeded" } as never }));
	await settle();
	expect(delivered.map((wake) => wake.sessionIds)).toEqual([["s2"]]);
	wakeups.dispose();
});

test("a member's PR state change wakes; an unchanged review, a new workspace or a non-member does not", async () => {
	const { wakeups, delivered, settle } = harness();
	const open = { kind: "pull-request" as const, number: 7, state: "open" as const };
	wakeups.seed([member("w1", open), member("w9")]);
	wakeups.onWorkspaceEvent({
		kind: "updated",
		workspace: { ...member("w1", open), name: "renamed" },
	});
	wakeups.onWorkspaceEvent({ kind: "created", workspace: member("w2", open) });
	wakeups.onWorkspaceEvent({ kind: "updated", workspace: member("w9", open) });
	await settle();
	expect(delivered).toEqual([]);
	wakeups.onWorkspaceEvent({
		kind: "updated",
		workspace: member("w1", { ...open, state: "merged" }),
	});
	wakeups.onWorkspaceEvent({ kind: "updated", workspace: member("w2", { ...open, number: 8 }) });
	await settle();
	expect(delivered.map((wake) => [wake.workspaceId, wake.reasons, wake.sessionIds])).toEqual([
		["w1", ["review"], []],
		["w2", ["review"], []],
	]);
	wakeups.dispose();
});

test("the orchestrator's own session never wakes it, and a container without an orchestrator wakes nobody", async () => {
	const own = harness();
	own.wakeups.onSessionEvent("orch-1", "w1", settled);
	own.wakeups.onSessionEvent("s5", "chat-orch", settled);
	await own.settle();
	expect(own.delivered).toEqual([]);
	own.wakeups.dispose();

	const headless = harness({ orchestrated: false });
	headless.wakeups.onSessionEvent("s1", "w1", settled);
	expect(headless.wakeups.busy()).toBe(false);
	headless.wakeups.dispose();
});

test("while a member's last card still waits in the orchestrator's queue, the next one waits for it", async () => {
	const { wakeups, delivered, pending, settle } = harness();
	wakeups.onSessionEvent("s1", "w1", settled);
	await settle();
	const first = delivered[0]?.details;
	if (!first) throw new Error("no first wake");
	pending.add(first);
	wakeups.onSessionEvent("s1", "w1", settled);
	wakeups.onSessionEvent("s2", "w2", settled);
	await Bun.sleep(80);
	expect(delivered.map((wake) => wake.workspaceId)).toEqual(["w1", "w2"]);
	expect(wakeups.busy()).toBe(true);
	pending.delete(first);
	await settle();
	expect(delivered.map((wake) => wake.workspaceId)).toEqual(["w1", "w2", "w1"]);
	wakeups.dispose();
});

test("the card names the member, each changed chat's state, plan and final message, and its PR", () => {
	const chat = (sessionId: string, title: string, patch: Partial<SessionState>) =>
		({ sessionId, title, state: state(patch) }) as SessionSummary;
	const text = wakeText({
		workspace: member("board", {
			kind: "pull-request",
			number: 7,
			state: "merged",
			url: "https://pr/7",
		}),
		projectName: "ThinkRail",
		reasons: ["chat", "review"],
		changed: [
			{
				summary: chat("s1", "Board", { completion: { outcome: "succeeded" } as never }),
				finalMessage: "Done.\nOpened PR #7.",
				openTodos: 2,
			},
		],
		others: [chat("s2", "", { execution: "running" })],
	});
	expect(text.split("\n")).toEqual([
		'Member update · ThinkRail · ws-board (branch board, workspace id board): chat "Board" finished; its review is now PR #7 merged https://pr/7.',
		"",
		"- PR: PR #7 merged https://pr/7",
		'- Chat "Board" (s1): finished · 2 open todo(s)',
		"- Chat unnamed (s2): working",
		"",
		'Final message of chat "Board":',
		"",
		"> Done.",
		"> Opened PR #7.",
		"",
		"This is an automatic update from ThinkRail, not a message from the human. Act on it only if it changes what the container needs (message a member's chat, open a PR, tell the human); otherwise acknowledge it in one short line.",
	]);
});
