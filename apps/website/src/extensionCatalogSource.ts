import {
	buildExtensionCatalog,
	type ExtensionCatalog,
	type RegistryFetch,
} from "./extensionCatalog";
import recording from "./fixtures/npmRegistry.json";

export type CatalogSource = "npm" | "sample";

export interface LoadedCatalog {
	source: CatalogSource;
	catalog: ExtensionCatalog;
}

export interface RecordedRegistry {
	recordedAt: string;
	responses: Record<string, { status: number; body: unknown }>;
}

export function catalogSource(value: string | undefined): CatalogSource {
	if (value === undefined || value === "" || value === "sample") return "sample";
	if (value === "npm") return "npm";
	throw new Error(`EXTENSION_CATALOG_SOURCE must be "npm" or "sample", got "${value}"`);
}

export function recordedFetch(registry: RecordedRegistry): RegistryFetch {
	return async (url) => {
		const recorded = registry.responses[url];
		if (recorded === undefined) throw new Error(`No recorded npm response for ${url}`);
		return new Response(JSON.stringify(recorded.body), {
			status: recorded.status,
			headers: { "Content-Type": "application/json" },
		});
	};
}

const npmFetch: RegistryFetch = (url) =>
	fetch(url, {
		headers: { Accept: "application/json", "User-Agent": "thinkrail.ai extension catalog" },
		signal: AbortSignal.timeout(30_000),
	});

async function load(): Promise<LoadedCatalog> {
	const source = catalogSource(process.env.EXTENSION_CATALOG_SOURCE);
	const log = (line: string) => console.log(`[extension catalog] ${line}`);
	if (source === "npm") {
		return {
			source,
			catalog: await buildExtensionCatalog({ fetch: npmFetch, now: new Date(), log }),
		};
	}
	const catalog = await buildExtensionCatalog({
		fetch: recordedFetch(recording),
		now: new Date(recording.recordedAt),
	});
	return { source, catalog };
}

let loaded: Promise<LoadedCatalog> | undefined;

export function loadExtensionCatalog(): Promise<LoadedCatalog> {
	loaded ??= load();
	return loaded;
}
