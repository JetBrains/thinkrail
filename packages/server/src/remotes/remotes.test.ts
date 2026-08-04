import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Project } from "@thinkrail/contracts";
import { saveProjects } from "../persistence";
import {
	checkNow,
	configureRemoteChecks,
	JITTER_FRACTION,
	MIN_CHECK_INTERVAL_MS,
	noteClientActivity,
	startRemoteChecks,
	stopRemoteChecks,
} from "./remotes";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-remotes-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	configureRemoteChecks(DEFAULT_CONFIG); // a known 15-minute baseline, regardless of test order
});

afterEach(() => {
	stopRemoteChecks(); // never leak a live timer into the next test
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function project(id: string): Project {
	return { id, name: id, path: `/tmp/${id}`, slug: id, lastOpened: 0 };
}

/**
 * A fake `setTimer`/`clearTimer` pair: no real timer is ever armed. `fireLatest()` invokes the most
 * recently scheduled callback synchronously, as if it had elapsed — this is what lets the backstop's
 * self-rescheduling loop be driven through hundreds of rounds instantly, with no sleep anywhere.
 */
function fakeScheduler() {
	const scheduled: { fn: () => void; ms: number; handle: number }[] = [];
	const cleared: number[] = [];
	let nextHandle = 0;
	const setTimer = (fn: () => void, ms: number): number => {
		const handle = ++nextHandle;
		scheduled.push({ fn, ms, handle });
		return handle;
	};
	const clearTimer = (handle: unknown): void => {
		cleared.push(handle as number);
	};
	/** The most recently scheduled entry, narrowed to defined (throws on an empty schedule) — sidesteps
	 * `noUncheckedIndexedAccess` turning every `scheduled[i]` access into an `| undefined` at call sites. */
	const latest = (): { fn: () => void; ms: number; handle: number } => {
		const entry = scheduled[scheduled.length - 1];
		if (!entry) throw new Error("no timer scheduled");
		return entry;
	};
	const fireLatest = (): void => latest().fn();
	return { scheduled, cleared, setTimer, clearTimer, fireLatest, latest };
}

// ── the no-client gate ──────────────────────────────────────────────────

test("a check is skipped entirely while no client has ever been active", async () => {
	saveProjects([project("p1")]);
	const calls: string[] = [];
	const fake = fakeScheduler();
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
	});
	fake.fireLatest(); // the backstop elapses — but nobody has ever shown up
	await Promise.resolve();
	expect(calls).toEqual([]);

	noteClientActivity(); // now someone's here
	await Promise.resolve();
	expect(calls).toEqual(["p1"]);
});

test("startRemoteChecks arms the backstop but never itself invokes a check", () => {
	saveProjects([project("p1")]);
	const calls: string[] = [];
	const fake = fakeScheduler();
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
	});
	expect(calls).toEqual([]);
	expect(fake.scheduled).toHaveLength(1); // armed, just not fired
});

// ── the per-project floor ──────────────────────────────────────────────

test("the 60s floor collapses three activity nudges into one check per project", async () => {
	saveProjects([project("p1")]);
	const calls: string[] = [];
	let clock = 1_000_000;
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		now: () => clock,
		setTimer: () => 0,
		clearTimer: () => {},
	});

	noteClientActivity();
	await Promise.resolve();
	clock += 1_000; // +1s — well inside the 60s floor
	noteClientActivity();
	await Promise.resolve();
	clock += 1_000; // +2s total — still inside the floor
	noteClientActivity();
	await Promise.resolve();
	expect(calls).toEqual(["p1"]); // three nudges, one probe

	clock += MIN_CHECK_INTERVAL_MS; // the floor has now fully elapsed
	noteClientActivity();
	await Promise.resolve();
	expect(calls).toEqual(["p1", "p1"]); // the floor releases — this isn't "once ever"
});

test("checkNow targets one project, independently floored from another project's activity", async () => {
	saveProjects([project("p1"), project("p2")]);
	const calls: string[] = [];
	let clock = 1_000_000;
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		now: () => clock,
		setTimer: () => 0,
		clearTimer: () => {},
	});

	await checkNow("p1");
	clock += 1_000;
	await checkNow("p1"); // inside the floor — dropped
	clock += 1_000;
	await checkNow("p2"); // a different project — its own floor, unaffected by p1's
	expect(calls).toEqual(["p1", "p2"]);
});

// ── the jittered backstop ────────────────────────────────────────────────

