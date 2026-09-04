import { expect, test } from "bun:test";
import type { JbcentralQuotaSnapshot } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	JbcentralQuotaIndicator,
	type JbcentralQuotaViewSnapshot,
} from "./JbcentralQuotaIndicator";
import {
	formatJbcentralQuota,
	startJbcentralQuotaPolling,
	type TimerHandle,
} from "./jbcentralQuota";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function scheduler() {
	let nextId = 1;
	const timers = new Map<number, { callback: () => void; delay: number }>();
	return {
		timers,
		schedule(callback: () => void, delay: number): TimerHandle {
			const id = nextId++;
			timers.set(id, { callback, delay });
			return id;
		},
		cancel(handle: TimerHandle) {
			timers.delete(handle as number);
		},
		runOnly() {
			expect(timers.size).toBe(1);
			const [id, timer] = [...timers.entries()][0] ?? [];
			if (id === undefined || !timer) throw new Error("missing timer");
			timers.delete(id);
			timer.callback();
		},
	};
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

const AVAILABLE: JbcentralQuotaSnapshot = {
	state: "available",
	remaining: 19.92,
	total: 20,
	observedAt: 1_800_000_000_000,
};

function render(snapshot: JbcentralQuotaViewSnapshot): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<JbcentralQuotaIndicator snapshot={snapshot} onRetry={() => {}} />
		</TooltipProvider>,
	);
}

test("quota polling starts immediately, never overlaps, and stops after a hidden result", async () => {
	const first = deferred<JbcentralQuotaSnapshot>();
	const second = deferred<JbcentralQuotaSnapshot>();
	const pending = [first, second];
	const forces: boolean[] = [];
	const snapshots: JbcentralQuotaSnapshot[] = [];
	const clock = scheduler();

	startJbcentralQuotaPolling({
		intervalMs: 30_000,
		request: (force) => {
			forces.push(force);
			const next = pending.shift();
			if (!next) throw new Error("unexpected quota request");
			return next.promise;
		},
		onSnapshot: (snapshot) => snapshots.push(snapshot),
		onError: () => {
			throw new Error("unexpected request error");
		},
		schedule: clock.schedule,
		cancel: clock.cancel,
	});

	expect(forces).toEqual([false]);
	expect(clock.timers.size).toBe(0);
	first.resolve(AVAILABLE);
	await flush();
	expect(snapshots).toEqual([AVAILABLE]);
	expect([...clock.timers.values()].map((timer) => timer.delay)).toEqual([30_000]);

	clock.runOnly();
	expect(forces).toEqual([false, false]);
	expect(clock.timers.size).toBe(0);
	second.resolve({ state: "hidden" });
	await flush();
	expect(snapshots).toEqual([AVAILABLE, { state: "hidden" }]);
	expect(clock.timers.size).toBe(0);
});

test("Retry cancels the pending timer and forces one immediate read", async () => {
	const reads = [
		Promise.resolve<JbcentralQuotaSnapshot>(AVAILABLE),
		Promise.resolve<JbcentralQuotaSnapshot>({ ...AVAILABLE, remaining: 18.5 }),
	];
	const forces: boolean[] = [];
	const clock = scheduler();
	const polling = startJbcentralQuotaPolling({
		intervalMs: 30_000,
		request: (force) => {
			forces.push(force);
			const next = reads.shift();
			if (!next) throw new Error("unexpected quota request");
			return next;
		},
		onSnapshot: () => {},
		onError: () => {},
		schedule: clock.schedule,
		cancel: clock.cancel,
	});
	await flush();
	expect(clock.timers.size).toBe(1);

	polling.retry();
	await flush();
	expect(forces).toEqual([false, true]);
	expect(clock.timers.size).toBe(1);
});

test("stopping polling discards a late response and schedules nothing", async () => {
	const read = deferred<JbcentralQuotaSnapshot>();
	const snapshots: JbcentralQuotaSnapshot[] = [];
	const clock = scheduler();
	const polling = startJbcentralQuotaPolling({
		intervalMs: 1_000,
		request: () => read.promise,
		onSnapshot: (snapshot) => snapshots.push(snapshot),
		onError: () => {},
		schedule: clock.schedule,
		cancel: clock.cancel,
	});
	polling.stop();
	read.resolve(AVAILABLE);
	await flush();
	expect(snapshots).toEqual([]);
	expect(clock.timers.size).toBe(0);
});

test("quota formatting groups thousands and trims insignificant decimals", () => {
	expect(formatJbcentralQuota(19.92, 20, "en-US")).toBe("19.92 / 20");
	expect(formatJbcentralQuota(5_000, 5_000, "en-US")).toBe("5,000 / 5,000");
	expect(formatJbcentralQuota(1.234, 20.999, "en-US")).toBe("1.23 / 21");
});

test("available quota is neutral non-button content with a responsive unit", () => {
	const markup = render(AVAILABLE);
	expect(markup).toContain('data-testid="jbcentral-quota"');
	expect(markup).toContain('data-state="available"');
	expect(markup).toContain("19.92 / 20");
	expect(markup).toContain('class="hidden sm:inline"');
	expect(markup).not.toContain("<button");
});

test("stale and unavailable quota are Retry buttons while zero stays neutral", () => {
	const stale = render({ ...AVAILABLE, state: "stale" });
	expect(stale).toContain("<button");
	expect(stale).toContain('data-state="stale"');
	expect(stale).toContain('data-testid="jbcentral-quota-stale-marker"');

	const unavailable = render({ state: "unavailable" });
	expect(unavailable).toContain("Quota unavailable");
	expect(unavailable).toContain("Retry");

	const zero = render({ ...AVAILABLE, remaining: 0 });
	expect(zero).toContain("0 / 20");
	expect(zero).not.toContain("feedback-error");
	expect(zero).not.toContain("feedback-warning");
});

test("loading is non-interactive and hidden renders nothing", () => {
	const loading = render({ state: "loading" });
	expect(loading).toContain("Loading quota");
	expect(loading).not.toContain("<button");
	expect(render({ state: "hidden" })).toBe("");
});
