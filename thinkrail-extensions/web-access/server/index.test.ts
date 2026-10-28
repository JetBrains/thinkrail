import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./index";
import piWebAccess from "./piWebAccess.js";

describe("web-access server half", () => {
	test("composes pi-web-access for parents and children, with its skills", () => {
		expect(extension.name).toBe("web-access");
		expect(extension.title).toBe("Web access");
		expect(extension.description).toBeTruthy();
		expect(extension.extensions).toEqual([piWebAccess]);
		expect(extension.childExtensions).toEqual([piWebAccess]);
		expect(extension.skillPackages).toEqual(["pi-web-access"]);
	});

	test("the wrapped factory loads the package and registers its tools", async () => {
		const tools: string[] = [];
		const recording = new Proxy(
			{ registerTool: (tool: { name: string }) => tools.push(tool.name) },
			{ get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
		);
		await piWebAccess(recording as unknown as ExtensionAPI);
		expect(tools).toEqual(["web_search", "fetch_content", "get_search_content"]);
	});
});
