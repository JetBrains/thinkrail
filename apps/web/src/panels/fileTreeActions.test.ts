import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { FS_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";

const requests: { method: string; params: unknown }[] = [];
let answer: () => Promise<unknown> = () => Promise.resolve({ ok: true });
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return answer();
		},
	}),
}));

const { useAppStore } = await import("../store");
const { RequestError } = await import("../transport");
const { clipboardAfterDelete, deleteEntry, pasteDestination, pasteInto, supportsFileMutations } =
	await import("./fileTreeActions");

function reset(): void {
	requests.length = 0;
	answer = () => Promise.resolve({ ok: true });
	useAppStore.setState({ fileClipboard: null, filesTreeByWorkspace: {}, toasts: [] });
}

beforeEach(reset);
afterAll(reset);

test("copy, paste and delete stay hidden until the host serves them", () => {
	expect(supportsFileMutations(null)).toBe(false);
	expect(supportsFileMutations(FS_MUTATIONS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsFileMutations(FS_MUTATIONS_PROTOCOL_VERSION)).toBe(true);
});

test("a paste on a file lands beside it, on a folder inside it", () => {
	expect(pasteDestination("README.md", "file")).toBe(".");
	expect(pasteDestination("src/app/main.ts", "file")).toBe("src/app");
	expect(pasteDestination("src/app", "dir")).toBe("src/app");
});

test("deleting the copied entry or one of its folders empties the clipboard", () => {
	const clipboard = { workspaceId: "w1", path: "src/app/main.ts" };
	expect(clipboardAfterDelete(clipboard, "w1", "src/app/main.ts")).toBeNull();
	expect(clipboardAfterDelete(clipboard, "w1", "src")).toBeNull();
	expect(clipboardAfterDelete(clipboard, "w1", "src/ap")).toBe(clipboard);
	expect(clipboardAfterDelete(clipboard, "w2", "src")).toBe(clipboard);
	expect(clipboardAfterDelete(null, "w1", "src")).toBeNull();
});

test("paste copies the clipboard entry across workspaces and expands the destination", async () => {
	await pasteInto("w2", "docs");
	expect(requests).toEqual([]);

	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "src/app" });
	answer = () => Promise.resolve({ path: "docs/app" });
	await pasteInto("w2", "docs");
	expect(requests).toEqual([
		{
			method: "fs.copy",
			params: {
				sourceWorkspaceId: "w1",
				sourcePath: "src/app",
				destinationWorkspaceId: "w2",
				destinationDirectory: "docs",
			},
		},
	]);
	expect(useAppStore.getState().filesTreeByWorkspace.w2?.expanded).toEqual(["docs"]);
	expect(useAppStore.getState().fileClipboard).toEqual({ workspaceId: "w1", path: "src/app" });
});

test("an oversized folder paste explains itself instead of echoing the host", async () => {
	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "node_modules" });
	answer = () => Promise.reject(new RequestError("COPY_TOO_LARGE", "more than 10000 entries"));
	await pasteInto("w1", ".");
	const [toast] = useAppStore.getState().toasts;
	expect(toast?.variant).toBe("error");
	expect(toast?.title).toBe("Couldn't paste");
	expect(toast?.message).toBe(
		"This folder has too many entries to copy here. Copy it from a terminal instead.",
	);
});

test("delete trashes through the host and forgets a clipboard entry inside it", async () => {
	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "src/app/main.ts" });
	answer = () => Promise.reject(new Error("trash unavailable"));
	await deleteEntry("w1", "src");
	expect(useAppStore.getState().fileClipboard).not.toBeNull();
	expect(useAppStore.getState().toasts[0]?.message).toBe("trash unavailable");

	answer = () => Promise.resolve({ ok: true });
	await deleteEntry("w1", "src");
	expect(requests.at(-1)).toEqual({
		method: "fs.delete",
		params: { workspaceId: "w1", path: "src" },
	});
	expect(useAppStore.getState().fileClipboard).toBeNull();
});
