import { describe, expect, it, mock } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { listExtensionCatalog } from "./catalog";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

function shippedApiVersion(name: string): Pick<ExtensionCatalogEntry, "apiVersion"> {
	const apiVersion = serverExtensions.find((entry) => entry.extension.name === name)?.extension
		.apiVersion;
	return apiVersion === undefined ? {} : { apiVersion };
}

function tool(name: string): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.on("session_start", () => {});
		pi.registerTool({ name } as Parameters<ExtensionAPI["registerTool"]>[0]);
	};
}

describe("listExtensionCatalog", () => {
	it("lists the shipped extensions with their copy, tools and enabled state", async () => {
		expect(await listExtensionCatalog(new Set())).toEqual([
			{
				name: "visualize",
				title: "Visualize",
				description: expect.any(String),
				enabled: true,
				tools: ["visualize"],
				hasParentExtensions: true,
				hasChildExtensions: false,
			},
			{
				name: "ask-user-question",
				title: "Ask user question",
				description: expect.any(String),
				enabled: true,
				tools: ["ask_user_question"],
				hasParentExtensions: true,
				hasChildExtensions: false,
				settings: [{ key: "richPreviews", default: true }],
			},
			{
				name: "web-access",
				title: "Web access",
				description: expect.any(String),
				enabled: true,
				tools: ["web_search", "source_check", "fetch_content", "get_search_content", "web_enable"],
				hasParentExtensions: true,
				hasChildExtensions: true,
			},
			{
				name: "next-steps",
				title: "Next-step suggestions",
				description: expect.any(String),
				enabled: true,
				tools: ["suggest_next_steps"],
				hasParentExtensions: true,
				hasChildExtensions: false,
			},
			{
				name: "session-insights",
				title: "Session insights",
				description: expect.any(String),
				enabled: true,
				tools: [],
				hasParentExtensions: false,
				hasChildExtensions: false,
				...shippedApiVersion("session-insights"),
			},
			{
				name: "board",
				title: "Board",
				description: expect.any(String),
				enabled: true,
				tools: [
					"board_card_get",
					"board_cards_list",
					"board_card_create",
					"board_link",
					"board_card_note",
				],
				hasParentExtensions: true,
				hasChildExtensions: false,
				...shippedApiVersion("board"),
			},
		]);
		const [visualize, ask] = await listExtensionCatalog(new Set(["visualize", "retired"]));
		expect(visualize?.enabled).toBe(false);
		expect(ask?.enabled).toBe(true);
	});

	it("records a session factory's tools with its declared setting defaults", async () => {
		const read: boolean[] = [];
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "@acme/settings/server",
				extension: {
					name: "settings-demo",
					extensions: [],
					settings: { rich: { type: "boolean", default: false } },
					sessionExtensions: (session) => [
						(pi) => {
							read.push(session.setting("rich"));
							pi.registerTool({ name: "demo" } as Parameters<ExtensionAPI["registerTool"]>[0]);
						},
					],
				},
			},
		];
		const [entry] = await listExtensionCatalog(new Set(), entries);
		expect(entry?.tools).toEqual(["demo"]);
		expect(entry?.hasParentExtensions).toBe(true);
		expect(entry?.settings).toEqual([{ key: "rich", default: false }]);
		expect(read).toEqual([false]);
	});

	it("records parent tools against a stub, never children, and survives a throwing factory", async () => {
		const child = mock<ExtensionFactory>(() => {});
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "@acme/demo/server",
				extension: {
					name: "demo",
					extensions: [
						tool("alpha"),
						async (pi) => {
							await pi.events.emit("ready", {});
							pi.registerTool({ name: "beta" } as Parameters<ExtensionAPI["registerTool"]>[0]);
							throw new Error("boom");
						},
						tool("alpha"),
					],
					childExtensions: [child],
				},
			},
			{ specifier: "@acme/bare/server", extension: { name: "bare", extensions: [] } },
		];
		expect(await listExtensionCatalog(new Set(["bare"]), entries)).toEqual([
			{
				name: "demo",
				title: "demo",
				enabled: true,
				tools: ["alpha", "beta"],
				hasParentExtensions: true,
				hasChildExtensions: true,
			},
			{
				name: "bare",
				title: "bare",
				enabled: false,
				tools: [],
				hasParentExtensions: false,
				hasChildExtensions: false,
			},
		]);
		expect(child).not.toHaveBeenCalled();
	});

	it("lists a declared apiVersion without building the extension's queries", async () => {
		const queries = mock(() => ({ "sessions.list": () => [] }));
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "@acme/insights/server",
				extension: { name: "insights", extensions: [], apiVersion: 3, queries },
			},
			{
				specifier: "@acme/unversioned/server",
				extension: { name: "plain", extensions: [], queries },
			},
		];
		expect(await listExtensionCatalog(new Set(), entries)).toEqual([
			{
				name: "insights",
				title: "insights",
				enabled: true,
				tools: [],
				hasParentExtensions: false,
				hasChildExtensions: false,
				apiVersion: 3,
			},
			{
				name: "plain",
				title: "plain",
				enabled: true,
				tools: [],
				hasParentExtensions: false,
				hasChildExtensions: false,
			},
		]);
		expect(queries).not.toHaveBeenCalled();
	});

	it("lists per-session tools through an inert session that never answers", async () => {
		let response: Promise<unknown> | undefined;
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "@acme/asker/server",
				extension: {
					name: "asker",
					extensions: [tool("static")],
					sessionExtensions: (session) => {
						response = session.awaitToolResponse("call", undefined);
						response.catch(() => undefined);
						return [tool("asked")];
					},
				},
			},
		];
		expect(await listExtensionCatalog(new Set(), entries)).toEqual([
			{
				name: "asker",
				title: "asker",
				enabled: true,
				tools: ["static", "asked"],
				hasParentExtensions: true,
				hasChildExtensions: false,
			},
		]);
		await expect(response).rejects.toThrow("no session");
	});
});
