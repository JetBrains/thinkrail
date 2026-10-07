import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import {
	selectWorkspacePartition,
	selectWorkspaceSettledReason,
	settledReasonTitle,
} from "./selectors";

const DAY = 24 * 60 * 60_000;
const NOW = 1_800_000_000_000;

function ws(id: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		id,
		projectId: "p1",
		name: id,
		branch: id,
		worktreePath: `/tmp/${id}`,
		baseBranch: "main",
		lastActiveAt: NOW - 1 * DAY,
		...overrides,
	};
}

function session(
	workspaceId: string,
	state: Partial<SessionStateRecord["state"]>,
): Record<string, Record<string, SessionStateRecord>> {
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
					...state,
				},
			},
		},
	};
}

beforeEach(() => {
	useAppStore.setState({ protocolVersion: 78, workspaceSettlingSupported: true });
});

const base = {
	workspaceSettlingSupported: true,
	sessionStateByWorkspace: {},
	activeWorkspaceId: null,
	activeWorkspaceLiveLatch: false,
	settleIdleDays: 3 as number | null,
};

describe("selectWorkspaceSettledReason", () => {
	test("fresh rows are live, idle rows settle after the window, never with the window off", () => {
		expect(selectWorkspaceSettledReason(base, ws("fresh"), NOW)).toBeNull();
		const idle = ws("idle", { lastActiveAt: NOW - 4 * DAY });
		expect(selectWorkspaceSettledReason(base, idle, NOW)).toEqual({
			kind: "idle",
			since: NOW - 4 * DAY,
		});
		expect(selectWorkspaceSettledReason({ ...base, settleIdleDays: null }, idle, NOW)).toBeNull();
		expect(selectWorkspaceSettledReason({ ...base, settleIdleDays: 7 }, idle, NOW)).toBeNull();
	});

	test("an unstamped legacy row stays live until the host backfills it", () => {
		expect(
			selectWorkspaceSettledReason(base, ws("legacy", { lastActiveAt: undefined }), NOW),
		).toBeNull();
	});

	test("working, needs-attention, and Default rows never settle, whatever else says", () => {
		const parked = { lastActiveAt: NOW - 30 * DAY, settledOverride: "settled" as const };
		expect(
			selectWorkspaceSettledReason(
				{ ...base, sessionStateByWorkspace: session("busy", { execution: "running" }) },
				ws("busy", parked),
				NOW,
			),
		).toBeNull();
		expect(
			selectWorkspaceSettledReason(
				{ ...base, sessionStateByWorkspace: session("unread", { completionUnread: true }) },
				ws("unread", parked),
				NOW,
			),
		).toBeNull();
		expect(
			selectWorkspaceSettledReason(base, ws("home", { ...parked, kind: "default" }), NOW),
		).toBeNull();
	});

	test("the user's override beats every automatic rule in both directions", () => {
		expect(
			selectWorkspaceSettledReason(base, ws("parked", { settledOverride: "settled" }), NOW),
		).toEqual({ kind: "override" });
		expect(
			selectWorkspaceSettledReason(
				base,
				ws("parked-at", { settledOverride: "settled", settledAt: NOW - 2 * DAY }),
				NOW,
			),
		).toEqual({ kind: "override", since: NOW - 2 * DAY });
		expect(settledReasonTitle({ kind: "override", since: NOW - 2 * DAY }, NOW)).toBe(
			"Settled by you 2d ago",
		);
		expect(
			selectWorkspaceSettledReason(
				base,
				ws("pinned", {
					settledOverride: "active",
					lastActiveAt: NOW - 90 * DAY,
					review: { kind: "pull-request", number: 1, state: "merged", changedAt: NOW - 80 * DAY },
				}),
				NOW,
			),
		).toBeNull();
	});

	test("a merged or closed review settles unless work happened after it; an open one keeps live", () => {
		const merged = ws("merged", {
			review: { kind: "pull-request", number: 7, state: "merged", changedAt: NOW - 2 * DAY },
			lastActiveAt: NOW - 3 * DAY,
		});
		expect(selectWorkspaceSettledReason(base, merged, NOW)).toEqual({
			kind: "review",
			state: "merged",
		});
		expect(
			selectWorkspaceSettledReason(base, { ...merged, lastActiveAt: NOW - 1 * DAY }, NOW),
		).toBeNull();
		expect(
			selectWorkspaceSettledReason(
				base,
				ws("incomplete-merged", {
					review: { kind: "pull-request", number: 6, state: "merged" },
					lastActiveAt: NOW - 1 * DAY,
				}),
				NOW,
			),
		).toBeNull();
		expect(
			selectWorkspaceSettledReason(
				base,
				ws("stale-open", {
					review: { kind: "pull-request", number: 8, state: "open" },
					lastActiveAt: NOW - 40 * DAY,
				}),
				NOW,
			),
		).toBeNull();
		expect(
			selectWorkspaceSettledReason(
				base,
				ws("legacy-host", {
					review: { kind: "pull-request", number: 9 },
					lastActiveAt: NOW - 40 * DAY,
				}),
				NOW,
			),
		).toBeNull();
	});

	test("the latched active workspace stays live; an unlatched one follows the rules", () => {
		const idle = ws("idle", { lastActiveAt: NOW - 10 * DAY });
		const latched = { ...base, activeWorkspaceId: "idle", activeWorkspaceLiveLatch: true };
		expect(selectWorkspaceSettledReason(latched, idle, NOW)).toBeNull();
		expect(
			selectWorkspaceSettledReason({ ...latched, activeWorkspaceLiveLatch: false }, idle, NOW),
		).toEqual({ kind: "idle", since: NOW - 10 * DAY });
		expect(
			selectWorkspaceSettledReason(latched, { ...idle, settledOverride: "settled" }, NOW),
		).toEqual({ kind: "override" });
	});
});

