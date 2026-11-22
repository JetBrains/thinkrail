import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { EXTENSION_QUERY_PROTOCOL_VERSION, type ExtensionCatalogEntry } from "@thinkrail/contracts";
import type {
	PanelDeclaration,
	PanelHost,
	PanelProps,
	WebExtension,
} from "@thinkrail/extension-api/web";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { type ChatPaneSlot, ChatPaneSplit } from "../chat/ChatPaneSplit";
import type { RegisteredPanel } from "../extensions";
import { layoutResourceIdentity } from "../lib";
import { chatPaneViewKey, selectPanelViewState, useAppStore } from "../store";
import {
	chatPaneShown,
	ExtensionPanelFrame,
	type ExtensionPanelGate,
	ExtensionPanelPlaceholder,
	type ExtensionPanelPlaceholderKind,
	extensionPanelState,
	GatedExtensionPanel,
	useExtensionChatPane,
} from "./ExtensionPanelBody";
import {
	type ChatPaneHost,
	type ExtensionCatalogRead,
	readExtensionCatalog,
} from "./extensionPanelHost";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});

async function mount(node: ReactNode) {
	const noop = () => {};
	const container = {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
	const root = createRoot(container);
	await act(async () => root.render(node));
	return { unmount: () => act(async () => root.unmount()) };
}

function FakePanel({ host, params }: PanelProps) {
	return (
		<output data-workspace={host.scope.workspaceId} data-api={host.hostApiVersion}>
			{params.view}
		</output>
	);
}

const declaration: PanelDeclaration = {
	title: "common.retry",
	icon: () => null,
	scopes: ["project"],
	load: async () => ({ default: FakePanel }),
};
const panel: RegisteredPanel = { extension: "insights", panel: "sessions", declaration };
const entry: ExtensionCatalogEntry = {
	name: "insights",
	title: "Insights",
	enabled: true,
	tools: [],
	hasChildExtensions: false,
	apiVersion: 2,
};

function state(
	overrides: Partial<{
		panel: RegisteredPanel | undefined;
		protocolVersion: number | null;
		disabled: readonly string[];
		catalog: ExtensionCatalogRead;
	}> = {},
) {
	return extensionPanelState({
		panel,
		protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
		disabled: [],
		catalog: [entry],
		...overrides,
	});
}

describe("extension panel state", () => {
	test("a panel registered here, served by the host and switched on is ready with its catalog entry", () => {
		expect(state()).toEqual({ kind: "ready", panel, entry });
	});

	test("a panel this build lacks is missing whatever the host says", () => {
		expect(state({ panel: undefined, protocolVersion: null, catalog: "loading" }).kind).toBe(
			"missing",
		);
	});

	test("a host older than extension queries is unsupported; one not yet welcomed is loading", () => {
		expect(state({ protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION - 1 }).kind).toBe(
			"unsupported",
		);
		expect(state({ protocolVersion: null }).kind).toBe("loading");
	});

	test("a switched-off extension is disabled before its catalog is read", () => {
		expect(state({ disabled: ["insights"], catalog: "loading" }).kind).toBe("disabled");
		expect(state({ disabled: ["other"] }).kind).toBe("ready");
	});

	test("the catalog read decides loading, failure, and an extension the host lacks", () => {
		expect(state({ catalog: "loading" }).kind).toBe("loading");
		expect(state({ catalog: "failed" }).kind).toBe("failed");
		expect(state({ catalog: [{ ...entry, name: "other" }] }).kind).toBe("missing");
	});
});

describe("extension panel placeholders", () => {
	test.each<[ExtensionPanelPlaceholderKind, string]>([
		["unsupported", "This host doesn't serve extension panels yet"],
		["missing", "This panel isn't available in this version of ThinkRail."],
		["disabled", "This extension is turned off."],
		["failed", "Couldn't load the extensions from this host."],
	])("%s says why the panel is not shown", (kind, text) => {
		const html = renderToStaticMarkup(
			<ExtensionPanelPlaceholder kind={kind} onOpenSettings={() => {}} onRetry={() => {}} />,
		).replaceAll("&#x27;", "'");
		expect(html).toContain(`data-testid="extension-panel-${kind}"`);
		expect(html).toContain(text);
		expect(html.includes("Open Settings")).toBe(kind === "disabled");
		expect(html.includes("Retry")).toBe(kind === "failed");
	});
});

describe("loaded extension panel", () => {
	test("lazy-loads the declared component once and hands it the host and the tab's params", async () => {
		const load = mock(async () => ({ default: FakePanel }));
		const lazyDeclaration: PanelDeclaration = { ...declaration, load };
		const host: PanelHost = {
			query: async () => null,
			openChat: () => {},
			openPanel: () => {},
			renderToolCall: () => null,
			openFile: () => {},
			scope: { workspaceId: "w1", projectId: "p1" },
			hostProtocol: EXTENSION_QUERY_PROTOCOL_VERSION,
			hostApiVersion: 2,
		};
		const render = async () => {
			const stream = await renderToReadableStream(
				<ExtensionPanelFrame
					declaration={lazyDeclaration}
					host={host}
					params={{ view: "table" }}
					resetKeys={["w1", "tab"]}
				/>,
			);
			await stream.allReady;
			return new Response(stream).text();
		};

		const html = await render();
		await render();

		expect(html).toContain('data-testid="extension-panel"');
		expect(html).toContain('data-workspace="w1"');
		expect(html).toContain('data-api="2"');
		expect(html).toContain(">table</output>");
		expect(load).toHaveBeenCalledTimes(1);
	});
});

describe("the pane beside a chat", () => {
	const GENERATION = 901;
	let lastHost: PanelHost | null = null;
	function PanePanel({ host, params }: PanelProps) {
		lastHost = host;
		return (
			<output data-placement={host.placement} data-view={JSON.stringify(host.viewState ?? null)}>
				{params.sessionId}
			</output>
		);
	}
	const paneDeclaration: PanelDeclaration = {
		title: "common.retry",
		icon: () => null,
		scopes: ["session"],
		chatPane: true,
		chatAction: { menuLabel: "common.close", params: ({ sessionId }) => ({ sessionId }) },
		load: async () => ({ default: PanePanel }),
	};
	const besidePanel: RegisteredPanel = {
		extension: "insights",
		panel: "beside",
		declaration: paneDeclaration,
	};
	const extensions: readonly WebExtension[] = [
		{ name: "insights", panels: { beside: paneDeclaration } },
	];
	const paneKey = chatPaneViewKey("s1", "insights", "beside");
	const openPane = () =>
		useAppStore.getState().openChatPane("w1", "s1", {
			extension: "insights",
			panel: "beside",
			params: { sessionId: "s1" },
		});
	const gate = (overrides: Partial<ExtensionPanelGate> = {}): ExtensionPanelGate => ({
		state: { kind: "ready", panel: besidePanel, entry },
		projectId: "p1",
		protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
		retry: () => {},
		...overrides,
	});
	const paneHost: ChatPaneHost = {
		chat: { projectId: "p1", workspaceId: "w1", sessionId: "s1" },
		reveal: () => {},
		openAsTab: () => {},
		closePane: () => {},
	};

	async function html(node: ReactNode): Promise<string> {
		const stream = await renderToReadableStream(node);
		await stream.allReady;
		return new Response(stream).text();
	}

	const viewAttr = (value: unknown) =>
		`data-view="${JSON.stringify(value).replaceAll('"', "&quot;")}"`;

	beforeEach(async () => {
		lastHost = null;
		await readExtensionCatalog(GENERATION, async () => [entry]);
		useAppStore.setState({
			protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
			connectionGeneration: GENERATION,
			disabledExtensions: [],
			removedWorkspaceIds: {},
			workspaces: {
				p1: [
					{
						id: "w1",
						projectId: "p1",
						name: "w1",
						branch: "main",
						baseBranch: "main",
						worktreePath: "/tmp/w1",
					},
				],
			},
			chatPanesByWorkspace: {},
			panelViewStatesByWorkspace: {},
		});
	});

	test("shows only while its panel is openable; a transient state shows the tab's placeholder", () => {
		const shown = (overrides: Parameters<typeof state>[0]) => chatPaneShown(state(overrides));
		expect(shown({})).toBe(true);
		expect(shown({ catalog: "loading" })).toBe(true);
		expect(shown({ protocolVersion: null })).toBe(true);
		expect(shown({ catalog: "failed" })).toBe(true);
		expect(shown({ disabled: ["insights"] })).toBe(false);
		expect(shown({ protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION - 1 })).toBe(false);
		expect(shown({ panel: undefined })).toBe(false);
		expect(shown({ catalog: [{ ...entry, name: "other" }] })).toBe(false);
	});

	test("the chat gets its open pane while the panel is openable, and keeps it while switched off", async () => {
		const slots: (ChatPaneSlot | undefined)[] = [];
		function Probe() {
			slots.push(useExtensionChatPane("w1", "s1", extensions));
			return null;
		}
		const view = await mount(<Probe />);
		const latest = () => slots.at(-1);
		expect(latest()).toBeUndefined();

		await act(async () => openPane());
		expect(latest()).toMatchObject({ id: "insights.beside", label: "Retry", width: null });

		await act(async () => latest()?.onWidthChange(42));
		expect(latest()?.width).toBe(42);

		await act(async () => useAppStore.setState({ disabledExtensions: ["insights"] }));
		expect(latest()).toBeUndefined();
		expect(useAppStore.getState().chatPanesByWorkspace.w1?.s1?.open).toBe(true);

		await act(async () => useAppStore.setState({ disabledExtensions: [], protocolVersion: null }));
		expect(latest()?.id).toBe("insights.beside");

		await act(async () => latest()?.onClose());
		expect(latest()).toBeUndefined();
		expect(useAppStore.getState().chatPanesByWorkspace.w1?.s1).toMatchObject({
			open: false,
			width: 42,
		});
		await view.unmount();
	});

	test("the split puts the pane beside the chat behind a divider, and nothing without one", async () => {
		const slot: ChatPaneSlot = {
			id: "insights.beside",
			label: "Session analysis",
			width: null,
			content: <p>pane body</p>,
			onWidthChange: () => {},
			onClose: () => {},
		};
		const chat = <div data-testid="chat-view" />;
		const open = await html(<ChatPaneSplit pane={slot}>{chat}</ChatPaneSplit>);
		expect(open).toMatch(/data-testid="chat-view".*data-testid="chat-pane-resize".*pane body/);
		expect(open).toContain('aria-label="Session analysis"');
		expect(open).toContain('aria-label="Resize the panel beside the chat"');
		const shut = await html(<ChatPaneSplit pane={undefined}>{chat}</ChatPaneSplit>);
		expect(shut).toContain('data-testid="chat-view"');
		expect(shut).not.toContain("chat-pane");
	});

	test("the pane body renders the panel with the pane's host, or the tab's placeholders", async () => {
		useAppStore.getState().savePanelViewState("w1", paneKey, { section: "trace" });
		const body = (bodyGate: ExtensionPanelGate) => (
			<GatedExtensionPanel
				workspaceId="w1"
				gate={bodyGate}
				params={{ sessionId: "s1" }}
				viewKey={paneKey}
				pane={paneHost}
				resetKeys={["w1", "s1"]}
			/>
		);

		const ready = await html(body(gate()));
		expect(ready).toContain('data-placement="chatPane"');
		expect(ready).toContain(viewAttr({ section: "trace" }));
		expect(ready).toContain(">s1</output>");
		expect(lastHost?.openAsTab).toBeFunction();
		expect(lastHost?.closePane).toBeFunction();

		expect(await html(body(gate({ state: { kind: "loading" } })))).toContain(
			'data-testid="extension-panel-loading"',
		);
		expect(await html(body(gate({ state: { kind: "failed" } })))).toContain(
			'data-testid="extension-panel-failed"',
		);
	});

	test("a tab's panel finds the view state it saved when it mounts again", async () => {
		const tabKey = layoutResourceIdentity({
			kind: "extension",
			extension: "insights",
			panel: "beside",
			params: { sessionId: "s1" },
		});
		const body = (
			<GatedExtensionPanel
				workspaceId="w1"
				gate={gate()}
				params={{ sessionId: "s1" }}
				viewKey={tabKey}
				resetKeys={["w1", "tab"]}
			/>
		);
		expect(await html(body)).toContain('data-placement="tab"');
		expect(lastHost?.viewState).toBeUndefined();
		expect(lastHost?.showInChat).toBeUndefined();
		lastHost?.saveViewState?.({ section: "files", scroll: 120 });

		expect(await html(body)).toContain(viewAttr({ section: "files", scroll: 120 }));
		expect(selectPanelViewState(useAppStore.getState(), "w1", tabKey)).toEqual({
			section: "files",
			scroll: 120,
		});
	});
});
