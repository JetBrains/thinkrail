import { expect, test } from "bun:test";
import { createChannelDemand } from "./demand";

const tick = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

test("sends the ref-counted key set once per change, and again after reconnect", async () => {
	const demand = createChannelDemand();
	const sent: string[][] = [];
	const releaseA = demand.retain("demo:a");
	const releaseA2 = demand.retain("demo:a");
	await tick();
	expect(sent).toEqual([]);

	demand.connect(async (keys) => sent.push(keys));
	expect(sent).toEqual([["demo:a"]]);
	const releaseB = demand.retain("demo:b");
	releaseA();
	releaseA();
	await tick();
	expect(sent).toEqual([["demo:a"], ["demo:a", "demo:b"]]);

	releaseA2();
	releaseB();
	await tick();
	expect(sent.at(-1)).toEqual([]);

	demand.connect(async (keys) => sent.push(keys));
	expect(sent).toHaveLength(4);
});

test("a failed send is retried on the next change", async () => {
	const demand = createChannelDemand();
	const sent: string[][] = [];
	let fail = true;
	demand.connect(async (keys) => {
		sent.push(keys);
		if (fail) throw new Error("old host");
	});
	const release = demand.retain("demo:a");
	await tick();
	await tick();
	fail = false;
	release();
	demand.retain("demo:a");
	await tick();
	expect(sent).toEqual([[], ["demo:a"], ["demo:a"]]);
});
