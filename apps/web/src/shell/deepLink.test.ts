import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import {
	type NativeDeepLinkBridge,
	type NativeOpenFileRequest,
	PROTOCOL_VERSION,
	type Project,
	type Workspace,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";

const project: Project = { id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 0 };
const defaultRow: Workspace = {
	id: "w-default",
	projectId: "p1",
	name: "Default",
	kind: "default",
	branch: "main",
	baseBranch: "main",
	worktreePath: "/repo",
};
const reads: string[] = [];
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: { path?: string }) => {
			if (method === "workspace.resolvePath" && params.path) {
				const relativePath = params.path.startsWith("/repo/") ? params.path.slice(6) : "";
				return Promise.resolve(
					relativePath ? { workspaceId: "w-default", projectId: "p1", relativePath } : null,
				);
			}
			if (method === "workspace.list") return Promise.resolve([defaultRow]);
			if (method === "fs.readFile" && params.path) {
				reads.push(params.path);
				return params.path.startsWith("missing")
					? Promise.reject(new Error("ENOENT"))
					: Promise.resolve({ content: "x\n", meta: { hash: "h", byteLength: 2, text: true } });
			}
			return new Promise(() => {});
		},
	}),
}));

const { useAppStore } = await import("../store");
const { getNativeDeepLinkBridge, installDeepLinks, openDeepLink } = await import("./deepLink");
const initial = useAppStore.getInitialState();
const entered: string[] = [];
const navigate = async (workspace: Pick<Workspace, "id">) => {
	entered.push(workspace.id);
	useAppStore.getState().activateWorkspaceFromRoute(defaultRow);
	return true;
};
const toasts = () => useAppStore.getState().toasts.map((toast) => toast.message);
const fileTab = (path: string) =>
	(useAppStore.getState().tabsByWorkspace["w-default"] ?? []).find(
		(tab) => tab.kind === "file" && tab.path === path,
	);

beforeEach(() => {
	reads.length = 0;
	entered.length = 0;
	useAppStore.setState(initial, true);
	useAppStore.setState({
		projects: [project],
		protocolVersion: PROTOCOL_VERSION,
		welcomeGeneration: 1,
	});
});
afterAll(() => useAppStore.setState(initial, true));

test("opens the file in its workspace at the line, under the workspace-relative identity", async () => {
	await openDeepLink({ file: "/repo/src/a.ts", line: 40, column: 3 }, navigate);
	expect(entered).toEqual(["w-default"]);
	expect(reads).toEqual(["src/a.ts"]);
	const tab = fileTab("src/a.ts");
	expect(tab?.kind === "file" ? tab.reveal : null).toMatchObject({ line: 40, column: 3 });
	expect(toasts()).toEqual([]);
});

test("a path outside every open project enters nothing and says why", async () => {
	await openDeepLink({ file: "/elsewhere/a.ts", line: 1 }, navigate);
	await openDeepLink({ file: "/repo", line: 1 }, navigate);
	expect(entered).toEqual([]);
	expect(reads).toEqual([]);
	expect(toasts()).toEqual([
		t("shell.deepLink.notInProject", { path: "/elsewhere/a.ts" }),
		t("shell.deepLink.notInProject", { path: "/repo" }),
	]);
});

test("a file the host cannot read reports the failed open", async () => {
	await openDeepLink({ file: "/repo/missing.ts", line: 1 }, navigate);
	expect(reads).toEqual(["missing.ts"]);
	expect(fileTab("missing.ts")).toBeUndefined();
	expect(toasts()).toEqual([t("shell.deepLink.openFailed", { path: "/repo/missing.ts" })]);
});

test("a refused workspace entry opens no file", async () => {
	await openDeepLink({ file: "/repo/src/a.ts", line: 1 }, async () => false);
	expect(reads).toEqual([]);
});

test("waits for the first welcome and clamps an out-of-range position to the first line", async () => {
	useAppStore.setState({ welcomeGeneration: 0 });
	const opening = openDeepLink({ file: "/repo/src/b.ts", line: 0, column: -2 }, navigate);
	await Promise.resolve();
	expect(entered).toEqual([]);
	useAppStore.setState({ welcomeGeneration: 1 });
	await opening;
	const tab = fileTab("src/b.ts");
	expect(tab?.kind === "file" ? tab.reveal : null).toMatchObject({ line: 1 });
	expect(tab?.kind === "file" ? tab.reveal?.column : null).toBeUndefined();
});

test("installs only over a bridge with subscribe() and opens requests in arrival order", async () => {
	expect(getNativeDeepLinkBridge(undefined)).toBeNull();
	expect(getNativeDeepLinkBridge({})).toBeNull();
	let deliver: (request: NativeOpenFileRequest) => void = () => {};
	const bridge: NativeDeepLinkBridge = {
		subscribe: (listener) => {
			deliver = listener;
			return () => {};
		},
	};
	expect(getNativeDeepLinkBridge(bridge)).toBe(bridge);
	installDeepLinks(bridge);
	deliver({ file: "/repo/first.ts", line: 1 });
	deliver({ file: "/repo/second.ts", line: 2 });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(reads).toEqual(["first.ts", "second.ts"]);
});