describe("selectWorkspacePartition", () => {
	const rows = [
		ws("home", { kind: "default", name: "Default", lastActiveAt: NOW }),
		ws("b-old", { name: "Bravo", lastActiveAt: NOW - 2 * DAY }),
		ws("a-new", { name: "Alpha", lastActiveAt: NOW - 1 * DAY }),
		ws("merged", {
			name: "Merged",
			review: { kind: "pull-request", number: 1, state: "merged", changedAt: NOW - 5 * DAY },
			lastActiveAt: NOW - 6 * DAY,
		}),
		ws("idle", { name: "Idle", lastActiveAt: NOW - 20 * DAY }),
	];
	const state = { ...base, workspaces: { p1: rows } };

	test("recent order: Default first, then newest activity; settled rows sort the same way", () => {
		const partition = selectWorkspacePartition({ ...state, workspaceSort: "recent" }, "p1", NOW);
		expect(partition.live.map((w) => w.id)).toEqual(["home", "a-new", "b-old"]);
		expect(partition.settled.map((row) => row.workspace.id)).toEqual(["merged", "idle"]);
		expect(partition.settled.map((row) => row.reason.kind)).toEqual(["review", "idle"]);
	});

	test("created order is newest first; name order is alphabetical", () => {
		expect(
			selectWorkspacePartition({ ...state, workspaceSort: "created" }, "p1", NOW).live.map(
				(w) => w.id,
			),
		).toEqual(["home", "a-new", "b-old"]);
		expect(
			selectWorkspacePartition({ ...state, workspaceSort: "name" }, "p1", NOW).live.map(
				(w) => w.id,
			),
		).toEqual(["home", "a-new", "b-old"]);
		expect(
			selectWorkspacePartition(
				{ ...state, workspaceSort: "name", workspaces: { p1: [...rows].reverse() } },
				"p1",
				NOW,
			).live.map((w) => w.name),
		).toEqual(["Default", "Alpha", "Bravo"]);
	});

	test("an unknown project partitions to nothing", () => {
		expect(selectWorkspacePartition({ ...state, workspaceSort: "recent" }, "nope", NOW)).toEqual({
			live: [],
			settled: [],
		});
	});

	test("a pre-v78 host keeps the raw legacy order and ignores stale settled facts", () => {
		const legacyRows = [
			ws("home", { kind: "default", name: "Default" }),
			ws("first", { lastActiveAt: undefined, settledOverride: "settled" }),
			ws("second", { lastActiveAt: undefined }),
		];
		expect(
			selectWorkspacePartition(
				{
					...base,
					workspaceSettlingSupported: false,
					workspaces: { p1: legacyRows },
					workspaceSort: "recent",
				},
				"p1",
				NOW,
			),
		).toEqual({ live: legacyRows, settled: [] });
		const staleSettled = legacyRows[1];
		if (!staleSettled) throw new Error("expected the stale settled fixture");
		expect(
			selectWorkspaceSettledReason(
				{ ...base, workspaceSettlingSupported: false },
				staleSettled,
				NOW,
			),
		).toBeNull();
	});
});

