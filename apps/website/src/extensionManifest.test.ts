import { describe, expect, test } from "bun:test";
import { isPackageRelativePath, manifestHalves, parseExtensionManifest } from "./extensionManifest";

function rejection(value: unknown): string | undefined {
	const result = parseExtensionManifest(value);
	return result.ok ? undefined : result.reason;
}

describe("parseExtensionManifest", () => {
	test("accepts the contract's example manifest", () => {
		const manifest = {
			api: "1.0",
			server: "./server/index.ts",
			web: "./dist/web.js",
			styles: "./dist/web.css",
			title: "Weather",
			image: "https://example.com/preview.png",
		};
		expect(parseExtensionManifest(manifest)).toEqual({ ok: true, manifest });
	});

	test.each([["1.0"], ["0.1"], ["2.13"]])("accepts api %s", (api) => {
		expect(rejection({ api, server: "./s.ts" })).toBeUndefined();
	});

	test.each([["1"], ["1.0.0"], ["v1.0"], ["01.0"], ["1.00"], [" 1.0"], [1], [undefined]])(
		"rejects api %p",
		(api) => {
			expect(rejection({ api, server: "./s.ts" })).toBe("api must be a major.minor version string");
		},
	);

	test("requires at least one half", () => {
		expect(rejection({ api: "1.0" })).toBe("declares neither server nor web");
		expect(rejection({ api: "1.0", title: "Only a title" })).toBe(
			"declares neither server nor web",
		);
	});

	test("allows styles only with web", () => {
		expect(rejection({ api: "1.0", server: "./s.ts", styles: "./w.css" })).toBe(
			"styles is declared without web",
		);
		expect(rejection({ api: "1.0", web: "./w.js", styles: "./w.css" })).toBeUndefined();
	});

	test("rejects a path that leaves the package", () => {
		expect(rejection({ api: "1.0", server: "../outside.ts" })).toBe(
			"server must be a relative path inside the package",
		);
		expect(rejection({ api: "1.0", web: "/abs/web.js" })).toBe(
			"web must be a relative path inside the package",
		);
		expect(rejection({ api: "1.0", web: "./w.js", styles: "https://cdn.example/w.css" })).toBe(
			"styles must be a relative path inside the package",
		);
	});

	test("rejects a non-object manifest and wrongly typed fields", () => {
		expect(rejection(null)).toBe("the thinkrail manifest is not an object");
		expect(rejection(["1.0"])).toBe("the thinkrail manifest is not an object");
		expect(rejection({ api: "1.0", server: 1 })).toBe(
			"server must be a relative path inside the package",
		);
		expect(rejection({ api: "1.0", server: "./s.ts", title: 5 })).toBe("title must be a string");
		expect(rejection({ api: "1.0", server: "./s.ts", image: {} })).toBe("image must be a string");
	});

	test("derives the halves in a fixed order", () => {
		expect(manifestHalves({ api: "1.0", web: "w.js", server: "s.ts" })).toEqual(["server", "web"]);
		expect(manifestHalves({ api: "1.0", web: "w.js" })).toEqual(["web"]);
		expect(manifestHalves({ api: "1.0", server: "s.ts" })).toEqual(["server"]);
	});
});

describe("isPackageRelativePath", () => {
	test.each([["./server/index.ts"], ["server/index.ts"], ["dist/../dist/web.js"], ["./a/./b.js"]])(
		"accepts %s",
		(path) => {
			expect(isPackageRelativePath(path)).toBe(true);
		},
	);

	test.each([
		[""],
		["."],
		["./"],
		[".."],
		["../x.js"],
		["a/../../x.js"],
		["/etc/passwd"],
		["C:/x.js"],
		["dist\\web.js"],
		["file:///x.js"],
		["https://example.com/x.js"],
	])("rejects %p", (path) => {
		expect(isPackageRelativePath(path)).toBe(false);
	});
});
