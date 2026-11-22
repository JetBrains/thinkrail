import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	EXTENSION_QUERY_PROTOCOL_VERSION,
	type ExtensionCatalogEntry,
	type ExtensionQueryParams,
} from "@thinkrail/contracts";
import type { PanelDeclaration, PanelToolCall } from "@thinkrail/extension-api/web";
import type { RegisteredPanel } from "../extensions";
import { layoutResourceIdentity } from "../lib";
import { type ChatLocationRequest, useAppStore } from "../store";
import { RequestError, wsErrorCode } from "../transport";
import {
	cachedExtensionCatalog,
	createPanelHost,
	openableExtensionPanels,
	openExtensionPanel,
	type PanelHostDeps,
	readExtensionCatalog,
} from "./extensionPanelHost";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function hostDeps(overrides: Partial<PanelHostDeps> = {}): PanelHostDeps {
	return {
		extension: "insights",
		request: async () => "answer",
		navigate: () => {},
		locate: () => {},
		openPanel: () => {},
		renderToolCall: () => null,
		openFile: () => {},
		openArtifacts: () => {},
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: EXTENSION_QUERY_PROTOCOL_VERSION,
		hostApiVersion: 3,
		...overrides,
	};
}

describe("PanelHost", () => {
	test("queries only its own extension and hands the host's answer through", async () => {
		const request = mock(async (_params: ExtensionQueryParams) => ({ rows: [] }));
		const host = createPanelHost(hostDeps({ request }));

		expect(await host.query("sessions.list", { scope: { kind: "all" } })).toEqual({ rows: [] });
		await host.query("ping");

		expect(request.mock.calls).toEqual([
			[{ extension: "insights", method: "sessions.list", params: { scope: { kind: "all" } } }],
			[{ extension: "insights", method: "ping" }],
		]);
		expect(host.scope).toEqual({ workspaceId: "w1", projectId: "p1" });
		expect(host.hostProtocol).toBe(EXTENSION_QUERY_PROTOCOL_VERSION);
		expect(host.hostApiVersion).toBe(3);
	});

	test("rejects with the host's coded error unchanged", async () => {
		const refusal = new RequestError("EXTENSION_DISABLED", "off");
		const host = createPanelHost(hostDeps({ request: () => Promise.reject(refusal) }));

		const error = await host.query("sessions.list").catch((caught: unknown) => caught);

		expect(error).toBe(refusal);
		expect(wsErrorCode(error)).toBe("EXTENSION_DISABLED");
	});

	test.each([
		["an older host", EXTENSION_QUERY_PROTOCOL_VERSION - 1],
		["a host that has not welcomed yet", null],
	])("never sends to %s and rejects as an unknown query", async (_label, hostProtocol) => {
		const request = mock(async () => "answer");
		const host = createPanelHost(hostDeps({ request, hostProtocol }));

		const error = await host.query("sessions.list").catch((caught: unknown) => caught);

		expect(wsErrorCode(error)).toBe("UNKNOWN_EXTENSION_QUERY");
		expect(request).not.toHaveBeenCalled();
	});

	test("an aborted signal rejects locally; the request it already sent is left to finish", async () => {
		const reply = deferred<unknown>();
		const request = mock(() => reply.promise);
		const host = createPanelHost(hostDeps({ request }));
		const controller = new AbortController();

		const pending = host.query("sessions.list", undefined, controller.signal);
		controller.abort();
		const error = await pending.catch((caught: unknown) => caught);
		reply.resolve("late");

		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("AbortError");
		expect(request).toHaveBeenCalledTimes(1);

		const already = new AbortController();
		already.abort();
		const refused = await host
			.query("sessions.list", undefined, already.signal)
			.catch((caught: unknown) => caught);
		expect((refused as DOMException).name).toBe("AbortError");
		expect(request).toHaveBeenCalledTimes(1);
	});

	test("a signal that never aborts still resolves and rejects with the host", async () => {
		const host = createPanelHost(
			hostDeps({
				request: mock(async (params: ExtensionQueryParams) => {
					if (params.method === "fail") throw new RequestError("UNKNOWN_EXTENSION_QUERY", "no");
					return "ok";
				}),
			}),
		);
		const signal = new AbortController().signal;

		expect(await host.query("ok", undefined, signal)).toBe("ok");
		expect(
			wsErrorCode(await host.query("fail", undefined, signal).catch((caught: unknown) => caught)),
		).toBe("UNKNOWN_EXTENSION_QUERY");
	});

	test("openChat enters the target workspace with the chat as its route target", () => {
		const navigate = mock(
			(_workspace: { id: string; projectId: string }, _sessionId: string) => {},
		);
		const host = createPanelHost(hostDeps({ navigate }));

		host.openChat({ projectId: "p2", workspaceId: "w2", sessionId: "s1" });

		expect(navigate.mock.calls).toEqual([[{ id: "w2", projectId: "p2" }, "s1"]]);
	});

	test("openChat with an anchor asks for the chat location instead, tool call and fallback included", () => {
		const navigate = mock(() => {});
		const locate = mock((_location: ChatLocationRequest) => {});
		const host = createPanelHost(hostDeps({ navigate, locate }));

		host.openChat({
			projectId: "p2",
			workspaceId: "w2",
			sessionId: "s1",
			at: { messageIndex: 4, anchorText: "Running it.", toolCallId: "call-1" },
		});
		host.openChat({
			projectId: "p2",
			workspaceId: "w2",
			sessionId: "s1",
			at: { messageIndex: 2, anchorText: "", approximate: true },
		});

		expect(navigate).not.toHaveBeenCalled();
		expect(locate.mock.calls).toEqual([
			[
				{
					workspaceId: "w2",
					projectId: "p2",
					sessionId: "s1",
					messageIndex: 4,
					anchorText: "Running it.",
					toolCallId: "call-1",
				},
			],
			[
				{
					workspaceId: "w2",
					projectId: "p2",
					sessionId: "s1",
					messageIndex: 2,
					anchorText: "",
					approximate: true,
				},
			],
		]);
	});

	test("openPanel and renderToolCall delegate to the shell", () => {
		const openPanel = mock(
			(_panel: string, _params: Readonly<Record<string, string>>, _title: string | undefined) => {},
		);
		const renderToolCall = mock((_call: PanelToolCall) => "rendered");
		const host = createPanelHost(hostDeps({ openPanel, renderToolCall }));

		host.openPanel("session", { sessionId: "s1" }, "Fix the login flow");
		host.openPanel("other");
		const call = {
			toolCallId: "c1",
			toolName: "bash",
			args: { command: "ls" },
			result: { content: [] },
			status: "done",
		} satisfies PanelToolCall;

		expect(host.renderToolCall(call)).toBe("rendered");
		expect(renderToolCall.mock.calls).toEqual([[call]]);
		expect(openPanel.mock.calls).toEqual([
			["session", { sessionId: "s1" }, "Fix the login flow"],
			["other", {}, undefined],
		]);
	});

	test("openFile hands the workspace, the workspace-relative path and the line to the shell", () => {
		const openFile = mock((_workspace: string, _path: string, _line: number | undefined) => {});
		const host = createPanelHost(hostDeps({ openFile }));

		host.openFile("w2", "src/a.ts", 12);
		host.openFile("w1", "README.md");

		expect(openFile.mock.calls).toEqual([
			["w2", "src/a.ts", 12],
			["w1", "README.md", undefined],
		]);
	});

	test("openArtifacts asks the shell to reveal the workspace's Artifacts tool", () => {
		const openArtifacts = mock(() => {});
		const host = createPanelHost(hostDeps({ openArtifacts }));

		host.openArtifacts?.();

		expect(openArtifacts).toHaveBeenCalledTimes(1);
	});
});