test("settled capability survives reconnect limbo until the next welcome decides", () => {
	const store = useAppStore.getState();
	store.setStatus("disconnected");
	expect(useAppStore.getState().protocolVersion).toBeNull();
	expect(useAppStore.getState().workspaceSettlingSupported).toBe(true);
	store.installWelcomeSnapshot(77, [], []);
	expect(useAppStore.getState().workspaceSettlingSupported).toBe(false);
});

describe("the active-workspace live latch", () => {
	test("selecting a live workspace latches it; selecting a settled one does not", () => {
		const store = useAppStore.getState();
		store.setWorkspaces("p1", [ws("fresh"), ws("idle", { lastActiveAt: NOW - 400 * DAY })]);
		store.activateWorkspace({ id: "fresh", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(true);
		store.activateWorkspace({ id: "idle", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(false);
	});

	test("re-activating the current workspace keeps its latch instead of re-judging it", () => {
		const store = useAppStore.getState();
		const aging = ws("aging", { lastActiveAt: Date.now() - 1000 });
		store.setWorkspaces("p1", [aging]);
		store.activateWorkspace({ id: "aging", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(true);
		store.updateWorkspace(ws("aging", { lastActiveAt: NOW - 400 * DAY }));
		store.activateWorkspace({ id: "aging", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(true);
		store.activateWorkspace({ id: "fresh", projectId: "p1" });
		store.setWorkspaces("p1", [ws("fresh"), ws("aging", { lastActiveAt: NOW - 400 * DAY })]);
		store.activateWorkspace({ id: "aging", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(false);
	});

	test("a history jump into a settled chat judges the destination like any other selection", () => {
		const store = useAppStore.getState();
		store.setWorkspaces("p1", [
			ws("fresh", { lastActiveAt: NOW - 1000 }),
			ws("dormant", { lastActiveAt: NOW - 400 * DAY }),
		]);
		store.activateWorkspace({ id: "fresh", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(true);
		store.requestChatLocation({
			workspaceId: "dormant",
			projectId: "p1",
			sessionId: "s1",
			messageIndex: 0,
			anchorText: "old plan",
		});
		const state = useAppStore.getState();
		expect(state.activeWorkspaceId).toBe("dormant");
		expect(state.activeWorkspaceLiveLatch).toBe(false);
		expect(
			selectWorkspacePartition(state, "p1", NOW).settled.map((row) => row.workspace.id),
		).toEqual(["dormant"]);
	});

	test("real work pushed for the active row re-arms the latch; other rows' pushes do not", () => {
		const store = useAppStore.getState();
		store.setWorkspaces("p1", [ws("fresh"), ws("idle", { lastActiveAt: NOW - 400 * DAY })]);
		store.activateWorkspace({ id: "idle", projectId: "p1" });
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(false);
		store.updateWorkspace(ws("fresh", { lastActiveAt: Date.now() }));
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(false);
		store.updateWorkspace(ws("idle", { lastActiveAt: Date.now() }));
		expect(useAppStore.getState().activeWorkspaceLiveLatch).toBe(true);
	});

	test("the shelf view state toggles and pages per project", () => {
		const store = useAppStore.getState();
		store.toggleSettledShelf("p1");
		expect(useAppStore.getState().settledShelfExpanded.p1).toBe(true);
		store.toggleSettledShelf("p1", true);
		expect(useAppStore.getState().settledShelfExpanded.p1).toBe(true);
		store.toggleSettledShelf("p1");
		expect(useAppStore.getState().settledShelfExpanded.p1).toBeUndefined();
		store.showMoreSettled("p1", 35);
		expect(useAppStore.getState().settledShelfShown.p1).toBe(35);
		store.showMoreSettled("p1", 5);
		expect(useAppStore.getState().settledShelfShown.p1).toBe(35);
		store.setWorkspaceSort("name");
		expect(useAppStore.getState().workspaceSort).toBe("name");
	});
});
