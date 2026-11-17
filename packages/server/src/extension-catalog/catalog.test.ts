import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionHalf } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	browseExtensions,
	CATALOG_CACHE_MS,
	catalogUrl,
	EXTENSION_CATALOG_URL,
	ExtensionCatalogSource,
	parseExtensionCatalog,
} from "./index";

const WEATHER = {
	name: "thinkrail-ext-weather",
	version: "1.2.0",
	title: "Weather",
	description: "Forecasts in chat.",
	author: "Jane Doe",
	api: "1.0",
	halves: ["server", "web"] as ExtensionHalf[],
	image: "https://example.com/preview.png",
	install: "npm:thinkrail-ext-weather",
	npm: "https://www.npmjs.com/package/thinkrail-ext-weather",
	repository: "https://github.com/jane/thinkrail-ext-weather",
	publishedAt: "2026-11-10T09:30:00.000Z",
};
const REVIEW = {
	name: "@acme/thinkrail-review-cards",
	version: "0.3.1",
	description: "Review cards for diffs.",
	api: "1.0",
	halves: ["web"] as ExtensionHalf[],
	install: "npm:@acme/thinkrail-review-cards",
	npm: "https://www.npmjs.com/package/@acme/thinkrail-review-cards",
	publishedAt: "2026-11-12T16:05:12.345Z",
};
const CATALOG = {
	schema: 1,
	generatedAt: "2026-11-17T12:00:00.000Z",
	extensions: [REVIEW, WEATHER],
};

function jsonFetch(
	body: unknown,
	init: ResponseInit = {},
): { fetch: typeof fetch; calls: () => number } {
	let calls = 0;
	const fake = (async () => {
		calls += 1;
		return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
	}) as unknown as typeof fetch;
	return { fetch: fake, calls: () => calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
		return undefined;
	} catch (error) {
		return errorCodeOf(error);
	}
}

describe("parseExtensionCatalog", () => {
	test("keeps every valid listing with its optional fields", () => {
		const catalog = parseExtensionCatalog(CATALOG);
		expect(catalog?.generatedAt).toBe(CATALOG.generatedAt);
		expect(catalog?.extensions).toEqual([REVIEW, WEATHER]);
	});

	test("drops fields it does not know instead of failing", () => {
		const catalog = parseExtensionCatalog({
			...CATALOG,
			extensions: [{ ...REVIEW, stars: 4 }],
		});
		expect(catalog?.extensions).toEqual([REVIEW]);
	});

	test.each([
		["schema 2", { ...CATALOG, schema: 2 }],
		["no generatedAt", { ...CATALOG, generatedAt: undefined }],
		["extensions not a list", { ...CATALOG, extensions: {} }],
		["install not npm:<name>", { ...CATALOG, extensions: [{ ...REVIEW, install: "npm:other" }] }],
		["an unknown half", { ...CATALOG, extensions: [{ ...REVIEW, halves: ["web", "cli"] }] }],
		["no halves", { ...CATALOG, extensions: [{ ...REVIEW, halves: [] }] }],
		["a non-https image", { ...CATALOG, extensions: [{ ...WEATHER, image: "http://x/y.png" }] }],
		["a duplicate name", { ...CATALOG, extensions: [REVIEW, REVIEW] }],
		["a bad package name", { ...CATALOG, extensions: [{ ...REVIEW, name: "Bad Name" }] }],
		["a non-string api", { ...CATALOG, extensions: [{ ...REVIEW, api: 1 }] }],
	])("rejects the whole file for %s", (_label, value) => {
		expect(parseExtensionCatalog(value)).toBeNull();
	});
});

describe("ExtensionCatalogSource", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	test("reads the published URL unless the environment overrides it", () => {
		expect(catalogUrl(undefined)).toBe(EXTENSION_CATALOG_URL);
		expect(catalogUrl("  ")).toBe(EXTENSION_CATALOG_URL);
		expect(catalogUrl("file:///tmp/catalog.json")).toBe("file:///tmp/catalog.json");
	});

	test("caches a read for a few minutes and refetches on force or expiry", async () => {
		let now = 1_000;
		const remote = jsonFetch(CATALOG);
		const source = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: remote.fetch,
			now: () => now,
			offline: () => false,
		});
		await source.read();
		await source.read();
		expect(remote.calls()).toBe(1);
		await source.read({ force: true });
		expect(remote.calls()).toBe(2);
		now += CATALOG_CACHE_MS;
		await source.read();
		expect(remote.calls()).toBe(3);
	});

	test("shares one request between concurrent reads and never caches a failure", async () => {
		const remote = jsonFetch("not json");
		const source = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: remote.fetch,
			offline: () => false,
		});
		const codes = await Promise.all([codeOf(source.read()), codeOf(source.read())]);
		expect(codes).toEqual(["EXTENSION_CATALOG_INVALID", "EXTENSION_CATALOG_INVALID"]);
		expect(remote.calls()).toBe(1);
		await codeOf(source.read());
		expect(remote.calls()).toBe(2);
	});

	test("tells offline, unreachable and invalid apart", async () => {
		const offline = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: jsonFetch(CATALOG).fetch,
			offline: () => true,
		});
		expect(await codeOf(offline.read())).toBe("EXTENSION_CATALOG_OFFLINE");
		const down = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: (async () => {
				throw new TypeError("network down");
			}) as unknown as typeof fetch,
			offline: () => false,
		});
		expect(await codeOf(down.read())).toBe("EXTENSION_CATALOG_UNREACHABLE");
		const status = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: jsonFetch("", { status: 503 }).fetch,
			offline: () => false,
		});
		expect(await codeOf(status.read())).toBe("EXTENSION_CATALOG_UNREACHABLE");
		const shape = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: jsonFetch({ schema: 1 }).fetch,
			offline: () => false,
		});
		expect(await codeOf(shape.read())).toBe("EXTENSION_CATALOG_INVALID");
	});

	test("stops reading a body that grows past the size cap without a length header", async () => {
		let pulled = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(1024 * 1024));
			},
		});
		const source = new ExtensionCatalogSource({
			url: "https://example.test/catalog.json",
			fetch: (async () => new Response(body)) as unknown as typeof fetch,
			offline: () => false,
		});
		expect(await codeOf(source.read())).toBe("EXTENSION_CATALOG_INVALID");
		expect(pulled).toBeLessThan(10);
	});

	test("reads a file: catalog even offline, and a missing file is unreachable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "catalog-"));
		dirs.push(dir);
		const file = join(dir, "catalog.json");
		writeFileSync(file, JSON.stringify(CATALOG));
		const source = new ExtensionCatalogSource({
			url: pathToFileURL(file).href,
			offline: () => true,
		});
		expect((await source.read()).extensions).toHaveLength(2);
		rmSync(file);
		expect(await codeOf(source.read({ force: true }))).toBe("EXTENSION_CATALOG_UNREACHABLE");
	});
});

test("browseExtensions marks the listings an installed extension already carries", async () => {
	const source = new ExtensionCatalogSource({
		url: "https://example.test/catalog.json",
		fetch: jsonFetch(CATALOG).fetch,
		offline: () => false,
	});
	const result = await browseExtensions(new Set(["thinkrail-ext-weather"]), { source });
	expect(result.extensions.map(({ name, installed }) => [name, installed])).toEqual([
		["@acme/thinkrail-review-cards", false],
		["thinkrail-ext-weather", true],
	]);
});
