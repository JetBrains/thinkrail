import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DefaultToolRenderer, getToolRenderer } from "../chat/toolRegistry";
import {
	EXTENSION_API_VERSION,
	extensionApiFit,
	followInstalledWebExtensions,
	type InstalledWebExtension,
	installExtensionHost,
	syncWebExtensions,
	webExtensionLoads,
} from "./index";
import { browserLoaderEnvironment, type LoaderEnvironment, setLoaderEnvironment } from "./loader";

const FIXTURES = new URL("./fixtures/", import.meta.url).href;

function environment(imports: string[]): LoaderEnvironment {
	return {
		baseUrl: () => FIXTURES,
		importModule: (url) => {
			imports.push(url.slice(FIXTURES.length));
			return import(url);
		},
		linkStylesheet: () => ({ ready: Promise.resolve(), remove: () => {} }),
		report: () => {},
	};
}

function source(initial: readonly InstalledWebExtension[] | null, unreachable = false) {
	let current = initial;
	let down = unreachable;
	const listeners = new Set<() => void>();
	return {
		source: {
			current: () => current,
			unreachable: () => down,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		set(next: readonly InstalledWebExtension[] | null, nextDown = false) {
			current = next;
			down = nextDown;
			for (const listener of listeners) listener();
		},
	};
}

beforeAll(() => {
	installExtensionHost();
});

afterEach(async () => {
	await syncWebExtensions([]);
	setLoaderEnvironment(browserLoaderEnvironment);
});

describe("syncWebExtensions", () => {
	test("loads new halves, keeps unchanged ones, reloads a changed URL and unloads what the host dropped", async () => {
		const imports: string[] = [];
		setLoaderEnvironment(environment(imports));
		await syncWebExtensions([{ name: "weather", url: "weather-v1.js" }]);
		expect(getToolRenderer("weather")).not.toBe(DefaultToolRenderer);
		await syncWebExtensions([{ name: "weather", url: "weather-v1.js" }]);
		expect(imports).toEqual(["weather-v1.js"]);
		await syncWebExtensions([{ name: "weather", url: "weather-v2.js" }]);
		expect(imports).toEqual(["weather-v1.js", "weather-v2.js"]);
		await syncWebExtensions([]);
		expect(webExtensionLoads().has("weather")).toBe(false);
		expect(getToolRenderer("weather")).toBe(DefaultToolRenderer);
	});
});

describe("followInstalledWebExtensions", () => {
	test("settles once the first known set has loaded and keeps following later sets", async () => {
		setLoaderEnvironment(environment([]));
		const feed = source(null);
		let settled = false;
		const ready = followInstalledWebExtensions(feed.source, 5_000).then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		feed.set([{ name: "weather", url: "weather-v1.js" }]);
		await ready;
		expect(webExtensionLoads().get("weather")?.status).toBe("loaded");
		feed.set(null);
		expect(webExtensionLoads().get("weather")?.status).toBe("loaded");
		feed.set([]);
		await Promise.resolve();
		expect(webExtensionLoads().has("weather")).toBe(false);
	});

	test("settles at once when the source is unreachable and within the wait otherwise", async () => {
		await followInstalledWebExtensions(source(null, true).source, 5_000);
		const started = Date.now();
		await followInstalledWebExtensions(source(null).source, 20);
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});

test("extensionApiFit says which side of the extension API rule an extension is on", () => {
	expect(EXTENSION_API_VERSION).toBe("1.0");
	expect(extensionApiFit("1.0")).toBe("compatible");
	expect(extensionApiFit("1.4")).toBe("needsNewerApp");
	expect(extensionApiFit("2.0")).toBe("needsNewerApp");
	expect(extensionApiFit("0.9")).toBe("builtForOlderApp");
	expect(extensionApiFit("one")).toBe("unknown");
	expect(extensionApiFit(undefined)).toBe("unknown");
});
