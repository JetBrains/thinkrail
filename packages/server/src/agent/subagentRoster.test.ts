import { describe, expect, test } from "bun:test";
import type { DelegationService, LifecycleEvent } from "pi-delegation";
import { createSubagentRoster, setSubagentRosterPublisher } from "./subagentRoster";

const usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0.01,
	turns: 1,
	contextTokens: 15,
};

function details(
	sessionId: string,
	status: "queued" | "running" | "completed" | "error" | "aborted",
) {
	return {
		childSessionId: sessionId,
		task: "t",
		status,
		usage,
		durationMs: 5,
		activity: "reading",
	};
}

function fakeService(children: Record<string, { visibility?: "hidden" | "listed" }>) {
	return {
		findChild: (id: string) => {
			const spec = children[id];
			if (!spec) return undefined;
			return {
				record: {
					sessionId: id,
					parentSessionId: "parent-1",
					scope: "ws",
					info: { createdBy: "t", roleName: "worker" },
					visibility: spec.visibility ?? "listed",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				snapshot: { status: "queued", task: "t", details: details(id, "queued") },
			};
		},
	} as unknown as DelegationService;
}

function harness(children: Record<string, { visibility?: "hidden" | "listed" }>) {
	let clock = 1_000_000;
	const timers: (() => void)[] = [];
	const published: string[] = [];
	setSubagentRosterPublisher((p) => published.push(p.workspaceId));
	const roster = createSubagentRoster({
		workspaceId: "ws",
		service: fakeService(children),
		titleOf: () => "Auth refactor",
		now: () => clock,
		setTimer: (fn) => {
			timers.push(fn);
			return timers.length;
		},
		clearTimer: () => {},
	});
	return {
		roster,
		published,
		advance: (ms: number) => {
			clock += ms;
		},
		flush: () => {
			for (const fn of timers.splice(0)) fn();
		},
	};
}

const ev = (type: "run-queued" | "run-started", id: string): LifecycleEvent => ({
	type,
	sessionId: id,
	parentSessionId: "parent-1",
});

describe("subagent roster", () => {
	test("tracks transitions and carries the parent title", () => {
		const h = harness({ a: {} });
		h.roster.handle(ev("run-queued", "a"));
		expect(h.roster.read().counts.queued).toBe(1);
		h.roster.handle(ev("run-started", "a"));
		h.roster.handle({
			type: "run-progress",
			sessionId: "a",
			parentSessionId: "parent-1",
			details: details("a", "running"),
		});
		const read = h.roster.read();
		expect(read.counts.running).toBe(1);
		expect(read.rows[0]?.parentTitle).toBe("Auth refactor");
		expect(read.rows[0]?.activity).toBe("reading");
		expect(read.rows[0]?.usage?.output).toBe(5);
	});

	test("coalesces progress into one publish", () => {
		const h = harness({ a: {} });
		h.roster.handle(ev("run-started", "a"));
		for (let i = 0; i < 5; i++)
			h.roster.handle({
				type: "run-progress",
				sessionId: "a",
				parentSessionId: "parent-1",
				details: details("a", "running"),
			});
		h.flush();
		expect(h.published).toEqual(["ws"]);
		expect(h.roster.read().revision).toBeGreaterThan(1);
	});

	test("hides hidden helpers", () => {
		const h = harness({ r: { visibility: "hidden" } });
		h.roster.handle(ev("run-started", "r"));
		expect(h.roster.read().rows).toHaveLength(0);
	});

	test("keeps failures after the done TTL and drops finished rows", () => {
		const h = harness({ ok: {}, bad: {} });
		for (const id of ["ok", "bad"]) h.roster.handle(ev("run-started", id));
		h.roster.handle({
			type: "run-terminal",
			sessionId: "ok",
			parentSessionId: "parent-1",
			outcome: { status: "completed", details: details("ok", "completed"), finalText: "done" },
		} as unknown as LifecycleEvent);
		h.roster.handle({
			type: "run-terminal",
			sessionId: "bad",
			parentSessionId: "parent-1",
			outcome: {
				status: "error",
				details: details("bad", "error"),
				errorMessage: "boom",
			},
		} as unknown as LifecycleEvent);
		expect(h.roster.read().counts).toMatchObject({ done: 1, failed: 1 });
		h.advance(10 * 60_000);
		const after = h.roster.read();
		expect(after.rows.map((r) => r.childSessionId)).toEqual(["bad"]);
		expect(after.rows[0]?.errorMessage).toBe("boom");
	});

	test("dropping a disposed live child removes its row", () => {
		const h = harness({ a: {} });
		h.roster.handle(ev("run-started", "a"));
		h.roster.handle({ type: "child-disposed", sessionId: "a", parentSessionId: "parent-1" });
		expect(h.roster.read().rows).toHaveLength(0);
	});
});
