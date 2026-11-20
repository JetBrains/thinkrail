import { describe, expect, mock, test } from "bun:test";
import { EXTENSION_QUERY_PROTOCOL_VERSION, type ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { PanelDeclaration, PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import type { RegisteredPanel } from "../extensions";
import {
	ExtensionPanelFrame,
	ExtensionPanelPlaceholder,
	type ExtensionPanelPlaceholderKind,
	extensionPanelState,
} from "./ExtensionPanelBody";
import type { ExtensionCatalogRead } from "./extensionPanelHost";

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
			renderChat: () => null,
			openFile: () => {},
			openWorkspace: () => {},
			peek: () => {},
			onEvent: () => () => {},
			openView: () => {},
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
