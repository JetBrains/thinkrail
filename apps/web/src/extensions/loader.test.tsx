import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { ToolRenderer, ToolRenderProps } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	ResourceEnvironmentProvider,
	type ResourceHost,
	ResourceHostProvider,
	ResourcePreferencesProvider,
	ResourceScopeProvider,
} from "@thinkrail/resource-renderers";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { forwardRef, memo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "../chat/ChatActions";
import { InteractionStatesContext } from "../chat/interactionState";
import { ToolRendererBody } from "../chat/ToolRendererBody";
import {
	currentToolRegistry,
	DefaultToolRenderer,
	getToolRenderer,
	getToolSummary,
	isInteractiveTool,
	resolveProminence,
} from "../chat/toolRegistry";
import { followInstalledWebExtensions } from "./follow";
import { installExtensionHost } from "./index";
import {
	browserLoaderEnvironment,
	type LoaderEnvironment,
	loadWebExtensions,
	setLoaderEnvironment,
	unloadWebExtension,
	type WebExtensionLoadFailure,
	webExtensionLoads,
} from "./loader";

const FIXTURES = new URL("./fixtures/", import.meta.url).href;

interface FakeLink {
	url: string;
	removed: boolean;
}

function fakeEnvironment(
	overrides: { importModule?: (url: string) => Promise<unknown>; failStyles?: boolean } = {},
) {
	const links: FakeLink[] = [];
	const reports: Array<{ type: string; reason: WebExtensionLoadFailure }> = [];
	const environment: LoaderEnvironment = {
		baseUrl: () => FIXTURES,
		importModule: overrides.importModule ?? ((url) => import(url)),
		linkStylesheet: (url) => {
			const link = { url, removed: false };
			links.push(link);
			return {
				ready: overrides.failStyles ? Promise.reject(new Error("css 404")) : Promise.resolve(),
				remove: () => {
					link.removed = true;
				},
			};
		},
		report: (error, reason) =>
			reports.push({ type: error instanceof Error ? error.name : typeof error, reason }),
	};
	setLoaderEnvironment(environment);
	return { links, reports };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeAll(() => {
	installExtensionHost();
});

afterEach(() => {
	for (const name of webExtensionLoads().keys()) unloadWebExtension(name);
	setLoaderEnvironment(browserLoaderEnvironment);
});

describe("web extension loader", () => {
	test("loads a bundle that reads the host object, links its stylesheet and registers its renderers", async () => {
		const { links } = fakeEnvironment();
		const [result] = await loadWebExtensions([
			{ name: "thinkrail-ext-weather", url: "weather-v1.js", styles: "weather.css" },
		]);
		expect(result).toEqual({
			name: "thinkrail-ext-weather",
			status: "loaded",
			tools: ["weather", "forecast"],
		});
		expect(links).toEqual([{ url: `${FIXTURES}weather.css`, removed: false }]);
		expect(getToolRenderer("weather")).not.toBe(DefaultToolRenderer);
		expect(resolveProminence("weather").prominence).toBe("primary");
		expect(isInteractiveTool("weather")).toBe(true);
		expect(webExtensionLoads().get("thinkrail-ext-weather")?.status).toBe("loaded");
	});

	test("each failure stays with its extension and reports only a classifier", async () => {
		const { reports } = fakeEnvironment();
		const results = await loadWebExtensions([
			{ name: "ok", url: "sibling.js" },
			{ name: "missing", url: "does-not-exist.js" },
			{ name: "bad-export", url: "not-an-extension.js" },
			{ name: "throws", url: "throws.js" },
		]);
		expect(results.map((result) => [result.name, result.status])).toEqual([
			["ok", "loaded"],
			["missing", "failed"],
			["bad-export", "failed"],
			["throws", "failed"],
		]);
		const reasons = results.map((result) => (result.status === "failed" ? result.reason : null));
		expect(reasons).toEqual([null, "import", "export", "import"]);
		const thrown = results[3];
		expect(thrown?.status === "failed" && thrown.message).toContain("top-level failure");
		expect(reports.map((report) => report.reason).sort()).toEqual(["export", "import", "import"]);
		expect(JSON.stringify(reports)).not.toContain("private detail");
		expect(getToolRenderer("sibling_tool")).not.toBe(DefaultToolRenderer);
		expect(getToolRenderer("tool")).toBe(DefaultToolRenderer);
	});

	test("accepts every renderer React renders: a function, memo, forwardRef and lazy", async () => {
		fakeEnvironment();
		const [result] = await loadWebExtensions([{ name: "exotic", url: "exotic-cards.js" }]);
		expect(result).toEqual({
			name: "exotic",
			status: "loaded",
			tools: ["memo_tool", "forward_ref_tool", "lazy_tool"],
		});
		const typed: ToolRenderer = memo(forwardRef<HTMLElement, ToolRenderProps>(() => null));
		expect(typed).toBeDefined();
		for (const tool of ["memo_tool", "forward_ref_tool"]) {
			const markup = renderToStaticMarkup(
				<ToolRendererBody
					toolCallId="call-1"
					toolName={tool}
					args={{ kind: tool }}
					result={null}
					status="done"
					streaming={false}
					imageLabel=""
				/>,
			);
			expect(markup).toContain(`data-exotic-card="${tool}"`);
			expect(markup).not.toContain("tool-renderer-fallback");
		}
	});

	test.each([
		["a number", 42],
		["null", null],
		["a plain object", { render: () => null }],
		["an array", [() => null]],
		["a React element", { $$typeof: Symbol.for("react.element") }],
	])("rejects %s as a renderer with an export failure", async (_label, renderer) => {
		fakeEnvironment({
			importModule: async () => ({
				default: { name: "junk", toolRenderers: { junk_tool: { renderer } } },
			}),
		});
		const [result] = await loadWebExtensions([{ name: "junk", url: "junk.js" }]);
		expect(result).toMatchObject({ status: "failed", reason: "export" });
		expect(getToolRenderer("junk_tool")).toBe(DefaultToolRenderer);
	});

	test.each([
		["an unknown chrome", { chrome: "floating" }],
		["a non-boolean dock", { dock: "yes" }],
		["a summary that is not a function", { summary: "text" }],
		["options that are not an object", "primary"],
	])("rejects %s with an export failure", async (_label, options) => {
		fakeEnvironment({
			importModule: async () => ({
				default: { name: "junk", toolRenderers: { junk_tool: { renderer: () => null, options } } },
			}),
		});
		const [result] = await loadWebExtensions([{ name: "junk", url: "junk.js" }]);
		expect(result).toMatchObject({ status: "failed", reason: "export" });
		expect(getToolRenderer("junk_tool")).toBe(DefaultToolRenderer);
	});

	test("registration keeps only the options the contract names", async () => {
		const renderer = () => null;
		const impostor = () => null;
		fakeEnvironment({
			importModule: async () => ({
				default: {
					name: "picky",
					toolRenderers: {
						picky_tool: {
							renderer,
							options: { prominence: "primary", renderer: impostor, extension: "visualize" },
						},
					},
				},
			}),
		});
		const [result] = await loadWebExtensions([{ name: "picky", url: "picky.js" }]);
		expect(result).toMatchObject({ status: "loaded" });
		expect(getToolRenderer("picky_tool")).toBe(renderer);
		const registration = currentToolRegistry().exact.get("picky_tool");
		expect(registration).toMatchObject({ prominence: "primary", extension: "picky" });
	});

	test("a failed stylesheet registers nothing and removes its link", async () => {
		const { links } = fakeEnvironment({ failStyles: true });
		const [result] = await loadWebExtensions([
			{ name: "unstyled", url: "sibling.js", styles: "missing.css" },
		]);
		expect(result).toMatchObject({ status: "failed", reason: "styles" });
		expect(links[0]?.removed).toBe(true);
		expect(getToolRenderer("sibling_tool")).toBe(DefaultToolRenderer);
	});

	test("loading a name again replaces its renderers and stylesheet; unload removes both", async () => {
		const { links } = fakeEnvironment();
		await loadWebExtensions([{ name: "weather", url: "weather-v1.js", styles: "v1.css" }]);
		const v1 = getToolRenderer("weather");
		await loadWebExtensions([{ name: "weather", url: "weather-v2.js", styles: "v2.css" }]);
		expect(getToolRenderer("weather")).not.toBe(v1);
		expect(getToolRenderer("weather")).not.toBe(DefaultToolRenderer);
		expect(getToolRenderer("forecast")).toBe(DefaultToolRenderer);
		expect(links.map((link) => [link.url.slice(FIXTURES.length), link.removed])).toEqual([
			["v1.css", true],
			["v2.css", false],
		]);
		expect(unloadWebExtension("weather")).toBe(true);
		expect(getToolRenderer("weather")).toBe(DefaultToolRenderer);
		expect(links[1]?.removed).toBe(true);
		expect(webExtensionLoads().has("weather")).toBe(false);
		expect(unloadWebExtension("weather")).toBe(false);
	});

	test("never registers a renderer for a tool the host keeps over the extension's server half", async () => {
		fakeEnvironment();
		const [result] = await loadWebExtensions([
			{ name: "thinkrail-ext-weather", url: "weather-v1.js", shadowed: ["forecast"] },
		]);
		expect(result).toEqual({ name: "thinkrail-ext-weather", status: "loaded", tools: ["weather"] });
		expect(getToolRenderer("weather")).not.toBe(DefaultToolRenderer);
		expect(getToolRenderer("forecast")).toBe(DefaultToolRenderer);
	});

	test("a contested tool name goes to the extension listed first, whichever bundle loads first", async () => {
		const gate = deferred<void>();
		fakeEnvironment({
			importModule: async (url) => {
				if (url.endsWith("weather-v2.js")) await gate.promise;
				return import(url);
			},
		});
		const loads = loadWebExtensions([
			{ name: "listed-first", url: "weather-v2.js" },
			{ name: "listed-second", url: "weather-v1.js" },
		]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const v1 = getToolRenderer("weather");
		expect(v1).not.toBe(DefaultToolRenderer);
		gate.resolve();
		await loads;
		expect(getToolRenderer("weather")).not.toBe(v1);
		expect(resolveProminence("weather").prominence).toBe("routine");
		unloadWebExtension("listed-first");
		expect(getToolRenderer("weather")).toBe(v1);
	});

	test("a contested tool name renders with the later extension while the first-listed one has no renderers", async () => {
		const gate = deferred<void>();
		let fail = true;
		fakeEnvironment({
			importModule: async (url) => {
				if (url.endsWith("weather-v2.js")) {
					await gate.promise;
					if (fail) throw new Error("offline");
				}
				return import(url);
			},
		});
		const loads = loadWebExtensions([
			{ name: "listed-first", url: "weather-v2.js" },
			{ name: "listed-second", url: "weather-v1.js" },
		]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const second = getToolRenderer("weather");
		expect(second).not.toBe(DefaultToolRenderer);
		gate.resolve();
		const [first] = await loads;
		expect(first?.status).toBe("failed");
		expect(getToolRenderer("weather")).toBe(second);
		fail = false;
		const [retried] = await loadWebExtensions([{ name: "listed-first", url: "weather-v2.js" }]);
		expect(retried?.status).toBe("loaded");
		expect(getToolRenderer("weather")).not.toBe(second);
		expect(getToolRenderer("weather")).not.toBe(DefaultToolRenderer);
	});

	test("the pre-render wait is bounded; a hung bundle registers late", async () => {
		const gate = deferred<void>();
		fakeEnvironment({
			importModule: async (url) => {
				if (url.endsWith("sibling.js")) await gate.promise;
				return import(url);
			},
		});
		const started = Date.now();
		const set = [{ name: "slow", url: "sibling.js" }];
		await followInstalledWebExtensions(
			{
				current: () => set,
				unreachable: () => false,
				subscribe: () => () => {},
				rememberedAny: () => true,
				remember: () => {},
			},
			20,
		);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(webExtensionLoads().get("slow")?.status).toBe("loading");
		expect(getToolRenderer("sibling_tool")).toBe(DefaultToolRenderer);
		gate.resolve();
		await loadWebExtensions([]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(webExtensionLoads().get("slow")?.status).toBe("loaded");
		expect(getToolRenderer("sibling_tool")).not.toBe(DefaultToolRenderer);
	});

	test("a stale load never overrides a newer load or an unload of the same name", async () => {
		const gate = deferred<void>();
		fakeEnvironment({
			importModule: async (url) => {
				if (url.endsWith("weather-v1.js")) await gate.promise;
				return import(url);
			},
		});
		const stale = loadWebExtensions([{ name: "race", url: "weather-v1.js" }]);
		const [fresh] = await loadWebExtensions([{ name: "race", url: "weather-v2.js" }]);
		gate.resolve();
		expect((await stale)[0]).toEqual(fresh);
		expect(getToolRenderer("forecast")).toBe(DefaultToolRenderer);

		const second = deferred<void>();
		fakeEnvironment({
			importModule: async (url) => {
				await second.promise;
				return import(url);
			},
		});
		const unloaded = loadWebExtensions([{ name: "race", url: "weather-v1.js" }]);
		unloadWebExtension("race");
		second.resolve();
		expect((await unloaded)[0]).toEqual({ name: "race", status: "unloaded" });
		expect(getToolRenderer("weather")).toBe(DefaultToolRenderer);
	});
});

const resourceHost: ResourceHost = {
	markdown: () => null,
	code: {
		languages: [],
		languageId: () => null,
		pierreTheme: { name: "test", appearance: "dark", style: {} },
		editorTheme: () => ({ rules: [], colors: {} }),
	},
	bytesUrl: () => "",
	openFile: () => {},
	openComparison: () => {},
	readFile: () => new Promise(() => {}),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

const actions: ChatActions = {
	cancelAutomaticReveal: () => {},
	focusComposer: () => {},
	focusToolCall: () => {},
	mayClaimFocus: () => true,
	landingChord: "F6",
	openSubagentTranscript: () => {},
	respondToTool: async () => {},
	resultOpener: () => undefined,
	revealChatElement: () => {},
};

describe("a runtime-loaded card inside a chat row", () => {
	test("reads the chat's resource scope, renders ResourcePreview and receives interaction like a built-in", async () => {
		fakeEnvironment();
		await loadWebExtensions([{ name: "thinkrail-ext-weather", url: "weather-v1.js" }]);
		const markup = renderToStaticMarkup(
			<TooltipProvider>
				<ResourceHostProvider value={resourceHost}>
					<ResourcePreferencesProvider
						value={{
							fileLineWidth: 100,
							fileLineWidthBounded: false,
							diffWrapLines: false,
							setDiffWrapLines: () => {},
							markdownOutlineVisible: null,
							setMarkdownOutlineVisible: () => {},
							markdownOutlineSide: "right",
						}}
					>
						<ResourceEnvironmentProvider value={{ mobile: false }}>
							<ResourceScopeProvider value={{ workspaceId: "ws-1", sessionId: "s-1" }}>
								<ChatActionsContext.Provider value={actions}>
									<InteractionStatesContext.Provider
										value={{ states: {}, focusScope: {}, awaitingToolCallId: "call-1" }}
									>
										<ToolRendererBody
											toolCallId="call-1"
											toolName="weather"
											args={{ city: "Lisbon", path: "notes/forecast.md" }}
											result={null}
											status="running"
											streaming={false}
											imageLabel=""
										/>
									</InteractionStatesContext.Provider>
								</ChatActionsContext.Provider>
							</ResourceScopeProvider>
						</ResourceEnvironmentProvider>
					</ResourcePreferencesProvider>
				</ResourceHostProvider>
			</TooltipProvider>,
		);
		expect(markup).toContain('data-weather-card="v1"');
		expect(markup).toContain('data-scope-workspace="ws-1"');
		expect(markup).toContain('data-scope-session="s-1"');
		expect(markup).toContain('data-interactive="yes"');
		expect(markup).toContain('data-accepting="true"');
		expect(markup).toContain("Lisbon");
		expect(markup).not.toContain("tool-renderer-fallback");
		expect(markup).toContain('data-testid="skeleton-rows"');
		expect(
			getToolSummary(currentTranslator(), "weather", {
				toolCallId: "call-1",
				toolName: "weather",
				args: { city: "Lisbon" },
				result: null,
				status: "done",
				streaming: false,
			}),
		).toBe("forecast for Lisbon");
	});
});
