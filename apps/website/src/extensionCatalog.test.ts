import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	type BuildCatalogOptions,
	buildExtensionCatalog,
	catalogErrors,
	catalogKeyword,
	latestUrl,
	normalizeAuthor,
	normalizeRepository,
	searchOffsetLimit,
	searchUrl,
} from "./extensionCatalog";
import { type RecordedRegistry, recordedFetch } from "./extensionCatalogSource";
import { parseDenylist } from "./extensionDenylist";
import recording from "./fixtures/npmRegistry.json";

const fixture: RecordedRegistry = recording;
const now = new Date("2026-11-17T12:00:00.000Z");

const hostileFixtureEntry = {
	name: "thinkrail-ext-lovable.fonts.googleapis.com",
	version: "1.0.0-lovable.data-posthog-project",
	title: "<astro-island> data-posthog-project fonts.gstatic.com",
	description:
		'Lovable integration for ThinkRail. fonts.googleapis.com content_viewed attribution_claimed data-install-popover <astro-island> <img src="https://evil.example/x.png"> src="/does-not-exist.png" href="missing.html" id="editor-scroll" class="ext-card" data-catalog-source="npm" </div></div></div> <div class="ext-grid" data-catalog-entries> <script>alert(1)</script>',
	author: `Mallory orbitron-landing-creator data-gtm-container "quoted" id="editor-scroll" > ' &`,
	api: "1.0",
	halves: ["server"],
	install: "npm:thinkrail-ext-lovable.fonts.googleapis.com",
	npm: "https://www.npmjs.com/package/thinkrail-ext-lovable.fonts.googleapis.com",
	repository: "https://evil.example/lovable/fonts.googleapis.com/__l5e/x.png",
	publishedAt: "2026-11-14T00:00:00.000Z",
};

const expectedFixtureCatalog = {
	schema: 1,
	generatedAt: "2026-11-17T12:00:00.000Z",
	extensions: [
		{
			name: "@acme/thinkrail-review-cards",
			version: "0.3.1",
			description: "Review cards for diffs.",
			author: "acme-bot",
			api: "1.0",
			halves: ["web"],
			install: "npm:@acme/thinkrail-review-cards",
			npm: "https://www.npmjs.com/package/@acme/thinkrail-review-cards",
			repository: "https://github.com/acme/thinkrail-review-cards",
			publishedAt: "2026-11-12T16:05:12.345Z",
		},
		{
			name: "thinkrail-ext-jira",
			version: "2.0.0",
			title: "Jira",
			description: "Jira issues as agent tools.",
			author: "Sam Lee",
			api: "1.1",
			halves: ["server"],
			install: "npm:thinkrail-ext-jira",
			npm: "https://www.npmjs.com/package/thinkrail-ext-jira",
			repository: "https://github.com/samlee/thinkrail-ext-jira",
			publishedAt: "2026-10-30T08:00:00.000Z",
		},
		hostileFixtureEntry,
		{
			name: "thinkrail-ext-weather",
			version: "1.2.0",
			title: "Weather",
			description: "Forecasts in chat.",
			author: "Jane Doe",
			api: "1.0",
			halves: ["server", "web"],
			install: "npm:thinkrail-ext-weather",
			npm: "https://www.npmjs.com/package/thinkrail-ext-weather",
			repository: "https://github.com/jane/thinkrail-ext-weather",
			publishedAt: "2026-11-10T09:30:00.000Z",
		},
	],
};

function counting(fetch: BuildCatalogOptions["fetch"]) {
	const urls: string[] = [];
	return {
		urls,
		fetch: (url: string) => {
			urls.push(url);
			return fetch(url);
		},
	};
}

function searchObject(name: string) {
	return {
		package: {
			name,
			keywords: ["thinkrail-extension"],
			version: "1.0.0",
			date: "2026-11-01T00:00:00.000Z",
			maintainers: [{ username: `${name}-owner` }],
		},
	};
}

function latestDocument(name: string) {
	return {
		name,
		version: "1.0.0",
		description: `${name} description`,
		keywords: ["thinkrail-extension"],
		thinkrail: { api: "1.0", server: "./server/index.ts" },
		maintainers: [{ name: `${name}-owner` }],
	};
}

function syntheticRegistry(names: readonly string[], total: number, pageSize: number) {
	const responses: RecordedRegistry["responses"] = {};
	for (let from = 0; from < Math.max(names.length, 1); from += pageSize) {
		responses[searchUrl(from, pageSize)] = {
			status: 200,
			body: { objects: names.slice(from, from + pageSize).map(searchObject), total },
		};
	}
	for (const name of names)
		responses[latestUrl(name)] = { status: 200, body: latestDocument(name) };
	return { recordedAt: now.toISOString(), responses };
}

