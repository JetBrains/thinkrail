import { describe, expect, test } from "bun:test";
import type { PiEvent } from "@thinkrail/contracts";
import type { AdditionalAnalyticsCapture, AdditionalAnalyticsEvent } from "../analytics";
import { ackSend } from "./ackSend";
import { RunObservation, runOutcome } from "./runAnalytics";

function fixture() {
	const events: AdditionalAnalyticsEvent[] = [];
	let capture: AdditionalAnalyticsCapture | null = (event) => events.push(event);
	let time = 0;
	let descriptions = 0;
	const observer = new RunObservation(
		() => capture,
		() => {
			descriptions += 1;
			return { workspace_kind: "managed", provider: "custom", model: "custom" };
		},
		() => time,
	);
	return {
		events,
		observer,
		advance(ms: number) {
			time += ms;
		},
		revoke() {
			capture = null;
			observer.clear();
		},
		grant() {
			capture = (event) => events.push(event);
		},
		descriptions: () => descriptions,
	};
}

const start: PiEvent = { type: "agent_start" };
const settle: PiEvent = { type: "agent_settled", terminal: { stopReason: "stop" } };

const retry: PiEvent = {
	type: "auto_retry_start",
	attempt: 99,
	maxAttempts: 100,
	delayMs: 1000,
	errorMessage: "secret",
};

test("canonical start precedes a fast settlement and ack; attempts never settle a run", async () => {
	const f = fixture();
	await ackSend(
		f.observer.send("private-id", "user", async () => {
			f.observer.observe("private-id", start);
			f.advance(12_000);
			f.observer.observe("private-id", { type: "agent_end", messages: [], willRetry: false });
			f.observer.observe("private-id", retry);
			f.observer.observe("private-id", start);
			f.observer.observe("private-id", { type: "compaction_start", reason: "overflow" });
			f.observer.observe("private-id", { type: "compaction_start", reason: "threshold" });
			expect(f.events).toHaveLength(1);
			f.observer.observe("private-id", settle);
			f.observer.observe("private-id", settle);
		}),
		1,
	);
	expect(f.events).toEqual([
		{
			name: "agent_run_started",
			params: { origin: "user", workspace_kind: "managed", provider: "custom", model: "custom" },
		},
		{
			name: "agent_run_settled",
			params: {
				origin: "user",
				workspace_kind: "managed",
				provider: "custom",
				model: "custom",
				outcome: "normal_stop",
				duration_bucket: "10–59s",
				retry_bucket: "1",
				compaction_bucket: "2–4",
			},
		},
	]);
	expect(JSON.stringify(f.events)).not.toContain("private-id");
	expect(JSON.stringify(f.events)).not.toContain("secret");
});

test("unknown automatic work and internal sends are never labeled user activation", async () => {
	const f = fixture();
	f.observer.observe("unmarked", start);
	f.observer.observe("unmarked", settle);
	await f.observer.send("reviewer", "internal", async () => {
		f.observer.observe("reviewer", start);
		f.observer.observe("reviewer", settle);
	});
	expect(f.events.map((event) => ("origin" in event.params ? event.params.origin : null))).toEqual([
		"unknown",
		"unknown",
		"internal",
		"internal",
	]);
});

test("an accepted internal continuation makes a user run mixed; rejected sends do not", async () => {
	const f = fixture();
	await f.observer.send("chat", "user", async () => {
		f.observer.observe("chat", start);
	});
	await expect(
		f.observer.send("chat", "internal", async () => {
			throw new Error("rejected");
		}),
	).rejects.toThrow("rejected");
	await f.observer.send("chat", "internal", async () => {});
	f.observer.observe("chat", settle);
	expect(f.events[0]).toMatchObject({ params: { origin: "user" } });
	expect(f.events[1]).toMatchObject({ params: { origin: "mixed" } });
});

test("an internal follow-up accepted before delayed agent_start never becomes user-only work", async () => {
	const f = fixture();
	const gate = Promise.withResolvers<void>();
	const user = f.observer.send("chat", "user", () => gate.promise);
	await f.observer.send("chat", "internal", async () => {});
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	gate.resolve();
	await user;
	expect(f.events).toHaveLength(2);
	for (const event of f.events) expect(event).toMatchObject({ params: { origin: "mixed" } });
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	expect(f.events[3]).toMatchObject({ params: { origin: "unknown" } });
});

test("rejected sends before delayed agent_start contribute no origin", async () => {
	const f = fixture();
	const gate = Promise.withResolvers<void>();
	const user = f.observer.send("chat", "user", () => gate.promise);
	await expect(
		f.observer.send("chat", "internal", async () => {
			throw new Error("rejected");
		}),
	).rejects.toThrow("rejected");
	expect(() =>
		f.observer.send("chat", "internal", () => {
			throw new Error("rejected synchronously");
		}),
	).toThrow("rejected synchronously");
	expect(f.events).toEqual([]);
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	gate.resolve();
	await user;
	for (const event of f.events) expect(event).toMatchObject({ params: { origin: "user" } });
});

test("accepted pre-start sends remain excluded across revocation until settlement", async () => {
	const f = fixture();
	await f.observer.send("chat", "internal", async () => {});
	f.revoke();
	f.grant();
	f.observer.observe("chat", start);
	f.observer.observe("chat", retry);
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	expect(f.events).toEqual([]);
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	expect(f.events).toHaveLength(2);
});