describe("extension catalog read", () => {
	const entry: ExtensionCatalogEntry = {
		name: "insights",
		title: "Insights",
		enabled: true,
		tools: [],
		hasChildExtensions: false,
		apiVersion: 1,
	};

	test("is read once per connection generation and cached once it arrives", async () => {
		const list = mock(async () => [entry]);

		const first = readExtensionCatalog(101, list);
		expect(readExtensionCatalog(101, list)).toBe(first);
		expect(cachedExtensionCatalog(101)).toBeUndefined();
		expect(await first).toEqual([entry]);
		expect(cachedExtensionCatalog(101)).toEqual([entry]);
		expect(list).toHaveBeenCalledTimes(1);

		await readExtensionCatalog(102, list);
		expect(list).toHaveBeenCalledTimes(2);
		expect(cachedExtensionCatalog(101)).toBeUndefined();
	});

	test("a failed read is forgotten so a retry asks the host again", async () => {
		const list = mock(async (): Promise<readonly ExtensionCatalogEntry[]> => {
			if (list.mock.calls.length === 1) throw new Error("offline");
			return [entry];
		});

		await expect(readExtensionCatalog(201, list)).rejects.toThrow("offline");
		expect(await readExtensionCatalog(201, list)).toEqual([entry]);
		expect(list).toHaveBeenCalledTimes(2);
	});
});

