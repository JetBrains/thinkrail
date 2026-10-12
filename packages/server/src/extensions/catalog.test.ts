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
	it("lists the shipped visualize extension with its copy, tool and enabled state", async () => {
		expect(await listExtensionCatalog(new Set())).toEqual([
			{
				name: "visualize",
				title: "Visualize",
				description: expect.any(String),
				enabled: true,
				tools: ["visualize"],
				hasChildExtensions: false,
			},
		]);
		const [entry] = await listExtensionCatalog(new Set(["visualize", "retired"]));
		expect(entry?.enabled).toBe(false);
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
			{ name: "demo", title: "demo", enabled: true, tools: ["alpha", "beta"], hasChildExtensions: true },
			{ name: "bare", title: "bare", enabled: false, tools: [], hasChildExtensions: false },
		]);
		expect(child).not.toHaveBeenCalled();
	});
});
