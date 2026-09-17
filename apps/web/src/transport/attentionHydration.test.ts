import { expect, test } from "bun:test";
import type {
	SessionAttention,
	SessionAttentionPayload,
	SessionRunning,
	SessionRunningPayload,
} from "@thinkrail/contracts";
import { createAttentionHydration, createTokenizedSnapshotHydrator } from "./attentionHydration";

const payload = (sessionId: string, attentionId: string | null): SessionAttentionPayload => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	attentionId,
});

const row = (sessionId: string, attentionId: string): SessionAttention => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	attentionId,
});

function attentionHarness() {
	const log: string[] = [];
	const hydration = createAttentionHydration({
		apply: (value) => log.push(`apply:${value.sessionId}=${value.attentionId}`),
		hydrate: (rows) => log.push(`hydrate:[${rows.map((value) => value.sessionId).join(",")}]`),
	});
	return { log, hydration };
}

test("attention pushes apply directly without a snapshot in flight", () => {
	const { log, hydration } = attentionHarness();
	hydration.push(payload("s1", "candidate-1"));
	expect(log).toEqual(["apply:s1=candidate-1"]);
});

test("attention pushes replay after the snapshot in arrival order", () => {
	const { log, hydration } = attentionHarness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-2"));
	hydration.push(payload("s2", null));
	hydration.settle(token, [row("s1", "candidate-1")]);
	expect(log).toEqual(["hydrate:[s1]", "apply:s1=candidate-2", "apply:s2=null"]);
});

test("a failed attention snapshot replays its only surviving truth", () => {
	const { log, hydration } = attentionHarness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-1"));
	hydration.fail(token);
	expect(log).toEqual(["apply:s1=candidate-1"]);
});

test("abandon prevents an older host from replaying buffered attention", () => {
	const { log, hydration } = attentionHarness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-1"));
	hydration.abandon();
	hydration.fail(token);
	hydration.settle(token, [row("s2", "candidate-2")]);
	expect(log).toEqual([]);
});

const runningPayload = (sessionId: string, running: boolean): SessionRunningPayload => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	running,
});

const runningRow = (sessionId: string): SessionRunning => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
});

function runningHarness() {
	const log: string[] = [];
	const hydration = createTokenizedSnapshotHydrator<SessionRunning, SessionRunningPayload>({
		apply: (value) => log.push(`apply:${value.sessionId}=${value.running}`),
		hydrate: (rows) => log.push(`hydrate:[${rows.map((value) => value.sessionId).join(",")}]`),
	});
	return { log, hydration };
}

test("the generic hydrator replays running pushes after snapshot install in arrival order", () => {
	const { log, hydration } = runningHarness();
	const token = hydration.begin();
	hydration.push(runningPayload("s1", true));
	hydration.push(runningPayload("s2", false));
	hydration.settle(token, [runningRow("s0")]);
	expect(log).toEqual(["hydrate:[s0]", "apply:s1=true", "apply:s2=false"]);
});

test("the generic hydrator ignores superseded tokens and keeps only the current buffer", () => {
	const { log, hydration } = runningHarness();
	const first = hydration.begin();
	hydration.push(runningPayload("old", true));
	const second = hydration.begin();
	hydration.push(runningPayload("new", true));
	hydration.fail(first);
	hydration.settle(first, [runningRow("old")]);
	hydration.settle(second, [runningRow("snapshot")]);
	expect(log).toEqual(["hydrate:[snapshot]", "apply:new=true"]);
});
