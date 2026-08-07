import { describe, expect, test } from "bun:test";
import { createPtySizeSync, type PtyGrid } from "./ptySizeSync";

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

		// The failed grid was not cached as applied, so the next fit retries it.
		sync.request({ ...size });
		expect(attempts).toEqual([size, size]);
		second.resolve();
		await tick();

		sync.request({ ...size });
		expect(attempts).toHaveLength(2); // successful acknowledgement suppresses duplicates
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
