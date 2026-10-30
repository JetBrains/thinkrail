import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./index";
import piWebAccess from "./piWebAccess.js";

describe("web-access server half", () => {
	test("resolves configuration when the factory runs, after the agent directory is set", () => {
		const root = mkdtempSync(join(tmpdir(), "web-access-init-"));
		const initial = join(root, "initial");
		const configured = join(root, "configured");
		mkdirSync(initial);
		mkdirSync(configured);
		writeFileSync(
			join(configured, "web-search.json"),
			JSON.stringify({ toolActivation: "invalid-test-activation" }),
		);
		const source = `
const { default: factory } = await import(${JSON.stringify(new URL("./piWebAccess.js", import.meta.url).href)});
process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(configured)};
try {
	await factory(new Proxy({}, { get: () => () => {} }));
	process.exitCode = 1;
} catch (error) {
	if (!(error instanceof Error) || !error.message.includes("toolActivation")) throw error;
}
`;
		try {
			const result = Bun.spawnSync([process.execPath, "--eval", source], {
				env: { ...process.env, PI_CODING_AGENT_DIR: initial },
				timeout: 10_000,
			});
			expect(result.exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("composes pi-web-access for parents and children, with its skills", () => {
		expect(extension.name).toBe("web-access");
		expect(extension.title).toBe("Web access");
		expect(extension.description).toBeTruthy();
		expect(extension.extensions).toEqual([piWebAccess]);
		expect(extension.childExtensions).toEqual([piWebAccess]);
		expect(extension.skillPackages).toEqual(["@thinkrail/ext-web-access"]);
	});

	test("the wrapped factory loads the package and registers its tools", async () => {
		const tools: string[] = [];
		const recording = new Proxy(
			{ registerTool: (tool: { name: string }) => tools.push(tool.name) },
			{ get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
		);
		await piWebAccess(recording as unknown as ExtensionAPI);
		expect(tools).toEqual(["web_search", "source_check", "fetch_content", "get_search_content"]);
	});
});
