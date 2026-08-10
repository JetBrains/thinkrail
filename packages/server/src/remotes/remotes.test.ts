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

/** Drains the microtask queue deep enough for a `checkProject(...).catch().finally()`-shaped chain to
 * fully settle (several `.then`-equivalent hops), without ever touching a real timer or the wall clock —
 * needed wherever a test's next step depends on `state.inFlight` having already cleared. */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
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
	await flushMicrotasks(); // let this round's in-flight promise fully clear before the next nudge
	clock += 1_000; // +1s — well inside the 60s floor
	noteClientActivity();
	await flushMicrotasks();
	clock += 1_000; // +2s total — still inside the floor
	noteClientActivity();
	await flushMicrotasks();
	expect(calls).toEqual(["p1"]); // three nudges, one probe

	clock += MIN_CHECK_INTERVAL_MS; // the floor has now fully elapsed
	noteClientActivity();
	await flushMicrotasks();
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

test("a changed MODE sweeps every project at once — even inside the anti-thrash floor", async () => {
	// Rearming alone only changes WHEN the next check runs; every pair's already-published `RemoteState`
	// would keep describing the old mode until then — up to a full day at the maximum interval. And the
	// floor is the wrong guard here: a user toggling the setting seconds after a check ran is exactly when
	// the stale state is most visible, so a floor-gated sweep would drop the update precisely then.
	saveProjects([project("p1"), project("p2")]);
	const fake = fakeScheduler();
	const calls: string[] = [];
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
	});

	// Put both projects well inside the floor: a check just ran for each.
	noteClientActivity();
	await flushMicrotasks();
	expect(calls.toSorted()).toEqual(["p1", "p2"]);
	calls.length = 0;

	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "off" });
	await flushMicrotasks();

	expect(calls.toSorted()).toEqual(["p1", "p2"]);
});

test("an interval-only change rearms but does NOT sweep — a settings save is not a fleet-wide network round", async () => {
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

	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheckIntervalMinutes: 42 });
	await flushMicrotasks();

	expect(calls).toEqual([]); // cadence changed; what each pair's state MEANS did not
	expect(fake.scheduled).toHaveLength(2); // but the backstop was still rearmed
});

test("configuring before the scheduler is armed never checks anything", async () => {
	// Boot order: `server.ts` calls `configureRemoteChecks(getConfig())` BEFORE `startRemoteChecks`, and the
	// persisted mode often differs from `DEFAULT_CONFIG`'s. That must not fire a check round at boot — the
	// no-client gate is the whole reason nothing runs until a client actually connects.
	saveProjects([project("p1")]);
	const calls: string[] = [];
	stopRemoteChecks();

	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	await flushMicrotasks();

	expect(calls).toEqual([]);
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

// ── the backstop's resume path ───────────────────────────────────────────

test("a backstop tick resumes checking once a client has connected, with no further activity nudge", async () => {
	saveProjects([project("p1")]);
	const calls: string[] = [];
	let clock = 1_000_000;
	const fake = fakeScheduler();
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
		},
		now: () => clock,
		setTimer: fake.setTimer,
		clearTimer: fake.clearTimer,
	});

	fake.fireLatest(); // the backstop elapses before anyone has ever shown up — must be a no-op
	await flushMicrotasks();
	expect(calls).toEqual([]);

	noteClientActivity(); // latches hasClient; this call's OWN sweep also checks p1 once
	await flushMicrotasks(); // let that check fully settle — its in-flight promise must clear before below
	expect(calls).toEqual(["p1"]);
	calls.length = 0; // discard the activity sweep's own check — only the SUBSEQUENT tick matters below

	clock += MIN_CHECK_INTERVAL_MS; // past the floor, so the next tick isn't dropped by it
	fake.fireLatest(); // the NEXT backstop tick, with no further noteClientActivity() call at all
	await flushMicrotasks();
	expect(calls).toEqual(["p1"]); // hasClient is latched — the tick itself resumes checking
});

// ── Promise hygiene ──────────────────────────────────────────────────────

test("a checkProject that throws SYNCHRONOUSLY (before returning any promise) does not abort the sweep for the remaining projects", async () => {
	saveProjects([project("p1"), project("p2"), project("p3")]);
	const calls: string[] = [];
	const warnings: unknown[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};
	try {
		startRemoteChecks({
			// Deliberately NOT `async` — `CheckProjectFn`'s type promises a `Promise<void>`, but nothing
			// stops a real implementation from throwing before it ever constructs one (a non-async function
			// doing a synchronous git call, say). This must be caught exactly like a rejection.
			checkProject: (id) => {
				calls.push(id);
				if (id === "p2") throw new Error("synchronous failure before any promise exists");
				return Promise.resolve();
			},
			setTimer: () => 0,
			clearTimer: () => {},
		});
		noteClientActivity();
		await Promise.resolve();
		await Promise.resolve();
		expect(calls.sort()).toEqual(["p1", "p2", "p3"]); // every project still got its turn
		expect(warnings.length).toBeGreaterThan(0); // the synchronous throw was logged, not silently lost
	} finally {
		console.warn = originalWarn;
	}
});

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
		await flushMicrotasks(); // let p1's rejection settle through its `.catch` (and both clear in-flight)
		expect(calls.sort()).toEqual(["p1", "p2"]);
		expect(warnings.length).toBeGreaterThan(0); // logged, not swallowed silently

		// The loop survives: past the floor, a fresh sweep still reaches BOTH projects again — p1's
		// earlier rejection didn't leave it permanently "in flight" or otherwise wedged.
		calls.length = 0;
		clock += MIN_CHECK_INTERVAL_MS;
		noteClientActivity();
		await flushMicrotasks();
		expect(calls.sort()).toEqual(["p1", "p2"]);
	} finally {
		console.warn = originalWarn;
	}
});

// ── in-flight dedupe (distinct from the floor) ──────────────────────────

test("checkNow returns the SAME promise as an already in-flight check for that project", async () => {
	saveProjects([project("p1")]);
	const calls: string[] = [];
	let resolveCheck: (() => void) | undefined;
	startRemoteChecks({
		checkProject: async (id) => {
			calls.push(id);
			// Hangs deliberately — a manually-controlled deferred, so the check is PROVABLY still
			// pending (not settled within a microtask or two, unlike every other fake in this suite).
			await new Promise<void>((resolve) => {
				resolveCheck = resolve;
			});
		},
		setTimer: () => 0,
		clearTimer: () => {},
	});

	const first = checkNow("p1");
	await Promise.resolve(); // let checkProject start and suspend on its own still-pending deferred
	expect(calls).toEqual(["p1"]);

	const second = checkNow("p1"); // genuinely in flight, not yet settled — must share the SAME promise
	expect(second).toBe(first);

	let settled = false;
	void second.then(() => {
		settled = true;
	});
	await Promise.resolve();
	expect(settled).toBe(false); // still pending — this isn't an instant no-op resolve in disguise
	expect(calls).toEqual(["p1"]); // checkProject was invoked exactly once, not twice

	resolveCheck?.();
	await first;
	await second;
	expect(settled).toBe(true);
});
