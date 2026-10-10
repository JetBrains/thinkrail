import { beforeEach, expect, test } from "bun:test";
import { TURN_CHANGES_PROTOCOL_VERSION, type TurnChangeSet } from "@thinkrail/contracts";
import { useAppStore } from "./index";

const workspaceId = "turn-workspace";
const state = useAppStore.getState;

function turn(
	id: string,
	startedAt: number,
	overrides: Partial<TurnChangeSet> = {},
): TurnChangeSet {
	return {
		id,
		workspaceId,
		sessionId: "turn-session",
		startedAt,
		settledAt: 100 - startedAt,
		baseTree: `base-${id}`,
		headTree: `head-${id}`,
		changes: [{ path: `${id}.ts`, status: "modified", added: 1, removed: 0 }],
		...overrides,
	};
}

function readTurns(id = workspaceId) {
	const current = state();
	const baseline = current.turnsByWorkspace[id] ?? [];
	const generation = current.connectionGeneration;
	return (turns: TurnChangeSet[]) => state().setWorkspaceTurns(id, turns, baseline, generation);
}

beforeEach(() => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	state().setStatus("connected");
	state().installWelcomeSnapshot(TURN_CHANGES_PROTOCOL_VERSION, [], []);
});

test("a live receipt seeds a workspace before its first turns read", () => {
	const live = turn("live", 2);
	state().applyTurnChanged(live);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([live]);
});

test("an empty initial snapshot preserves a receipt pushed while the read was pending", () => {
	const finish = readTurns();
	const live = turn("live", 2);
	state().applyTurnChanged(live);
	finish([]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([live]);
});

test("initial hydration merges history with live receipts and live wins duplicate ids", () => {
	const finish = readTurns();
	const history = turn("history", 1);
	const live = turn("live", 2, { headTree: "live-head" });
	state().applyTurnChanged(live);
	finish([turn("live", 2, { headTree: "stale-head" }), history]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([history, live]);
});

test("an empty reconnect snapshot prunes baseline receipts but preserves intervening pushes", () => {
	readTurns()([turn("old", 1)]);
	state().setStatus("disconnected");
	state().setStatus("connected");
	state().installWelcomeSnapshot(TURN_CHANGES_PROTOCOL_VERSION, [], []);
	const finish = readTurns();
	const live = turn("live", 2);
	state().applyTurnChanged(live);
	finish([]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([live]);
	readTurns()([]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([]);
});

test("a pushed replacement of a baseline receipt wins the pending snapshot", () => {
	readTurns()([turn("updated", 1), turn("pruned", 0)]);
	const finish = readTurns();
	const replacement = turn("updated", 1, { headTree: "replacement" });
	state().applyTurnChanged(replacement);
	finish([turn("updated", 1, { headTree: "stale" })]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([replacement]);
});

test("a snapshot replaces unchanged baseline receipts rather than retaining stale values", () => {
	readTurns()([turn("updated", 1), turn("pruned", 0)]);
	const replacement = turn("updated", 1, { headTree: "replacement" });
	readTurns()([replacement]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([replacement]);
});

test("snapshot receipts are deduplicated, start-ordered and capped at thirty without mutating input", () => {
	const turns = Array.from({ length: 40 }, (_, index) => turn(`turn-${index}`, index));
	const replacement = turn("turn-39", 39, { headTree: "replacement" });
	const snapshot = [...turns].reverse().concat(replacement);
	const original = [...snapshot];
	readTurns()(snapshot);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([...turns.slice(10, 39), replacement]);
	expect(snapshot).toEqual(original);
});

test("live receipts are deduplicated, start-ordered and capped at thirty", () => {
	const turns = Array.from({ length: 40 }, (_, index) => turn(`turn-${index}`, index));
	for (const receipt of [...turns].reverse()) state().applyTurnChanged(receipt);
	const replacement = turn("turn-39", 39, { headTree: "replacement" });
	state().applyTurnChanged(replacement);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([...turns.slice(10, 39), replacement]);
});

test("reconciliation caps the combined snapshot and live receipts by start order", () => {
	const turns = Array.from({ length: 40 }, (_, index) => turn(`turn-${index}`, index));
	readTurns()(turns.slice(0, 30));
	const finish = readTurns();
	for (const receipt of turns.slice(35).reverse()) state().applyTurnChanged(receipt);
	finish(turns.slice(5, 35));
	expect(state().turnsByWorkspace[workspaceId]).toEqual(turns.slice(10));
});

test("a response cannot seed turns after disconnect or from an earlier connection", () => {
	const finish = readTurns();
	const stale = turn("stale", 1);
	state().setStatus("disconnected");
	finish([stale]);
	expect(state().turnsByWorkspace[workspaceId]).toBeUndefined();
	state().setStatus("connected");
	state().installWelcomeSnapshot(TURN_CHANGES_PROTOCOL_VERSION, [], []);
	finish([stale]);
	expect(state().turnsByWorkspace[workspaceId]).toBeUndefined();
	const current = turn("current", 2);
	readTurns()([current]);
	finish([stale]);
	expect(state().turnsByWorkspace[workspaceId]).toEqual([current]);
});

test("workspace removal rejects pending snapshots and pushes without touching a sibling", () => {
	readTurns()([turn("old", 1)]);
	const sibling = turn("sibling", 2, { workspaceId: "sibling-workspace" });
	readTurns(sibling.workspaceId)([sibling]);
	const finish = readTurns();
	state().applyWorkspaceRemoved("project", workspaceId);
	finish([turn("stale", 3)]);
	state().applyTurnChanged(turn("late", 4));
	expect(state().turnsByWorkspace).toEqual({ [sibling.workspaceId]: [sibling] });
});
