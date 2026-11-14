import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { TERMINAL_LINKS_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";

const requests: { method: string; params: unknown }[] = [];
let answer: (method: string) => Promise<unknown> = () => Promise.resolve({ targets: [] });
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return answer(method);
		},
	}),
}));

const { selectFilesTreeView, useAppStore } = await import("../store");
const { openTerminalLink, resolveTerminalPaths } = await import("./terminalLinkActions");

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "workspace-1",
	branch: "workspace-1",
	worktreePath: "/wt/w1",
	baseBranch: "main",
};

function reset(): void {
	requests.length = 0;
	answer = () => Promise.resolve({ targets: [] });
	useAppStore.setState({
		protocolVersion: TERMINAL_LINKS_PROTOCOL_VERSION,
		workspaces: { p1: [workspace] },
		removedWorkspaceIds: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutIntents: [],
		navTickByWorkspace: {},
		previewTabByWorkspace: {},
		filesTreeByWorkspace: {},
		filesRevealRequest: null,
		filesMode: "changed",
	});
}

beforeEach(reset);
afterAll(reset);

test("paths are asked of a host that serves terminal links, for a live terminal only", async () => {
	answer = () => Promise.resolve({ targets: [{ kind: "file", relPath: "src/a.ts" }] });
	expect(await resolveTerminalPaths("pty-1", ["a.ts"])).toEqual([
		{ kind: "file", relPath: "src/a.ts" },
	]);
	expect(requests).toEqual([
		{ method: "terminal.resolvePaths", params: { id: "pty-1", candidates: ["a.ts"] } },
	]);

	requests.length = 0;
	expect(await resolveTerminalPaths(null, ["a.ts"])).toEqual([]);
	useAppStore.setState({ protocolVersion: TERMINAL_LINKS_PROTOCOL_VERSION - 1 });
	expect(await resolveTerminalPaths("pty-1", ["a.ts"])).toEqual([]);
	useAppStore.setState({ protocolVersion: null });
	expect(await resolveTerminalPaths("pty-1", ["a.ts"])).toEqual([]);
	expect(requests).toEqual([]);
});

test("a file with a printed line opens kept at that line and column", async () => {
	answer = () =>
		Promise.resolve({ content: "x\n", meta: { hash: "h", byteLength: 2, text: true } });
	openTerminalLink("w1", { kind: "file", path: "src/a.ts", line: 3, column: 2 });
	await Bun.sleep(0);
	await Bun.sleep(0);
	const [tab] = useAppStore.getState().tabsByWorkspace.w1 ?? [];
	expect(requests.map((request) => request.method)).toEqual(["fs.readFile"]);
	expect(tab?.kind === "file" && tab.path).toBe("src/a.ts");
	expect(tab?.kind === "file" && tab.reveal).toMatchObject({ line: 3, column: 2 });
	expect(useAppStore.getState().layoutIntents.filter((intent) => intent.kind === "open")).toEqual([
		expect.objectContaining({ intent: "keep" }),
	]);
});

test("a file without a line opens kept with no reveal", async () => {
	answer = () =>
		Promise.resolve({ content: "x\n", meta: { hash: "h", byteLength: 2, text: true } });
	openTerminalLink("w1", { kind: "file", path: "README.md" });
	await Bun.sleep(0);
	const [tab] = useAppStore.getState().tabsByWorkspace.w1 ?? [];
	expect(tab?.kind === "file" && tab.path).toBe("README.md");
	expect(tab?.kind === "file" && tab.reveal).toBeUndefined();
});

test("a folder is revealed in Files", () => {
	openTerminalLink("w1", { kind: "dir", path: "assets" });
	const state = useAppStore.getState();
	expect(state.filesRevealRequest).toEqual({ workspaceId: "w1", path: "assets" });
	expect(state.filesMode).toBe("all");
	expect(selectFilesTreeView(state, "w1").expanded).toEqual(["assets"]);
	expect(requests).toEqual([]);
});

test("a URL opens in a new window without an opener", () => {
	const opened: unknown[][] = [];
	Object.assign(globalThis, { window: { open: (...args: unknown[]) => opened.push(args) } });
	try {
		openTerminalLink("w1", { kind: "url", url: "https://example.com/docs" });
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
	expect(opened).toEqual([["https://example.com/docs", "_blank", "noopener,noreferrer"]]);
});
