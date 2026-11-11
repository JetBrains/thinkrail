import { expect, test } from "bun:test";
import { createReconnectLoop } from "./reconnectLoop";

function manualTimers() {
	const pending: { run: () => void; ms: number }[] = [];
	return {
		pending,
		setTimer: (run: () => void, ms: number) => {
			const entry = { run, ms };
			pending.push(entry);
			return entry;
		},
		clearTimer: (handle: unknown) => {
			const index = pending.indexOf(handle as { run: () => void; ms: number });
			if (index >= 0) pending.splice(index, 1);
		},
		fire: () => pending.shift()?.run(),
	};
}

const settle = () => Bun.sleep(0);

test("a drop retries with doubling, capped backoff and resets once back", async () => {
	const timers = manualTimers();
	const results: boolean[] = [false, false, true];
	const states: boolean[] = [];
	const loop = createReconnectLoop({
		attempt: async () => {
			if (!results.shift()) throw new Error("down");
		},
		isTerminal: () => false,
		onLost: () => {},
		onOpenChange: (open) => states.push(open),
		initialBackoffMs: 100,
		maxBackoffMs: 300,
		...timers,
	});
	loop.opened();
	loop.dropped();
	expect(timers.pending.map((t) => t.ms)).toEqual([100]);
	timers.fire();
	await settle();
	expect(timers.pending.map((t) => t.ms)).toEqual([200]);
	timers.fire();
	await settle();
	expect(timers.pending.map((t) => t.ms)).toEqual([300]);
	timers.fire();
	await settle();
	expect(loop.open).toBe(true);
	expect(states).toEqual([true, false, true]);

	loop.dropped();
	expect(timers.pending.map((t) => t.ms)).toEqual([100]);
	loop.stop();
	expect(timers.pending).toEqual([]);
});

test("now() skips the wait, and is a no-op while open or mid-attempt", async () => {
	const timers = manualTimers();
	let attempts = 0;
	let finish: () => void = () => {};
	const loop = createReconnectLoop({
		attempt: () => {
			attempts++;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
		isTerminal: () => false,
		onLost: () => {},
		initialBackoffMs: 10_000,
		...timers,
	});
	loop.opened();
	loop.now();
	expect(attempts).toBe(0);
	loop.dropped();
	loop.now();
	expect(attempts).toBe(1);
	expect(timers.pending).toEqual([]);
	loop.now();
	expect(attempts).toBe(1);
	finish();
	await settle();
	expect(loop.open).toBe(true);
});

test("a terminal failure stops retrying and reports the error", async () => {
	const timers = manualTimers();
	const lost: unknown[] = [];
	const retried: unknown[] = [];
	const loop = createReconnectLoop({
		attempt: async () => {
			throw new Error("revoked");
		},
		isTerminal: (error) => error instanceof Error && error.message === "revoked",
		onLost: (error) => lost.push(error),
		onRetryFailed: (error) => retried.push(error),
		...timers,
	});
	loop.dropped();
	timers.fire();
	await settle();
	expect(lost).toHaveLength(1);
	expect(retried).toEqual([]);
	expect(timers.pending).toEqual([]);
	loop.dropped();
	expect(timers.pending).toEqual([]);
});
