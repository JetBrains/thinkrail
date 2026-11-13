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
const {
	clipboardAfterDelete,
	deleteEntry,
	pasteDestination,
	pasteInto,
	renameEntry,
	supportsFileMutations,
} = await import("./fileTreeActions");

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

test("an entry that changed under a paste or a delete explains itself", async () => {
	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "src/app" });
	answer = () => Promise.reject(new RequestError("ENTRY_CHANGED", "src/app changed"));
	await pasteInto("w1", ".");
	await deleteEntry("w1", "src/main.ts");
	expect(useAppStore.getState().toasts.map(({ title, message }) => ({ title, message }))).toEqual([
		{
			title: "Couldn't paste",
			message:
				"Files changed while they were being copied, so the paste stopped. Anything already copied was kept.",
		},
		{
			title: "Couldn't delete",
			message: "main.ts changed while it was being deleted, so it was left in place.",
		},
	]);
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

test("a cut pastes as a move, once, and a taken name says so", async () => {
	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "notes.md", cut: true });
	answer = () => Promise.reject(new RequestError("ENTRY_EXISTS", "taken"));
	await pasteInto("w1", ".thinkrail/context");
	expect(useAppStore.getState().toasts[0]?.message).toBe("notes.md already exists in this folder.");
	expect(useAppStore.getState().fileClipboard).not.toBeNull();
	answer = () => Promise.resolve({ path: ".thinkrail/context/notes.md" });
	await pasteInto("w1", ".thinkrail/context");
	expect(requests.at(-1)).toEqual({
		method: "fs.move",
		params: {
			sourceWorkspaceId: "w1",
			sourcePath: "notes.md",
			destinationWorkspaceId: "w1",
			destinationDirectory: ".thinkrail/context",
		},
	});
	expect(useAppStore.getState().fileClipboard).toBeNull();
});

test("renaming the copied entry empties the clipboard", async () => {
	useAppStore.getState().setFileClipboard({ workspaceId: "w1", path: "a.md" });
	answer = () => Promise.resolve({ path: "b.md" });
	await renameEntry("w1", "a.md", "b.md");
	expect(requests).toEqual([
		{ method: "fs.rename", params: { workspaceId: "w1", path: "a.md", name: "b.md" } },
	]);
	expect(useAppStore.getState().fileClipboard).toBeNull();
});
