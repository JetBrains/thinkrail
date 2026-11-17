import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	EXTENSION_API_VERSION,
	extensionApiMismatch,
	hasExtensionManifest,
	isExtensionApiCompatible,
	normalizeManifestPath,
	parseExtensionManifest,
} from "@thinkrail/extension-api/installed";
import * as web from "@thinkrail/extension-api/web";

const valid = {
	name: "thinkrail-ext-weather",
	version: "1.2.0",
	description: "Forecasts in chat.",
	author: { name: "Jane Doe" },
	keywords: ["thinkrail-extension"],
	thinkrail: {
		api: "1.0",
		server: "./server/index.ts",
		web: "./dist/web.js",
		styles: "./dist/web.css",
		title: "Weather",
		image: "https://example.com/preview.png",
	},
};

const CASES = JSON.parse(
	readFileSync(new URL("./manifestCases.json", import.meta.url), "utf8"),
) as { label: string; packageJson: unknown; valid: boolean }[];

describe("the shared manifest cases", () => {
	it.each(CASES.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
		expect(parseExtensionManifest(entry.packageJson).ok).toBe(entry.valid);
	});
});

describe("parseExtensionManifest", () => {
	it("reads the manifest and the package's own fields", () => {
		expect(parseExtensionManifest(valid)).toEqual({
			ok: true,
			manifest: {
				name: "thinkrail-ext-weather",
				version: "1.2.0",
				description: "Forecasts in chat.",
				author: "Jane Doe",
				api: "1.0",
				server: "server/index.ts",
				web: "dist/web.js",
				styles: "dist/web.css",
				title: "Weather",
				image: "https://example.com/preview.png",
			},
		});
	});

	it("accepts a server-only and a web-only extension without inventing fields", () => {
		const server = parseExtensionManifest({ name: "a", thinkrail: { api: "1.0", server: "s.ts" } });
		expect(server).toEqual({ ok: true, manifest: { name: "a", api: "1.0", server: "s.ts" } });
		const web = parseExtensionManifest({ name: "@x/b", thinkrail: { api: "1.0", web: "w.mjs" } });
		expect(web).toEqual({ ok: true, manifest: { name: "@x/b", api: "1.0", web: "w.mjs" } });
	});

	it.each([
		["not an object", null, "not an object"],
		["no name", { thinkrail: { api: "1.0", server: "s.ts" } }, "valid npm package name"],
		["a bad name", { name: "Bad Name", thinkrail: { api: "1.0", server: "s.ts" } }, "valid npm"],
		["a non-object manifest", { name: "a", thinkrail: "yes" }, "must be an object"],
		["no api", { name: "a", thinkrail: { server: "s.ts" } }, '"api"'],
		["a bad api", { name: "a", thinkrail: { api: "1", server: "s.ts" } }, '"api"'],
		["no half", { name: "a", thinkrail: { api: "1.0" } }, "declare"],
		[
			"styles alone",
			{ name: "a", thinkrail: { api: "1.0", server: "s.ts", styles: "a.css" } },
			"needs a",
		],
		["an absolute path", { name: "a", thinkrail: { api: "1.0", server: "/etc/x.ts" } }, "inside"],
		["an escaping path", { name: "a", thinkrail: { api: "1.0", server: "../x.ts" } }, "inside"],
		["a windows path", { name: "a", thinkrail: { api: "1.0", server: "C:\\x.ts" } }, "inside"],
		["a web half that is not js", { name: "a", thinkrail: { api: "1.0", web: "w.css" } }, ".js"],
		[
			"styles that are not css",
			{ name: "a", thinkrail: { api: "1.0", web: "w.js", styles: "s.js" } },
			".css",
		],
		[
			"an empty title",
			{ name: "a", thinkrail: { api: "1.0", server: "s.ts", title: " " } },
			'"title"',
		],
	])("rejects %s", (_label, packageJson, message) => {
		const result = parseExtensionManifest(packageJson);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain(message);
	});

	it("reserves the built-in extensions' names", () => {
		const result = parseExtensionManifest(
			{ name: "visualize", thinkrail: { api: "1.0", server: "s.ts" } },
			{ reservedNames: ["visualize"] },
		);
		expect(result).toEqual({ ok: false, error: '"visualize" is the name of a built-in extension' });
	});

	it("tells a package with a manifest key from one without", () => {
		expect(hasExtensionManifest(valid)).toBe(true);
		expect(hasExtensionManifest({ name: "a", pi: {} })).toBe(false);
		expect(hasExtensionManifest("text")).toBe(false);
	});
});

describe("normalizeManifestPath", () => {
	it("keeps paths inside the package and drops dot segments", () => {
		expect(normalizeManifestPath("./dist//web.js")).toBe("dist/web.js");
		expect(normalizeManifestPath("dist/./web.js")).toBe("dist/web.js");
		expect(normalizeManifestPath("dist/../../web.js")).toBeUndefined();
		expect(normalizeManifestPath("./")).toBeUndefined();
	});
});

describe("the extension API version rule", () => {
	it("is one constant, kept out of the web contract extensions receive", () => {
		expect(EXTENSION_API_VERSION).toBe("1.0");
		expect(web).not.toHaveProperty("EXTENSION_API_VERSION");
		expect(web).not.toHaveProperty("parseExtensionManifest");
	});

	it("loads the same major with a minor that is not newer", () => {
		expect(isExtensionApiCompatible("1.0", "1.2")).toBe(true);
		expect(isExtensionApiCompatible("1.2", "1.2")).toBe(true);
		expect(isExtensionApiCompatible("1.3", "1.2")).toBe(false);
		expect(isExtensionApiCompatible("2.0", "1.2")).toBe(false);
		expect(isExtensionApiCompatible("0.9", "1.2")).toBe(false);
	});

	it("says why in both directions", () => {
		expect(extensionApiMismatch("2.0", "1.0")).toBe(
			"built for extension API 2.0; this ThinkRail supports 1.0",
		);
		expect(extensionApiMismatch("1.1", "1.0")).toContain("update ThinkRail");
		expect(extensionApiMismatch("1.0", "1.0")).toBeUndefined();
	});
});
