import { expect, test } from "bun:test";
import type { SessionAttention, SessionAttentionPayload } from "@thinkrail/contracts";
import { createAttentionHydration } from "./attentionHydration";

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

function harness() {
	const log: string[] = [];
	const hydration = createAttentionHydration({
		apply: (value) => log.push(`apply:${value.sessionId}=${value.attentionId}`),
		hydrate: (rows) => log.push(`hydrate:[${rows.map((value) => value.sessionId).join(",")}]`),
	});
	return { log, hydration };
}

test("attention pushes apply directly without a snapshot in flight", () => {
	const { log, hydration } = harness();
	hydration.push(payload("s1", "candidate-1"));
	expect(log).toEqual(["apply:s1=candidate-1"]);
});

test("attention pushes replay after the snapshot in arrival order", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-2"));
	hydration.push(payload("s2", null));
	hydration.settle(token, [row("s1", "candidate-1")]);
	expect(log).toEqual(["hydrate:[s1]", "apply:s1=candidate-2", "apply:s2=null"]);
});

test("a failed attention snapshot replays its only surviving truth", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-1"));
	hydration.fail(token);
	expect(log).toEqual(["apply:s1=candidate-1"]);
});

test("abandon prevents an older host from replaying buffered attention", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "candidate-1"));
	hydration.abandon();
	hydration.fail(token);
	hydration.settle(token, [row("s2", "candidate-2")]);
	expect(log).toEqual([]);
});