test("session deletion removes unresolved intents without letting late resolution affect a new cycle", async () => {
	const f = fixture();
	const gate = Promise.withResolvers<void>();
	const old = f.observer.send("chat", "internal", () => gate.promise);
	f.observer.forget("chat");
	await f.observer.send("chat", "user", async () => {
		f.observer.observe("chat", start);
		gate.resolve();
		await old;
		f.observer.observe("chat", settle);
	});
	for (const event of f.events) expect(event).toMatchObject({ params: { origin: "user" } });
});

test("queue clear releases accepted queued origins but preserves a pending pre-grant cycle", async () => {
	const f = fixture();
	await f.observer.send("cleared", "internal", async () => {});
	f.observer.clearQueue("cleared");
	await f.observer.send("cleared", "user", async () => {
		f.observer.observe("cleared", start);
		f.observer.observe("cleared", settle);
	});
	for (const event of f.events) expect(event).toMatchObject({ params: { origin: "user" } });
	const gate = Promise.withResolvers<void>();
	const pending = f.observer.send("pending", "user", () => gate.promise);
	await f.observer.send("pending", "internal", async () => {});
	f.revoke();
	f.observer.clearQueue("pending");
	f.grant();
	f.observer.observe("pending", start);
	f.observer.clearQueue("pending");
	f.observer.observe("pending", start);
	f.observer.observe("pending", settle);
	gate.resolve();
	await pending;
	expect(f.events).toHaveLength(2);
});

test("queue clearing before enqueue acceptance cannot retain or reapply the cleared origin", async () => {
	const f = fixture();
	const gate = Promise.withResolvers<void>();
	const queued = f.observer.send("chat", "internal", () => gate.promise);
	f.observer.clearQueue("chat");
	gate.resolve();
	await queued;
	await f.observer.send("chat", "user", async () => {
		f.observer.observe("chat", start);
		const nextGate = Promise.withResolvers<void>();
		const next = f.observer.send("chat", "internal", () => nextGate.promise);
		f.observer.clearQueue("chat");
		nextGate.resolve();
		await next;
		f.observer.observe("chat", settle);
	});
	expect(f.events).toHaveLength(2);
	for (const event of f.events) expect(event).toMatchObject({ params: { origin: "user" } });
});

test("full reset releases active sessions and accepted or unresolved intents", async () => {
	const f = fixture();
	f.observer.observe("active", start);
	await f.observer.send("queued", "internal", async () => {});
	const gate = Promise.withResolvers<void>();
	const old = f.observer.send("pending", "internal", () => gate.promise);
	f.observer.reset();
	for (const sessionId of ["active", "queued", "pending"]) {
		await f.observer.send(sessionId, "user", async () => {
			f.observer.observe(sessionId, start);
			f.observer.observe(sessionId, settle);
		});
	}
	gate.resolve();
	await old;
	expect(f.events).toHaveLength(7);
	for (const event of f.events.slice(1))
		expect(event).toMatchObject({ params: { origin: "user" } });
});

test("consent during an existing cycle never reconstructs start, retry or duration history", () => {
	const f = fixture();
	f.revoke();
	f.observer.observe("chat", start);
	f.observer.observe("chat", retry);
	f.advance(100_000);
	f.grant();
	f.observer.observe("chat", start);
	f.observer.observe("chat", retry);
	f.observer.observe("chat", settle);
	expect(f.events).toEqual([]);
	expect(f.descriptions()).toBe(0);
	f.observer.observe("chat", start);
	f.observer.observe("chat", settle);
	expect(f.events[1]).toMatchObject({ params: { duration_bucket: "<10s", retry_bucket: "0" } });
});

test("revocation drops an active run and a delayed old send even after regrant", async () => {
	const f = fixture();
	f.observer.observe("active", start);
	const gate = Promise.withResolvers<void>();
	const sending = f.observer.send("delayed", "user", async () => {
		await gate.promise;
		f.observer.observe("delayed", start);
		f.observer.observe("delayed", settle);
	});
	f.revoke();
	f.grant();
	f.observer.observe("active", start);
	f.observer.observe("active", settle);
	gate.resolve();
	await sending;
	expect(f.events).toHaveLength(1);
	f.observer.observe("delayed", start);
	f.observer.observe("delayed", settle);
	expect(f.events).toHaveLength(3);
});

test("observation faults never interrupt canonical event delivery", () => {
	const observer = new RunObservation(
		() => () => {
			throw new Error("sink");
		},
		() => {
			throw new Error("missing workspace");
		},
	);
	expect(() => observer.observe("chat", start)).not.toThrow();
});

describe("settlement outcomes do not equate stop with verified success", () => {
	for (const [stopReason, expected] of [
		["stop", "normal_stop"],
		["error", "error"],
		["length", "truncated"],
		["aborted", "aborted"],
		["toolUse", "other"],
	] as const) {
		test(stopReason, () => {
			expect(runOutcome({ type: "agent_settled", terminal: { stopReason } })).toBe(expected);
		});
	}
	test("no terminal", () =>
		expect(runOutcome({ type: "agent_settled", terminal: null })).toBe("no_terminal"));
});