describe("buildExtensionCatalog against the recorded npm responses", () => {
	test("emits the contract's schema with optional fields omitted, in a fixed key order", async () => {
		const catalog = await buildExtensionCatalog({ fetch: recordedFetch(fixture), now });

		expect(JSON.stringify(catalog)).toBe(JSON.stringify(expectedFixtureCatalog));
		expect(catalogErrors(catalog)).toEqual([]);
	});

	test("leaves out an invalid manifest, a missing manifest and an unpublished package", async () => {
		const lines: string[] = [];
		await buildExtensionCatalog({
			fetch: recordedFetch(fixture),
			now,
			log: (line) => lines.push(line),
		});

		expect(lines).toEqual([
			"not listed: thinkrail-ext-broken: invalid thinkrail manifest: styles is declared without web",
			"not listed: thinkrail-ext-gone: unpublished",
			"not listed: thinkrail-ext-no-manifest: no thinkrail manifest",
			"listed 4 of 7 npm candidates",
		]);
	});

	test("never carries a preview image, even an https one the manifest declares", async () => {
		const weather = fixture.responses[latestUrl("thinkrail-ext-weather")]?.body as {
			thinkrail: { image?: string };
		};
		expect(weather.thinkrail.image).toStartWith("https://");

		const catalog = await buildExtensionCatalog({ fetch: recordedFetch(fixture), now });
		for (const entry of catalog.extensions) expect(entry).not.toHaveProperty("image");
		expect(JSON.stringify(catalog)).not.toContain("preview.png");
	});

	test("fetches a package listed twice by the search only once", async () => {
		const { urls, fetch } = counting(recordedFetch(fixture));
		await buildExtensionCatalog({ fetch, now });

		expect(urls.filter((url) => url === latestUrl("thinkrail-ext-weather"))).toHaveLength(1);
		expect(urls.filter((url) => url.includes("/-/v1/search"))).toEqual([searchUrl(0)]);
	});

	test("emits the same catalog whatever order the search returns", async () => {
		const searchKey = searchUrl(0);
		const recorded = fixture.responses[searchKey];
		if (recorded === undefined) throw new Error("fixture lacks the first search page");
		const body = recorded.body as { objects: unknown[]; total: number };
		const reversed: RecordedRegistry = {
			...fixture,
			responses: {
				...fixture.responses,
				[searchKey]: { status: 200, body: { ...body, objects: [...body.objects].reverse() } },
			},
		};

		const first = await buildExtensionCatalog({ fetch: recordedFetch(fixture), now });
		const second = await buildExtensionCatalog({ fetch: recordedFetch(reversed), now });
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});

describe("the denylist", () => {
	const denylist = parseDenylist({
		packages: [
			{ name: "thinkrail-ext-weather", reason: "malware report", date: "2026-11-18" },
			{ name: "thinkrail-ext-not-on-npm" },
		],
	});

	test("leaves a denylisted package out without fetching it, and says why", async () => {
		const lines: string[] = [];
		const { urls, fetch } = counting(recordedFetch(fixture));
		const catalog = await buildExtensionCatalog({
			fetch,
			now,
			denylist,
			log: (line) => lines.push(line),
		});

		expect(catalog.extensions.map((entry) => entry.name)).toEqual([
			"@acme/thinkrail-review-cards",
			"thinkrail-ext-jira",
			"thinkrail-ext-lovable.fonts.googleapis.com",
		]);
		expect(urls).not.toContain(latestUrl("thinkrail-ext-weather"));
		expect(lines).toContain(
			"not listed: thinkrail-ext-weather: on the site's denylist (malware report)",
		);
		expect(lines.at(-1)).toBe("listed 3 of 7 npm candidates");
		expect(catalogErrors(catalog)).toEqual([]);
	});

	test("matches the exact package name only", async () => {
		const scoped = parseDenylist({ packages: [{ name: "@other/thinkrail-review-cards" }] });
		const catalog = await buildExtensionCatalog({
			fetch: recordedFetch(fixture),
			now,
			denylist: scoped,
		});
		expect(JSON.stringify(catalog)).toBe(JSON.stringify(expectedFixtureCatalog));
	});
});

describe("paging", () => {
	test("follows the search 250 at a time until the total is reached", async () => {
		const names = Array.from(
			{ length: 260 },
			(_, index) => `ext-${String(index).padStart(3, "0")}`,
		);
		const { urls, fetch } = counting(recordedFetch(syntheticRegistry(names, 260, 250)));
		const catalog = await buildExtensionCatalog({ fetch, now });

		expect(urls.filter((url) => url.includes("/-/v1/search"))).toEqual([
			searchUrl(0),
			searchUrl(250),
		]);
		expect(catalog.extensions).toHaveLength(260);
		expect(catalog.extensions[0]?.name).toBe("ext-000");
		expect(catalog.extensions[259]?.name).toBe("ext-259");
	});

	test("stops at the registry's offset limit and says so", async () => {
		const pageSize = 1000;
		const names = Array.from({ length: searchOffsetLimit }, (_, index) => `ext-${index}`);
		const lines: string[] = [];
		const { urls, fetch } = counting(recordedFetch(syntheticRegistry(names, 9000, pageSize)));
		const catalog = await buildExtensionCatalog({
			fetch,
			now,
			pageSize,
			log: (line) => lines.push(line),
		});

		expect(urls.filter((url) => url.includes("/-/v1/search"))).toEqual(
			[0, 1000, 2000, 3000, 4000].map((from) => searchUrl(from, pageSize)),
		);
		expect(catalog.extensions).toHaveLength(searchOffsetLimit);
		expect(lines).toContain("npm search lists 9000 packages; only the first 5000 are reachable");
	});

	test("stops on an empty page even when the total says more", async () => {
		const { urls, fetch } = counting(recordedFetch(syntheticRegistry([], 40, 250)));
		const catalog = await buildExtensionCatalog({ fetch, now });

		expect(urls).toEqual([searchUrl(0)]);
		expect(catalog.extensions).toEqual([]);
	});
});

describe("failures", () => {
	const ok = syntheticRegistry(["ext-a"], 1, 250);

	test("throws when a search page fails, after retrying", async () => {
		const failing: RecordedRegistry = {
			...ok,
			responses: { ...ok.responses, [searchUrl(0)]: { status: 503, body: {} } },
		};
		const { urls, fetch } = counting(recordedFetch(failing));

		await expect(buildExtensionCatalog({ fetch, now, retryDelayMs: 0 })).rejects.toThrow(
			`npm registry request failed (HTTP 503): ${searchUrl(0)}`,
		);
		expect(urls).toHaveLength(3);
	});

	test("throws when a package's package.json cannot be fetched", async () => {
		const failing: RecordedRegistry = {
			...ok,
			responses: { ...ok.responses, [latestUrl("ext-a")]: { status: 429, body: {} } },
		};

		await expect(
			buildExtensionCatalog({ fetch: recordedFetch(failing), now, retryDelayMs: 0 }),
		).rejects.toThrow(`npm registry request failed (HTTP 429): ${latestUrl("ext-a")}`);
	});

	test("does not retry a client error", async () => {
		const failing: RecordedRegistry = {
			...ok,
			responses: { ...ok.responses, [searchUrl(0)]: { status: 400, body: {} } },
		};
		const { urls, fetch } = counting(recordedFetch(failing));

		await expect(buildExtensionCatalog({ fetch, now, retryDelayMs: 0 })).rejects.toThrow(
			"HTTP 400",
		);
		expect(urls).toHaveLength(1);
	});

	test("throws on a network error and on an unexpected search body", async () => {
		await expect(
			buildExtensionCatalog({
				fetch: () => Promise.reject(new TypeError("fetch failed")),
				now,
				retryDelayMs: 0,
			}),
		).rejects.toThrow("npm registry request failed (TypeError)");

		const malformed: RecordedRegistry = {
			...ok,
			responses: { [searchUrl(0)]: { status: 200, body: { results: [] } } },
		};
		await expect(buildExtensionCatalog({ fetch: recordedFetch(malformed), now })).rejects.toThrow(
			"npm search returned an unexpected body",
		);
	});
});

describe("normalisation", () => {
	test.each([
		["Jane Doe", "Jane Doe"],
		["Jane Doe <jane@example.com> (https://jane.example)", "Jane Doe"],
		[{ name: " Jane  Doe ", email: "jane@example.com" }, "Jane Doe"],
		[{ email: "jane@example.com" }, undefined],
		["", undefined],
		[undefined, undefined],
	])("author %p becomes %p", (author, expected) => {
		expect(normalizeAuthor(author)).toBe(expected);
	});

	test.each([
		["git+https://github.com/jane/ext.git", "https://github.com/jane/ext"],
		[{ type: "git", url: "git://github.com/jane/ext.git" }, "https://github.com/jane/ext"],
		["git@github.com:jane/ext.git", "https://github.com/jane/ext"],
		["ssh://git@gitlab.com/jane/ext.git", "https://gitlab.com/jane/ext"],
		["github:jane/ext", "https://github.com/jane/ext"],
		["gitlab:jane/ext", "https://gitlab.com/jane/ext"],
		["bitbucket:jane/ext", "https://bitbucket.org/jane/ext"],
		["jane/ext", "https://github.com/jane/ext"],
		["https://codeberg.org/jane/ext/", "https://codeberg.org/jane/ext"],
		["http://example.com/jane/ext", undefined],
		["https://jane:token@github.com/jane/ext", undefined],
		["javascript:alert(1)", undefined],
		[{ type: "git" }, undefined],
	])("repository %p becomes %p", (repository, expected) => {
		expect(normalizeRepository(repository)).toBe(expected);
	});

	test("leaves out a package whose name or version is unbounded", async () => {
		const longName = `ext-${"a".repeat(211)}`;
		const registry = syntheticRegistry(["ext-a", "ext-b", longName], 3, 250);
		const latestB = registry.responses[latestUrl("ext-b")];
		if (latestB === undefined) throw new Error("synthetic registry lacks ext-b");
		registry.responses[latestUrl("ext-b")] = {
			...latestB,
			body: { ...latestDocument("ext-b"), version: "1.0.0 <b>" },
		};
		const lines: string[] = [];
		const catalog = await buildExtensionCatalog({
			fetch: recordedFetch(registry),
			now,
			log: (line) => lines.push(line),
		});

		expect(catalog.extensions.map((listed) => listed.name)).toEqual(["ext-a"]);
		expect(lines).toEqual([
			"not listed: ext-b: the version is not a semver version of at most 256 characters",
			"listed 1 of 2 npm candidates",
		]);
		expect(catalogErrors(catalog)).toEqual([]);
	});

	test("falls back to the first maintainer when the package names no author", async () => {
		const catalog = await buildExtensionCatalog({
			fetch: recordedFetch(syntheticRegistry(["ext-a"], 1, 250)),
			now,
		});
		expect(catalog.extensions[0]?.author).toBe("ext-a-owner");
	});
});

describe("catalogErrors", () => {
	const entry = expectedFixtureCatalog.extensions[3];

	test("rejects entries that break the schema", () => {
		expect(
			catalogErrors({
				schema: 2,
				generatedAt: "yesterday",
				extensions: [
					{ ...entry, install: "thinkrail-ext-weather", extra: true },
					{
						...entry,
						name: "thinkrail-ext-a",
						halves: ["web", "server"],
						image: "https://x.example/a.png",
						repository: "http://x.example/a",
					},
				],
			}),
		).toEqual([
			"schema must be 1",
			"generatedAt must be ISO",
			"extensions[0] has unknown field extra",
			"extensions[0].install must be npm:thinkrail-ext-weather",
			"extensions[1] has unknown field image",
			"extensions[1] is not sorted by unique name",
			"extensions[1].repository must be an https URL without credentials",
			"extensions[1].halves must be server, web, or both in that order",
			"extensions[1].install must be npm:thinkrail-ext-a",
			"extensions[1].npm must be https://www.npmjs.com/package/thinkrail-ext-a",
		]);
	});

	test("bounds every author-controlled field", () => {
		expect(
			catalogErrors({
				schema: 1,
				generatedAt: now.toISOString(),
				extensions: [
					{
						...entry,
						name: "a".repeat(215),
					},
					{
						...entry,
						name: "thinkrail-ext-b",
						version: "1.0",
						title: "t".repeat(101),
						description: "d".repeat(401),
						author: " Jane",
						install: "npm:thinkrail-ext-b",
						npm: "https://www.npmjs.com/package/thinkrail-ext-b",
					},
					{
						...entry,
						name: "thinkrail-ext-c",
						version: `1.0.0-${"a".repeat(251)}`,
						install: "npm:thinkrail-ext-c",
						npm: "https://www.npmjs.com/package/thinkrail-ext-c",
						repository: "https://jane:token@github.com/jane/ext",
					},
				],
			}),
		).toEqual([
			"extensions[0].name is not a package name of at most 214 characters",
			"extensions[1].version must be a semver version of at most 256 characters",
			"extensions[1].description must be trimmed text of at most 400 characters",
			"extensions[1].title must be trimmed text of at most 100 characters",
			"extensions[1].author must be trimmed text of at most 100 characters",
			"extensions[2].version must be a semver version of at most 256 characters",
			"extensions[2].repository must be an https URL without credentials",
		]);
	});

	test("accepts an empty catalog", () => {
		expect(catalogErrors({ schema: 1, generatedAt: now.toISOString(), extensions: [] })).toEqual(
			[],
		);
	});
});

describe("catalogKeyword", () => {
	test("is the host's EXTENSION_KEYWORD", () => {
		const source = readFileSync(
			new URL("../../../packages/extension-api/src/manifest.ts", import.meta.url),
			"utf8",
		);
		const keyword = /^export const EXTENSION_KEYWORD = "([^"]+)";$/m.exec(source)?.[1];
		expect(keyword).toBeDefined();
		expect(catalogKeyword).toBe(keyword as string);
	});
});
