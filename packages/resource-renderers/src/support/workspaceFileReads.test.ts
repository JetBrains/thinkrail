import { expect, test } from "bun:test";
import type { ResourceMeta } from "@thinkrail/contracts";
import {
	type FileState,
	type LoadedFile,
	startWorkspaceFileReads,
	updateFileState,
} from "./workspaceFileReads";

interface PendingRead {
	resolve: (value: { content: string; meta?: ResourceMeta }) => void;
	reject: (error: unknown) => void;
}

const meta = (hash: string): ResourceMeta => ({ hash, byteLength: hash.length, text: true });

function harness() {
	const reads: PendingRead[] = [];
	let changed: (() => void) | null = null;
	let unsubscribed = false;
	let state: FileState | null = null;
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
			state = updateFileState(state, "ws\u0000file", next);
		},
	});
	return {
		reads,
		change: () => changed?.(),
		state: () => state?.loaded ?? null,
		fileState: () => state,
		stop,
		unsubscribed: () => unsubscribed,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function staleOf(file: LoadedFile | null): string | undefined {
	return file?.status === "ready" ? file.stale : undefined;
}

function text(file: LoadedFile | null): string | null {
	return file?.status === "ready" && file.content.kind === "text" ? file.content.text : null;
}

test("change events during a read fold into one follow-up read, never a pile of reads", async () => {
	const file = harness();
	for (let i = 0; i < 20; i += 1) file.change();
	expect(file.reads.length).toBe(1);
	file.reads[0]?.resolve({ content: "first", meta: meta("a") });
	await settle();
	expect(text(file.state())).toBe("first");
	expect(file.reads.length).toBe(2);
	file.reads[1]?.resolve({ content: "latest", meta: meta("c") });
	await settle();
	expect(text(file.state())).toBe("latest");
	expect(file.reads.length).toBe(2);
});

test("a failed read still sends the folded follow-up; stopping drops it", async () => {
	const file = harness();
	file.change();
	file.reads[0]?.reject(new Error("offline"));
	await settle();
	expect(file.reads.length).toBe(2);
	file.change();
	file.stop();
	file.reads[1]?.resolve({ content: "late", meta: meta("a") });
	await settle();
	expect(file.reads.length).toBe(2);
	expect(file.state()).toEqual({ status: "error", message: "offline" });
});

test("a re-read with the same hash keeps the loaded object and the preview state holding it", async () => {
	const file = harness();
	file.reads[0]?.resolve({ content: "same", meta: meta("a") });
	await settle();
	const first = file.state();
	const firstState = file.fileState();
	file.change();
	file.reads[1]?.resolve({ content: "same", meta: meta("a") });
	await settle();
	expect(file.state()).toBe(first);
	expect(file.fileState()).toBe(firstState);
	file.change();
	file.reads[2]?.resolve({ content: "edited", meta: meta("b") });
	await settle();
	expect(file.fileState()).not.toBe(firstState);
});

test("preview state for another file never reuses the previous file's load", () => {
	const loaded: LoadedFile = { status: "error", message: "gone" };
	const current: FileState = { file: "ws\u0000old", loaded };
	const seen: (LoadedFile | null)[] = [];
	const next = updateFileState(current, "ws\u0000new", (previous) => {
		seen.push(previous);
		return loaded;
	});
	expect(seen).toEqual([null]);
	expect(next).toEqual({ file: "ws\u0000new", loaded });
	expect(next).not.toBe(current);
});

test("a failed re-read keeps the last good content marked stale; a failed first read shows the error", async () => {
	const file = harness();
	file.reads[0]?.reject(new Error("offline"));
	await settle();
	expect(file.state()).toEqual({ status: "error", message: "offline" });
	file.change();
	file.reads[1]?.resolve({ content: "back", meta: meta("a") });
	await settle();
	expect(staleOf(file.state())).toBeUndefined();
	file.change();
	file.reads[2]?.reject(new Error("no such file"));
	await settle();
	expect(text(file.state())).toBe("back");
	expect(staleOf(file.state())).toBe("no such file");
	file.change();
	file.reads[3]?.resolve({ content: "back", meta: meta("a") });
	await settle();
	expect(staleOf(file.state())).toBeUndefined();
});

test("a re-read failing the same way keeps the preview state", async () => {
	const file = harness();
	file.reads[0]?.reject(new Error("offline"));
	await settle();
	const failed = file.fileState();
	file.change();
	file.reads[1]?.reject(new Error("offline"));
	await settle();
	expect(file.fileState()).toBe(failed);
	file.change();
	file.reads[2]?.resolve({ content: "back", meta: meta("a") });
	await settle();
	file.change();
	file.reads[3]?.reject(new Error("gone"));
	await settle();
	const stale = file.fileState();
	file.change();
	file.reads[4]?.reject(new Error("gone"));
	await settle();
	expect(file.fileState()).toBe(stale);
	file.change();
	file.reads[5]?.reject(new Error("moved"));
	await settle();
	expect(staleOf(file.state())).toBe("moved");
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
