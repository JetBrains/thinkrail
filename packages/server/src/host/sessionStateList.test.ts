import { expect, test } from "bun:test";
import { trailingSingleFlight } from "./sessionStateList";

function deferredScans() {
	const scans: { resolve: (value: number) => void; reject: (error: Error) => void }[] = [];
	const run = () =>
		new Promise<number>((resolve, reject) => {
			scans.push({ resolve, reject });
		});
	return { scans, run };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("requests that arrive during a scan share the next one, never the running one", async () => {
	const { scans, run } = deferredScans();
	const list = trailingSingleFlight(run);

	const first = list();
	await flush();
	expect(scans).toHaveLength(1);

	const second = list();
	const third = list();
	await flush();
	expect(scans).toHaveLength(1);

	scans[0]?.resolve(1);
	expect(await first).toBe(1);
	await flush();
	expect(scans).toHaveLength(2);

	scans[1]?.resolve(2);
	expect(await second).toBe(2);
	expect(await third).toBe(2);
});

test("a storm of requests costs at most the running scan plus one more", async () => {
	const { scans, run } = deferredScans();
	const list = trailingSingleFlight(run);
	const results = [list()];
	await flush();
	for (let request = 0; request < 20; request++) results.push(list());
	scans[0]?.resolve(1);
	await flush();
	scans[1]?.resolve(2);
	expect(await Promise.all(results)).toEqual([1, ...Array(20).fill(2)]);
	expect(scans).toHaveLength(2);
});

test("a failed scan fails only its own callers, and the next request scans afresh", async () => {
	const { scans, run } = deferredScans();
	const list = trailingSingleFlight(run);
	const failing = list();
	await flush();
	const waiting = list();
	scans[0]?.reject(new Error("disk"));
	await expect(failing).rejects.toThrow("disk");
	await flush();
	scans[1]?.resolve(3);
	expect(await waiting).toBe(3);
	const later = list();
	await flush();
	expect(scans).toHaveLength(3);
	scans[2]?.resolve(4);
	expect(await later).toBe(4);
});
