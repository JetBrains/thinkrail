import { expect, test } from "bun:test";
import type { ResourceMeta } from "@thinkrail/contracts";
import { type LoadedFile, startWorkspaceFileReads } from "./workspaceFileReads";

interface PendingRead {
	resolve: (value: { content: string; meta?: ResourceMeta }) => void;
	reject: (error: unknown) => void;
}

const meta = (hash: string): ResourceMeta => ({ hash, byteLength: hash.length, text: true });

function harness() {
	const reads: PendingRead[] = [];
	let changed: (() => void) | null = null;
	let unsubscribed = false;
	let state: LoadedFile | null = null;
	const stop = startWorkspaceFileReads({
		read: () =>
			new Promise((resolve, reject) => {
				reads.push({ resolve, reject });
			}),
		subscribe: (onChange) => {
			changed = onChange;
			return () => {
				unsubscribed = true;
			};
		},
		bytesUrl: () => "/files/ws/file.bin",
		update: (next) => {
			state = next(state);
		},
	});
	return {
		reads,
		change: () => changed?.(),
		state: () => state,
		stop,
		unsubscribed: () => unsubscribed,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function text(file: LoadedFile | null): string | null {
	return file?.status === "ready" && file.content.kind === "text" ? file.content.text : null;
}

test("a read that lands after a newer one never overwrites it", async () => {
	const file = harness();
	file.change();
	file.reads[1]?.resolve({ content: "new", meta: meta("b") });
	await settle();
	file.reads[0]?.resolve({ content: "old", meta: meta("a") });
	await settle();
	expect(text(file.state())).toBe("new");
});

test("a change event does not discard the read in flight, so bursts cannot starve the first load", async () => {
	const file = harness();
	file.change();
	file.change();
	file.reads[0]?.resolve({ content: "first", meta: meta("a") });
	await settle();
	expect(text(file.state())).toBe("first");
	file.reads[2]?.resolve({ content: "latest", meta: meta("c") });
	await settle();
	expect(text(file.state())).toBe("latest");
});

test("a re-read with the same hash keeps the loaded object", async () => {
	const file = harness();
	file.reads[0]?.resolve({ content: "same", meta: meta("a") });
	await settle();
	const first = file.state();
	file.change();
	file.reads[1]?.resolve({ content: "same", meta: meta("a") });
	await settle();
	expect(file.state()).toBe(first);
});

test("a failed re-read keeps the last good content; a failed first read shows the error", async () => {
	const file = harness();
	file.reads[0]?.reject(new Error("offline"));
	await settle();
	expect(file.state()).toEqual({ status: "error", message: "offline" });
	file.change();
	file.reads[1]?.resolve({ content: "back", meta: meta("a") });
	await settle();
	file.change();
	file.reads[2]?.reject(new Error("timed out"));
	await settle();
	expect(text(file.state())).toBe("back");
});

test("binary metadata becomes a byte URL, a missing hash an absent side", async () => {
	const file = harness();
	file.reads[0]?.resolve({ content: "", meta: { hash: "h", byteLength: 3, text: false } });
	await settle();
	expect(file.state()).toMatchObject({
		status: "ready",
		content: { kind: "bytes", url: "/files/ws/file.bin", hash: "h", byteLength: 3 },
	});
	file.change();
	file.reads[1]?.resolve({ content: "", meta: { hash: null, byteLength: null, text: true } });
	await settle();
	expect(file.state()).toMatchObject({ status: "ready", content: { kind: "absent" } });
});

test("a host that predates resource metadata reads as provisional text, like a file tab", async () => {
	const file = harness();
	file.reads[0]?.resolve({ content: "legacy body" });
	await settle();
	expect(file.state()).toMatchObject({
		status: "ready",
		content: { kind: "text", text: "legacy body", hash: "" },
		meta: { hash: null, byteLength: null, text: true },
	});
	file.change();
	file.reads[1]?.resolve({ content: "legacy edit" });
	await settle();
	expect(text(file.state())).toBe("legacy edit");
});

test("stopping unsubscribes and ignores reads still in flight", async () => {
	const file = harness();
	file.stop();
	expect(file.unsubscribed()).toBe(true);
	file.reads[0]?.resolve({ content: "late", meta: meta("a") });
	await settle();
	expect(file.state()).toBeNull();
});
