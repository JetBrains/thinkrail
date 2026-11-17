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

test("ACK alone does not update or unlock; rapid writes are blocked and subsequent saves send intent", async () => {
	const writes: { name: string; enabled: boolean }[] = [];
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
		{ name: "worker", enabled: false },
		{ name: "scout", enabled: false },
	]);
	push(["temporarily-missing", "worker", "scout", "peer-disabled"]);
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

test("rejection preserves settings and a retry sends only intent despite peer-list changes", async () => {
	const writes: { name: string; enabled: boolean }[] = [];
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
	push(["peer-disabled", "temporarily-missing", "worker"]);
	expect(await retry).toBe(true);
	expect(writes[1]).toEqual({ name: "worker", enabled: false });
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
	const writes: { name: string; enabled: boolean }[] = [];
	const saver = createSubagentAvailabilitySaver(async (next) => {
		writes.push(next);
		push(["temporarily-missing", "peer-disabled"]);
	});
	expect(await saver.save("worker", true)).toBe(true);
	expect(writes).toEqual([{ name: "worker", enabled: true }]);
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

test("peer changes to other roles before ACK do not prevent target confirmation", async () => {
	const request = deferred();
	const saver = createSubagentAvailabilitySaver(() => request.promise);
	const save = saver.save("worker", false);
	push(["temporarily-missing", "peer-disabled", "worker"]);
	push(["other-peer-disabled", "worker"]);
	expect(saver.getSnapshot().pending).toBe(true);
	request.resolve();
	expect(await save).toBe(true);
	expect(useAppStore.getState().disabledSubagents).toEqual(["other-peer-disabled", "worker"]);
});

test("a peer reversal of the target before ACK is not confirmed", async () => {
	const request = deferred();
	const saver = createSubagentAvailabilitySaver(() => request.promise);
	const save = saver.save("worker", false);
	push(["temporarily-missing", "worker"]);
	push(["temporarily-missing"]);
	request.resolve();
	expect(await save).toBe(false);
});
