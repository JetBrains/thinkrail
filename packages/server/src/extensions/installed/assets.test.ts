import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveExtensionAsset, webHalfOf } from "./assets";
import { InstalledExtensions } from "./runtime";
import { tempDir, writeExtension } from "./testFixtures";

async function loaded(name = "@jane/weather") {
	const root = tempDir();
	const dataDir = join(root, "data");
	mkdirSync(dataDir);
	const folder = writeExtension(join(root, "ext"), {
		name,
		server: false,
		web: "dist/web.js",
		styles: "dist/web.css",
		version: "1.2.0",
	});
	writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: [folder] }));
	const runtime = new InstalledExtensions({
		dataDir,
		reservedNames: () => [],
		skillRoots: () => [],
	});
	await runtime.reconcile();
	return { runtime, folder, root };
}

describe("the web half's URLs", () => {
	it("are versioned, encode the name and change when a file changes", async () => {
		const { runtime, folder } = await loaded();
		const [record] = runtime.records();
		const web = webHalfOf(record as NonNullable<typeof record>);
		expect(web?.url).toMatch(
			/^\/extensions\/%40jane%2Fweather\/1\.2\.0-[0-9a-f]{12}\/dist\/web\.js$/,
		);
		expect(web?.styles).toMatch(/\/dist\/web\.css$/);
		utimesSync(join(folder, "dist", "web.js"), new Date(), new Date(Date.now() + 5_000));
		expect(webHalfOf(record as NonNullable<typeof record>)?.url).not.toBe(web?.url);
	});

	it("are absent without a web half or when the extension did not load", async () => {
		const root = tempDir();
		const dataDir = join(root, "data");
		mkdirSync(dataDir);
		const serverOnly = writeExtension(join(root, "a"));
		const incompatible = writeExtension(join(root, "b"), { api: "2.0", web: "w.js" });
		writeFileSync(
			join(dataDir, "extensions.json"),
			JSON.stringify({ extensions: [serverOnly, incompatible] }),
		);
		const runtime = new InstalledExtensions({
			dataDir,
			reservedNames: () => [],
			skillRoots: () => [],
		});
		await runtime.reconcile();
		for (const record of runtime.records()) expect(webHalfOf(record)).toBeUndefined();
	});
});

describe("resolveExtensionAsset", () => {
	it("serves only the manifest's web and styles files with their content types", async () => {
		const { runtime, folder } = await loaded();
		const [record] = runtime.records();
		const web = webHalfOf(record as NonNullable<typeof record>);
		if (!web?.styles) throw new Error("no web half");
		expect(resolveExtensionAsset(runtime.records(), web.url)).toEqual({
			path: join(folder, "dist", "web.js"),
			contentType: "text/javascript; charset=utf-8",
		});
		expect(resolveExtensionAsset(runtime.records(), web.styles)?.contentType).toBe(
			"text/css; charset=utf-8",
		);
		const base = web.url.replace(/dist\/web\.js$/, "");
		for (const path of [
			`${base}package.json`,
			`${base}server/index.ts`,
			`${base}dist/../package.json`,
			`${base}..%2Fpackage.json`,
			`${base}%E0%A4%A`,
			web.url.replace(/-[0-9a-f]{12}\//, "-000000000000/"),
			web.url.replace("%40jane%2Fweather", "unknown"),
			"/extensions/",
			"/other/x",
		]) {
			expect(resolveExtensionAsset(runtime.records(), path)).toBeUndefined();
		}
	});

	it("refuses a served file that became a link out of the package", async () => {
		const { runtime, folder, root } = await loaded("linked");
		writeFileSync(join(root, "secret.js"), "secret");
		const [record] = runtime.records();
		const target = join(folder, "dist", "web.js");
		rmSync(target);
		symlinkSync(join(root, "secret.js"), target);
		const url = webHalfOf(record as NonNullable<typeof record>)?.url as string;
		expect(resolveExtensionAsset(runtime.records(), url)).toBeUndefined();
	});
});
