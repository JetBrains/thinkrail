import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { manifestHalves, packagePath, parseExtensionManifest } from "./extensionManifest";

interface ManifestCase {
	label: string;
	packageJson: unknown;
	valid: boolean;
}

const HOST_CASES = JSON.parse(
	readFileSync(
		new URL("../../../packages/extension-api/src/manifestCases.json", import.meta.url),
		"utf8",
	),
) as ManifestCase[];

function rejection(thinkrail: unknown): string | undefined {
	const result = parseExtensionManifest({ name: "thinkrail-ext-x", thinkrail });
	return result.ok ? undefined : result.reason;
}

describe("the host's shared manifest cases", () => {
	test.each(HOST_CASES.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
		expect(parseExtensionManifest(entry.packageJson).ok).toBe(entry.valid);
	});
});

describe("parseExtensionManifest", () => {
	test("returns the contract's example manifest", () => {
		const manifest = {
			api: "1.0",
			server: "./server/index.ts",
			web: "./dist/web.js",
			styles: "./dist/web.css",
			title: "Weather",
			image: "https://example.com/preview.png",
		};
		expect(parseExtensionManifest({ name: "thinkrail-ext-weather", thinkrail: manifest })).toEqual({
			ok: true,
			manifest,
		});
	});

	test("says why a manifest is not listed", () => {
		expect(parseExtensionManifest(null)).toEqual({
			ok: false,
			reason: "the package.json is not an object",
		});
		expect(parseExtensionManifest({ name: "Bad Name", thinkrail: {} })).toEqual({
			ok: false,
			reason: "the package name is not valid",
		});
		expect(rejection(["1.0"])).toBe("the thinkrail manifest is not an object");
		expect(rejection({ api: "1", server: "./s.ts" })).toBe(
			"api must be a major.minor version string",
		);
		expect(rejection({ api: "1.0", title: "Only a title" })).toBe(
			"declares neither server nor web",
		);
		expect(rejection({ api: "1.0", server: "./s.ts", styles: "./w.css" })).toBe(
			"styles is declared without web",
		);
		expect(rejection({ api: "1.0", server: "../outside.ts" })).toBe(
			"server must be a relative path inside the package",
		);
		expect(rejection({ api: "1.0", web: "./w.css" })).toBe("web must name a .js or .mjs file");
		expect(rejection({ api: "1.0", server: "./s.ts", title: 5 })).toBe(
			"title must be a non-empty string",
		);
	});

	test("derives the halves in a fixed order", () => {
		expect(manifestHalves({ api: "1.0", web: "w.js", server: "s.ts" })).toEqual(["server", "web"]);
		expect(manifestHalves({ api: "1.0", web: "w.js" })).toEqual(["web"]);
		expect(manifestHalves({ api: "1.0", server: "s.ts" })).toEqual(["server"]);
	});
});

describe("packagePath", () => {
	test.each([
		["./server/index.ts", "server/index.ts"],
		["server/index.ts", "server/index.ts"],
		["./a/./b.js", "a/b.js"],
		["dist//web.js/", "dist/web.js"],
	])("accepts %s as %s", (path, normalized) => {
		expect(packagePath(path)).toBe(normalized);
	});

	test.each([
		[""],
		["."],
		["./"],
		[".."],
		["../x.js"],
		["dist/../dist/web.js"],
		["/etc/passwd"],
		["C:/x.js"],
		["dist\\web.js"],
		["file:///x.js"],
		["https://example.com/x.js"],
	])("rejects %p", (path) => {
		expect(packagePath(path)).toBeUndefined();
	});
});
