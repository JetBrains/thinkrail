import { describe, expect, it, mock } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { listExtensionCatalog } from "./catalog";
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
			},
			{
				name: "ask-user-question",
				title: "Ask user question",
				description: expect.any(String),
				enabled: true,
				tools: ["ask_user_question"],
				hasChildExtensions: false,
			},
			{
				name: "web-access",
				title: "Web access",
				description: expect.any(String),
				enabled: true,
				tools: ["web_search", "source_check", "fetch_content", "get_search_content", "web_enable"],
				hasChildExtensions: true,
			},
		]);
		const [visualize, ask] = await listExtensionCatalog(new Set(["visualize", "retired"]));
		expect(visualize?.enabled).toBe(false);
		expect(ask?.enabled).toBe(true);
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
			},
			{ name: "bare", title: "bare", enabled: false, tools: [], hasChildExtensions: false },
		]);
		expect(child).not.toHaveBeenCalled();
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
			},
		]);
		await expect(response).rejects.toThrow("no session");
	});
});
