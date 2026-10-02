import { describe, expect, it } from "bun:test";
import * as root from "@thinkrail/extension-api";
import * as web from "@thinkrail/extension-api/web";

describe("browser-safe public surface", () => {
	it("exports only the web contract at the root", () => {
		expect(Object.keys(root).sort()).toEqual(Object.keys(web).sort());
		expect(root).not.toHaveProperty("defineServerExtension");
		expect(root.defineWebExtension).toBe(web.defineWebExtension);
		expect(root.parseToolResultContent).toBe(web.parseToolResultContent);
	});

	it.each([
		"@thinkrail/extension-api",
		"@thinkrail/extension-api/web",
	])("bundles %s without React, pi, host or server runtime imports", async (entry) => {
		const imports: string[] = [];
		const build = await Bun.build({
			entrypoints: [Bun.resolveSync(entry, import.meta.dir)],
			target: "browser",
			plugins: [
				{
					name: "enforce-browser-runtime-boundary",
					setup(builder) {
						builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
							imports.push(path);
							if (path !== "@thinkrail/contracts") {
								throw new Error(`Unexpected runtime dependency: ${path}`);
							}
							return undefined;
						});
						builder.onLoad({ filter: /\/(?:apps|server)\/|\/server\.ts$/ }, ({ path }) => {
							throw new Error(`Browser entry reached host/server code: ${path}`);
						});
					},
				},
			],
		});

		expect(build.logs).toEqual([]);
		expect(build.success).toBe(true);
		expect(imports).toEqual(["@thinkrail/contracts"]);
		expect(await build.outputs[0]?.text()).not.toContain("defineServerExtension");
	});
});