describe("openableExtensionPanels", () => {
	const declaration: PanelDeclaration = {
		title: "settings.nav.extensions",
		icon: () => null,
		scopes: ["project"],
		load: async () => ({ default: () => null }),
	};
	const insights: RegisteredPanel = { extension: "insights", panel: "sessions", declaration };
	const other: RegisteredPanel = { extension: "other", panel: "list", declaration };
	const entry = (name: string): ExtensionCatalogEntry => ({
		name,
		title: name,
		enabled: true,
		tools: [],
		hasChildExtensions: false,
	});
	const openable = (input: Partial<Parameters<typeof openableExtensionPanels>[0]>) =>
		openableExtensionPanels({
			disabled: [],
			protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
			catalog: "loading",
			panels: [insights, other],
			...input,
		}).map(({ extension }) => extension);

	test("offers every declared panel on a host that answers queries until its catalog says otherwise", () => {
		expect(openable({})).toEqual(["insights", "other"]);
		expect(openable({ catalog: "failed" })).toEqual(["insights", "other"]);
		expect(openable({ catalog: [entry("insights")] })).toEqual(["insights"]);
	});

	test("hides a switched-off extension's panels, and every panel from a host too old to answer", () => {
		expect(openable({ disabled: ["insights"] })).toEqual(["other"]);
		expect(openable({ disabled: ["insights"], catalog: [entry("insights")] })).toEqual([]);
		expect(openable({ protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION - 1 })).toEqual([]);
		expect(openable({ protocolVersion: null })).toEqual([]);
	});

	test("reads the shipped registry by default", () => {
		const shipped = openableExtensionPanels({
			disabled: [],
			protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
			catalog: "loading",
		});
		expect(shipped.map(({ extension, panel }) => `${extension}.${panel}`)).toContain(
			"session-insights.sessions",
		);
		expect(
			openableExtensionPanels({
				disabled: ["session-insights"],
				protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
				catalog: "loading",
			}).some(({ extension }) => extension === "session-insights"),
		).toBe(false);
	});
});

describe("openExtensionPanel", () => {
	const declaration: PanelDeclaration = {
		title: "common.retry",
		icon: () => null,
		scopes: ["project"],
		load: async () => ({ default: () => null }),
	};
	const panel: RegisteredPanel = { extension: "insights", panel: "sessions", declaration };

	beforeEach(() => {
		useAppStore.setState({
			activeWorkspaceId: "w1",
			tabsByWorkspace: {},
			activeTabByWorkspace: {},
			layoutIntents: [],
			removedWorkspaceIds: {},
		});
	});

	test("opens one keep tab per extension, panel and params in that workspace's view", () => {
		openExtensionPanel("w1", panel, { b: "2", a: "1" });
		openExtensionPanel("w1", panel, { a: "1", b: "2" });
		openExtensionPanel("w1", panel);

		const tabs = useAppStore.getState().tabsByWorkspace.w1 ?? [];
		expect(tabs).toHaveLength(2);
		expect(tabs[0]).toMatchObject({
			kind: "extension",
			workspaceId: "w1",
			name: "",
			extension: "insights",
			panel: "sessions",
			titleKey: "common.retry",
			params: { a: "1", b: "2" },
		});
		expect(tabs[1]).toMatchObject({ kind: "extension", params: {} });
		expect(tabs[0]?.id).not.toBe(tabs[1]?.id);
		const first = tabs[0];
		if (first?.kind !== "extension") throw new Error("expected an extension tab");
		expect(layoutResourceIdentity(first)).toBe(
			layoutResourceIdentity({ ...first, params: { b: "2", a: "1" } }),
		);
		expect(useAppStore.getState().layoutIntents.map((intent) => intent.kind)).toEqual([
			"open",
			"open",
			"open",
		]);
	});

	test("a wide panel hides the panes after every open of its tab, focusing an existing one included", () => {
		const wide: RegisteredPanel = {
			extension: "insights",
			panel: "compare",
			declaration: { ...declaration, wide: true },
		};
		openExtensionPanel("w1", panel);
		openExtensionPanel("w1", wide, { a: "1" }, "Compare");
		openExtensionPanel("w1", wide, { a: "1" }, "Compare");

		expect(useAppStore.getState().tabsByWorkspace.w1).toHaveLength(2);
		expect(
			useAppStore.getState().layoutIntents.map(({ kind, workspaceId }) => `${kind}:${workspaceId}`),
		).toEqual(["open:w1", "open:w1", "hide-all-panels:w1", "open:w1", "hide-all-panels:w1"]);
	});

	test("names the tab with the title it is opened with, keeping one tab per params", () => {
		openExtensionPanel("w1", panel, { sessionId: "s1" }, "Fix the login flow");
		openExtensionPanel("w1", panel, { sessionId: "s1" }, "Fix the login flow");

		const tabs = useAppStore.getState().tabsByWorkspace.w1 ?? [];
		expect(tabs).toHaveLength(1);
		expect(tabs[0]).toMatchObject({ name: "Fix the login flow", params: { sessionId: "s1" } });
	});
});