test("the backstop's delay follows intervalMs * (1 + JITTER_FRACTION * draw) exactly", () => {
	const fake = fakeScheduler();
	const draws = [0, 0.5, 0.999999];
	let i = 0;
	startRemoteChecks({
		checkProject: async () => {},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
		random: () => draws[i++ % draws.length] as number,
	});
	const intervalMs = DEFAULT_CONFIG.gitRemoteCheckIntervalMinutes * 60_000;
	// The initial arm already consumed draws[0] = 0 — the lower bound, exactly.
	expect(fake.latest().ms).toBe(intervalMs);
	fake.fireLatest(); // draws[1] = 0.5 → exactly the midpoint
	expect(fake.latest().ms).toBe(intervalMs * 1.1);
	fake.fireLatest(); // draws[2] ≈ 1 → just under the open upper bound
	const last = fake.latest().ms;
	expect(last).toBeGreaterThan(intervalMs);
	expect(last).toBeLessThan(intervalMs * (1 + JITTER_FRACTION));
});

test("the backstop's jitter is bounded but never fixed across many rounds", () => {
	const fake = fakeScheduler();
	startRemoteChecks({
		checkProject: async () => {},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
		// `random` deliberately NOT overridden: this round-trips through the real `Math.random`,
		// proving the bound holds for the production draw too, not just a rigged test double.
	});
	for (let i = 0; i < 500; i++) fake.fireLatest();
	const delays = fake.scheduled.map((s) => s.ms);
	const intervalMs = DEFAULT_CONFIG.gitRemoteCheckIntervalMinutes * 60_000;
	for (const d of delays) {
		expect(d).toBeGreaterThanOrEqual(intervalMs);
		expect(d).toBeLessThan(intervalMs * (1 + JITTER_FRACTION));
	}
	// Never a fixed delay: across 500 real draws, more than one distinct value must appear — a fixed
	// delay would defeat the anti-thundering-herd purpose jitter exists for.
	expect(new Set(delays).size).toBeGreaterThan(1);
});

test("configureRemoteChecks rearms the backstop immediately with the new interval", () => {
	const fake = fakeScheduler();
	startRemoteChecks({
		checkProject: async () => {},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
		random: () => 0, // pin to the lower bound so the math is exact
	});
	expect(fake.scheduled).toHaveLength(1);
	const firstHandle = fake.latest().handle;
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheckIntervalMinutes: 1 });
	expect(fake.cleared).toEqual([firstHandle]);
	expect(fake.scheduled).toHaveLength(2);
	expect(fake.latest().ms).toBe(60_000); // 1 minute, applied at once — no waiting for the old tick
});

// ── lifecycle: stop leaves no live timer ────────────────────────────────

test("stopRemoteChecks clears the pending timer, and a tick that fires anyway is a no-op", async () => {
	saveProjects([project("p1")]);
	const fake = fakeScheduler();
	const calls: string[] = [];
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
	});
	noteClientActivity(); // a client has been seen, so a tick WOULD check if it ran
	await Promise.resolve();
	calls.length = 0; // discard the activity-triggered check; only the backstop tick matters below
	const pending = fake.latest();
	stopRemoteChecks();
	expect(fake.cleared).toContain(pending.handle);

	// Simulate the real-clock race: the OS timer had already fired before clearTimeout took effect.
	pending.fn();
	await Promise.resolve();
	expect(calls).toEqual([]); // stopped means stopped — no check...
	expect(fake.scheduled).toHaveLength(1); // ...and no reschedule either: no live timer survives.
});

// ── Promise hygiene ──────────────────────────────────────────────────────

test("one project's rejected check does not stop another project's check, or the loop", async () => {
	saveProjects([project("p1"), project("p2")]);
	const calls: string[] = [];
	let clock = 1_000_000;
	const warnings: unknown[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};
	try {
		startRemoteChecks({
			checkProject: async (id) => {
				calls.push(id);
				if (id === "p1") throw new Error("network unreachable");
			},
			now: () => clock,
			setTimer: () => 0,
			clearTimer: () => {},
		});
		noteClientActivity();
		await Promise.resolve();
		await Promise.resolve(); // let p1's rejection settle through its `.catch`
		expect(calls.sort()).toEqual(["p1", "p2"]);
		expect(warnings.length).toBeGreaterThan(0); // logged, not swallowed silently

		// The loop survives: past the floor, a fresh sweep still reaches BOTH projects again — p1's
		// earlier rejection didn't leave it permanently "in flight" or otherwise wedged.
		calls.length = 0;
		clock += MIN_CHECK_INTERVAL_MS;
		noteClientActivity();
		await Promise.resolve();
		await Promise.resolve();
		expect(calls.sort()).toEqual(["p1", "p2"]);
	} finally {
		console.warn = originalWarn;
	}
});
