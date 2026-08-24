import { describe, expect, test } from "bun:test";
import { createPtySizeSync, type PtyGrid, runAfterTerminalRelayout } from "./ptySizeSync";

function deferred() {
	let resolve: (value?: unknown) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<unknown>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, reject, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("terminal attach layout", () => {
	const neverTimeOut = { timeoutMs: 60_000, onTimeout: () => {} };

	test("starts only after web-font relayout settles", async () => {
		const fontLayout = deferred();
		let started = false;
		const startup = runAfterTerminalRelayout(
			() => fontLayout.promise,
			() => {
				started = true;
			},
			neverTimeOut,
		);

		await tick();
		expect(started).toBe(false);
		fontLayout.resolve();
		await startup;
		expect(started).toBe(true);
	});

	test("a relayout failure still starts with the fallback measurement", async () => {
		let started = false;
		await runAfterTerminalRelayout(
			() => Promise.reject(new Error("font failed")),
			() => {
				started = true;
			},
			neverTimeOut,
		);

		expect(started).toBe(true);
	});

	test("a never-settling relayout is bounded: disables the late relayout, then starts", async () => {
		const calls: string[] = [];
		await runAfterTerminalRelayout(
			() => new Promise(() => {}),
			() => calls.push("start"),
			{ timeoutMs: 1, onTimeout: () => calls.push("disable-late-relayout") },
		);

		expect(calls).toEqual(["disable-late-relayout", "start"]);
	});

	test("a relayout that settles in time never triggers the timeout path", async () => {
		let timedOut = false;
		let started = false;
		await runAfterTerminalRelayout(
			() => Promise.resolve(),
			() => {
				started = true;
			},
			{
				timeoutMs: 1,
				onTimeout: () => {
					timedOut = true;
				},
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(started).toBe(true);
		expect(timedOut).toBe(false);
	});
});

describe("PTY size synchronization", () => {
	test("a grid is acknowledged only after the host request succeeds", async () => {
		const attempts: PtyGrid[] = [];
		const first = deferred();
		const second = deferred();
		const requests = [first, second];
		const sync = createPtySizeSync((size) => {
			attempts.push(size);
			const request = requests.shift();
			if (!request) throw new Error("unexpected resize");
			return request.promise;
		});
		const size = { cols: 100, rows: 30 };

		sync.request(size);
		expect(attempts).toEqual([size]);
		first.reject(new Error("not applied"));
		await tick();

		sync.request({ ...size });
		expect(attempts).toEqual([size, size]);
		second.resolve();
		await tick();

		sync.request({ ...size });
		expect(attempts).toHaveLength(2);
	});

	test("coalesces layout changes behind one in-flight resize and sends only the newest", async () => {
		const attempts: PtyGrid[] = [];
		const first = deferred();
		const second = deferred();
		const requests = [first, second];
		const sync = createPtySizeSync((size) => {
			attempts.push(size);
			const request = requests.shift();
			if (!request) throw new Error("unexpected resize");
			return request.promise;
		});

		sync.request({ cols: 80, rows: 24 });
		sync.request({ cols: 90, rows: 25 });
		sync.request({ cols: 120, rows: 40 });
		expect(attempts).toEqual([{ cols: 80, rows: 24 }]);

		first.resolve();
		await tick();
		expect(attempts).toEqual([
			{ cols: 80, rows: 24 },
			{ cols: 120, rows: 40 },
		]);
		second.resolve();
	});

	test("spawn acknowledgement avoids a redundant initial resize", () => {
		const attempts: PtyGrid[] = [];
		const sync = createPtySizeSync((size) => {
			attempts.push(size);
			return Promise.resolve();
		});
		const spawnedAt = { cols: 80, rows: 24 };

		sync.acknowledge(spawnedAt);
		sync.request({ ...spawnedAt });
		expect(attempts).toHaveLength(0);
	});
});
