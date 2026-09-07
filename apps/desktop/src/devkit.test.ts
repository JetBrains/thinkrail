import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { electrobunDevkitPlugin } from "./devkit";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(manifest: unknown): { root: string; devkit: string } {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-electrobun-devkit-"));
	roots.push(root);
	const devkit = join(root, ".hutch", "devkit");
	mkdirSync(join(devkit, "api"), { recursive: true });
	writeFileSync(join(devkit, "package.json"), JSON.stringify(manifest));
	return { root, devkit };
}

test("bundles exact SDK exports from the projection, not the npm bootstrap", async () => {
	const { root, devkit } = fixture({
		exports: { "./view": "./api/browser.ts", "./main": "./api/main.ts" },
	});
	writeFileSync(join(devkit, "api", "browser.ts"), 'export const marker = "projected-browser";');
	writeFileSync(join(devkit, "api", "main.ts"), 'export const marker = "projected-main";');
	const packageDir = join(root, "node_modules", "electrobun");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ name: "electrobun", exports: { "./*": "./moved.js" } }),
	);
	writeFileSync(join(packageDir, "moved.js"), 'throw new Error("npm bootstrap reached");');
	const entrypoint = join(root, "entry.ts");
	writeFileSync(
		entrypoint,
		'import { marker as browser } from "electrobun/view"; import { marker as main } from "electrobun/main"; console.log(browser, main);',
	);
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "browser",
		plugins: [electrobunDevkitPlugin(devkit)],
	});
	expect(result.success).toBe(true);
	const output = await result.outputs[0]?.text();
	expect(output).toContain("projected-browser");
	expect(output).toContain("projected-main");
	expect(output).not.toContain("npm bootstrap reached");
});

test("rejects an unexported SDK import instead of falling through", async () => {
	const { root, devkit } = fixture({ exports: { "./view": "./api/browser.ts" } });
	const entrypoint = join(root, "entry.ts");
	writeFileSync(entrypoint, 'import "electrobun/view/internal";');
	const result = await Bun.build({
		entrypoints: [entrypoint],
		throw: false,
		plugins: [electrobunDevkitPlugin(devkit)],
	});
	expect(result.success).toBe(false);
	expect(result.logs.map((log) => log.message).join("\n")).toContain(
		"Electrobun SDK does not export electrobun/view/internal",
	);
});

test.each([
	["missing exports", {}],
	["null manifest", null],
	["array exports", { exports: [] }],
	["conditional target", { exports: { "./view": { default: "./api/browser.ts" } } }],
	["outside API", { exports: { "./view": "./browser.ts" } }],
	["parent traversal", { exports: { "./view": "./api/../../outside.ts" } }],
	["sibling with API prefix", { exports: { "./view": "./api/../api-extra/browser.ts" } }],
	["API directory", { exports: { "./view": "./api/" } }],
	["invalid subpath", { exports: { view: "./api/browser.ts" } }],
	["wildcard subpath", { exports: { "./*": "./api/browser.ts" } }],
])("rejects malformed devkit: %s", (_label, manifest) => {
	const { devkit } = fixture(manifest);
	expect(() => electrobunDevkitPlugin(devkit)).toThrow();
});

test("reports an actionable error before an unsynced build", () => {
	const { root } = fixture({});
	expect(() => electrobunDevkitPlugin(join(root, "missing"))).toThrow(
		"run electrobun prepare first",
	);
});
