import { expect, test } from "bun:test";
import type { SessionActivity, SessionActivityPayload } from "@thinkrail/contracts";
import { createActivityHydration } from "./activityHydration";

const payload = (sessionId: string, status: SessionActivityPayload["status"]) => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	status,
});

const row = (sessionId: string, status: SessionActivity["status"]): SessionActivity => ({
	sessionId,
	workspaceId: "w1",
	projectId: "p1",
	status,
});

function harness() {
	const log: string[] = [];
	const hydration = createActivityHydration({
		apply: (p) => log.push(`apply:${p.sessionId}=${p.status}`),
		hydrate: (rows) => log.push(`hydrate:[${rows.map((r) => r.sessionId).join(",")}]`),
	});
	return { log, hydration };
}

test("with no read in flight a push applies straight through", () => {
	const { log, hydration } = harness();
	hydration.push(payload("s1", "running"));
	expect(log).toEqual(["apply:s1=running"]);
});

test("a push arriving during the read is applied AFTER the snapshot, so it cannot be clobbered", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "failed"));
	expect(log).toEqual([]);
	hydration.settle(token, [row("s1", "running"), row("s2", "queued")]);
	expect(log).toEqual(["hydrate:[s1,s2]", "apply:s1=failed"]);
});

test("buffered pushes replay in arrival order", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "running"));
	hydration.push(payload("s2", "waiting"));
	hydration.push(payload("s1", null));
	hydration.settle(token, []);
	expect(log).toEqual(["hydrate:[]", "apply:s1=running", "apply:s2=waiting", "apply:s1=null"]);
});

test("a failed read still replays its buffer — the pushes are the only truth left", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "running"));
	hydration.fail(token);
	expect(log).toEqual(["apply:s1=running"]);
});

test("a superseded connection discards the buffer instead of replaying dead pushes", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "running"));
	hydration.discard(token);
	expect(log).toEqual([]);
	expect(hydration.buffered()).toBe(0);
});

test("a stale read cannot settle over a newer one", () => {
	const { log, hydration } = harness();
	const stale = hydration.begin();
	const fresh = hydration.begin();
	hydration.push(payload("s1", "running"));

	hydration.settle(stale, [row("s9", "failed")]);
	expect(log).toEqual([]);
	expect(hydration.buffered()).toBe(1);

	hydration.settle(fresh, [row("s2", "queued")]);
	expect(log).toEqual(["hydrate:[s2]", "apply:s1=running"]);
});

test("buffering stops once a read settles, so later pushes apply immediately", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.settle(token, []);
	hydration.push(payload("s1", "running"));
	expect(log).toEqual(["hydrate:[]", "apply:s1=running"]);
});

test("abandon drops the buffer, so a downgraded host cannot inherit a newer host's pushes", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "running"));

	hydration.abandon();
	expect(hydration.buffered()).toBe(0);

	hydration.fail(token);
	hydration.settle(token, [row("s9", "failed")]);
	expect(log).toEqual([]);
});

test("after abandon, pushes apply straight through again", () => {
	const { log, hydration } = harness();
	hydration.begin();
	hydration.abandon();
	hydration.push(payload("s1", "waiting"));
	expect(log).toEqual(["apply:s1=waiting"]);
});

test("a resent request rejected by an older host cannot replay its buffer once abandoned", () => {
	const { log, hydration } = harness();
	const token = hydration.begin();
	hydration.push(payload("s1", "failed"));

	hydration.abandon();
	log.push("cleared");
	hydration.fail(token);

	expect(log).toEqual(["cleared"]);
});
