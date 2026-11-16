import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_CONFIG, SUBAGENT_CATALOG_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useAppStore } from "@/store";
import { createSubagentAvailabilitySaver } from "./subagentAvailability";

const original = useAppStore.getState();
beforeEach(() => {
	useAppStore.setState({
		status: "connected",
		protocolVersion: SUBAGENT_CATALOG_PROTOCOL_VERSION,
		disabledSubagents: ["temporarily-missing"],
		connectionGeneration: 1,
	});
});
afterEach(() => useAppStore.setState(original, true));
const push = (disabledSubagents: string[]) =>
	useAppStore.getState().applyConfig({ ...DEFAULT_CONFIG, disabledSubagents });
function deferred() {
	let resolve = () => {};
	let reject = (_error: Error) => {};
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test("ACK alone does not update or unlock; rapid writes are blocked and subsequent saves rebase", async () => {
	const writes: string[][] = [];
	const saver = createSubagentAvailabilitySaver(async (next) => {
		writes.push(next);
	});
	const first = saver.save("worker", false);
	expect(saver.getSnapshot().pending).toBe(true);
	expect(await saver.save("scout", false)).toBeNull();
	await Promise.resolve();
	expect(useAppStore.getState().disabledSubagents).toEqual(["temporarily-missing"]);
	expect(saver.getSnapshot().pending).toBe(true);
	push(["temporarily-missing", "worker"]);
	expect(await first).toBe(true);
	const second = saver.save("scout", false);
	expect(writes).toEqual([
		["temporarily-missing", "worker"],
		["temporarily-missing", "worker", "scout"],
	]);
	push(writes[1] ?? []);
	expect(await second).toBe(true);
});

test("a push before ACK changes authoritative display but keeps the write lock until the request succeeds", async () => {
	const request = deferred();
	const saver = createSubagentAvailabilitySaver(() => request.promise);
	const save = saver.save("worker", false);
	push(["temporarily-missing", "worker"]);
	expect(saver.getSnapshot().pending).toBe(true);
	request.resolve();
	expect(await save).toBe(true);
	expect(saver.getSnapshot().pending).toBe(false);
});

test("rejection preserves settings and a retry uses the latest list, including missing names", async () => {
	const writes: string[][] = [];
	let reject = true;
	const saver = createSubagentAvailabilitySaver(async (next) => {
		writes.push(next);
		if (reject) throw new Error("disk full");
	});
	expect(await saver.save("worker", false)).toBe(false);
	expect(useAppStore.getState().disabledSubagents).toEqual(["temporarily-missing"]);
	expect(saver.getSnapshot().failed).toEqual({ name: "worker", enabled: false });
	push(["peer-disabled", "temporarily-missing"]);
	reject = false;
	const retry = saver.save("worker", false);
	push(writes[1] ?? []);
	expect(await retry).toBe(true);
	expect(writes[1]).toEqual(["peer-disabled", "temporarily-missing", "worker"]);
});

test("disconnect holds the lock until the replayable request settles and fails confirmation", async () => {
	const request = deferred();
	const saver = createSubagentAvailabilitySaver(() => request.promise);
	const save = saver.save("worker", false);
	useAppStore.getState().setStatus("disconnected");
	expect(saver.getSnapshot().pending).toBe(true);
	useAppStore.setState({
		status: "connected",
		connectionGeneration: 2,
		protocolVersion: SUBAGENT_CATALOG_PROTOCOL_VERSION,
	});
	expect(await saver.save("scout", false)).toBeNull();
	request.resolve();
	expect(await save).toBe(false);
	expect(saver.getSnapshot().failed).not.toBeNull();
});

test("an unrelated settings push does not confirm a role save; missing confirmation is retryable", async () => {
	const saver = createSubagentAvailabilitySaver(async () => {}, 5);
	const save = saver.save("worker", false);
	push(["temporarily-missing"]);
	expect(await save).toBe(false);
	expect(saver.getSnapshot().pending).toBe(false);
	expect(useAppStore.getState().disabledSubagents).toEqual(["temporarily-missing"]);
});

test("enabling removes only the chosen role and unsupported hosts cannot write", async () => {
	push(["worker", "temporarily-missing"]);
	const writes: string[][] = [];
	const saver = createSubagentAvailabilitySaver(async (next) => {
		writes.push(next);
		push(next);
	});
	expect(await saver.save("worker", true)).toBe(true);
	expect(writes).toEqual([["temporarily-missing"]]);
	useAppStore.setState({ protocolVersion: SUBAGENT_CATALOG_PROTOCOL_VERSION - 1 });
	expect(await saver.save("scout", false)).toBeNull();
	expect(writes).toHaveLength(1);
});

test("a late authoritative change makes Retry a no-op rather than waiting for a redundant broadcast", async () => {
	let requests = 0;
	const saver = createSubagentAvailabilitySaver(async () => {
		requests += 1;
		throw new Error("connection lost");
	});
	expect(await saver.save("worker", false)).toBe(false);
	push(["temporarily-missing", "worker"]);
	expect(await saver.save("worker", false)).toBe(true);
	expect(requests).toBe(1);
	expect(saver.getSnapshot().failed).toBeNull();
});
