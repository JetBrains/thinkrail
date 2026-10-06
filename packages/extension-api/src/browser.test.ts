import { describe, expect, it } from "bun:test";
import { relative, resolve, sep } from "node:path";
import * as root from "@thinkrail/extension-api";
import * as web from "@thinkrail/extension-api/web";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

function assertBrowserSource(path: string, repoRoot = REPO_ROOT): void {
	const source = relative(repoRoot, path).split(sep).join("/");
	if (
		source.startsWith("apps/") ||
		source.startsWith("packages/server/") ||
		source === "packages/extension-api/src/server.ts" ||
		source.startsWith("packages/extension-api/src/server/")
	) {
		throw new Error(`Browser entry reached host/server code: ${path}`);
	}
}

describe("browser-safe public surface", () => {
	it.each([
		"apps",
		"server",
	])("checks repository paths independently of a %s ancestor", (ancestor) => {
		const repoRoot = resolve("fixtures", ancestor, "checkout");
		for (const source of [
			"packages/extension-api/src/web.ts",
			"packages/extension-api/src/toolHelpers.ts",
			"packages/contracts/src/index.ts",
		]) {
			expect(() => assertBrowserSource(resolve(repoRoot, source), repoRoot)).not.toThrow();
		}
		for (const source of [
			"apps/web/src/main.tsx",
			"packages/server/src/index.ts",
			"packages/extension-api/src/server.ts",
			"packages/extension-api/src/server/helpers.ts",
		]) {
			expect(() => assertBrowserSource(resolve(repoRoot, source), repoRoot)).toThrow(
				"Browser entry reached host/server code",
			);
		}
	});

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
						builder.onLoad({ filter: /.*/ }, ({ path }) => {
							assertBrowserSource(path);
							return undefined;
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
