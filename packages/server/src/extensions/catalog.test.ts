import { describe, expect, it, jest, mock } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { extensionToolNames, listExtensionCatalog } from "./catalog";
import { EXTENSION_LOAD_TIMEOUT_MS } from "./installed";
import type { ServerExtensionEntry } from "./registry";

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
				hasChildExtensions: false,
				kind: "builtin",
			},
			{
				name: "ask-user-question",
				title: "Ask user question",
				description: expect.any(String),
				enabled: true,
				tools: ["ask_user_question"],
				hasChildExtensions: false,
				settings: [{ key: "richPreviews", default: true }],
				kind: "builtin",
			},
			{
				name: "web-access",
				title: "Web access",
				description: expect.any(String),
				enabled: true,
				tools: ["web_search", "source_check", "fetch_content", "get_search_content", "web_enable"],
				hasChildExtensions: true,
				kind: "builtin",
			},
			{
				name: "next-steps",
				title: "Next-step suggestions",
				description: expect.any(String),
				enabled: true,
				tools: ["suggest_next_steps"],
				hasChildExtensions: false,
				kind: "builtin",
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
				hasChildExtensions: true,
				kind: "builtin",
			},
			{
				name: "bare",
				title: "bare",
				enabled: false,
				tools: [],
				hasChildExtensions: false,
				kind: "builtin",
			},
		]);
		expect(child).not.toHaveBeenCalled();
	});

	it("lists the static tools of an extension whose per-session factories throw", async () => {
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "/x/server/index.ts",
				extension: {
					name: "throws",
					extensions: [tool("static")],
					sessionExtensions: (session) => [tool(String(session.setting("typo")))],
				},
			},
		];
		const [entry] = await listExtensionCatalog(new Set(), entries, []);
		expect(entry?.tools).toEqual(["static"]);
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
				hasChildExtensions: false,
				kind: "builtin",
			},
		]);
		await expect(response).rejects.toThrow("no session");
	});

	it("never waits longer than the load timeout for a factory that hangs against the stub", async () => {
		const hanging: ExtensionFactory = (pi) => {
			pi.registerTool({ name: "before_hang" } as Parameters<ExtensionAPI["registerTool"]>[0]);
			return new Promise(() => {});
		};
		const hung = {
			name: "hung",
			extensions: [hanging, tool("static")],
			sessionExtensions: () => [() => new Promise<void>(() => {})],
		};
		const entries: ServerExtensionEntry[] = [
			{ specifier: "/x/hung/server/index.ts", extension: hung },
		];
		jest.useFakeTimers();
		try {
			const listing = listExtensionCatalog(new Set(), entries, []);
			for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
			jest.advanceTimersByTime(EXTENSION_LOAD_TIMEOUT_MS);
			const [entry] = await listing;
			expect(entry?.tools).toEqual(["before_hang", "static"]);
			expect(await extensionToolNames(hung)).toEqual(["before_hang", "static"]);
		} finally {
			jest.useRealTimers();
		}
	});

	it("observes a sessionExtensions promise that rejects, and keeps the static tools", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const entries: ServerExtensionEntry[] = [
				{
					specifier: "/x/rejects/server/index.ts",
					extension: {
						name: "rejects",
						extensions: [tool("static")],
						sessionExtensions: (async (session: { setting: (key: string) => boolean }) => [
							tool(String(session.setting("undeclared"))),
						]) as unknown as () => ExtensionFactory[],
					},
				},
			];
			const [entry] = await listExtensionCatalog(new Set(), entries, []);
			expect(entry?.tools).toEqual(["static"]);
			await Bun.sleep(20);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("lists the static tools of a sessionExtensions that answers a promise", async () => {
		const entries: ServerExtensionEntry[] = [
			{
				specifier: "/x/async/server/index.ts",
				extension: {
					name: "async-session",
					extensions: [tool("static")],
					sessionExtensions: (() => new Promise(() => {})) as unknown as () => ExtensionFactory[],
				},
			},
		];
		const [entry] = await listExtensionCatalog(new Set(), entries, []);
		expect(entry?.tools).toEqual(["static"]);
	});
});
