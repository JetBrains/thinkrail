import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
	ExtensionBrowseResult,
	ExtensionHalf,
	ExtensionListing,
	WsErrorCode,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export const EXTENSION_CATALOG_URL = "https://thinkrail.ai/extensions/catalog.json";
export const EXTENSION_CATALOG_URL_ENV = "THINKRAIL_EXTENSION_CATALOG_URL";
export const CATALOG_CACHE_MS = 5 * 60_000;
export const CATALOG_TIMEOUT_MS = 8_000;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

export interface ExtensionCatalog {
	generatedAt: string;
	extensions: ExtensionListing[];
}

export interface CatalogSourceOptions {
	url?: string;
	fetch?: typeof fetch;
	now?: () => number;
	offline?: () => boolean;
}

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const HALVES: ReadonlySet<string> = new Set<ExtensionHalf>(["server", "web"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function isoDate(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function optionalString(entry: Record<string, unknown>, key: string): boolean {
	return entry[key] === undefined || (typeof entry[key] === "string" && entry[key] !== "");
}

function listingOf(entry: unknown): ExtensionListing | null {
	if (!isRecord(entry)) return null;
	const { name, version, description, api, halves, install, npm, publishedAt } = entry;
	if (typeof name !== "string" || name.length > 214 || !PACKAGE_NAME.test(name)) return null;
	if (typeof version !== "string" || version === "") return null;
	if (typeof description !== "string" || typeof api !== "string" || api === "") return null;
	if (!optionalString(entry, "title") || !optionalString(entry, "author")) return null;
	if (!Array.isArray(halves) || halves.length === 0) return null;
	if (!halves.every((half) => typeof half === "string" && HALVES.has(half))) return null;
	if (new Set(halves).size !== halves.length) return null;
	if (install !== `npm:${name}` || !httpsUrl(npm) || !isoDate(publishedAt)) return null;
	if (entry.image !== undefined && !httpsUrl(entry.image)) return null;
	if (entry.repository !== undefined && !httpsUrl(entry.repository)) return null;
	return {
		name,
		version,
		...(typeof entry.title === "string" ? { title: entry.title } : {}),
		description,
		...(typeof entry.author === "string" ? { author: entry.author } : {}),
		api,
		halves: halves as ExtensionHalf[],
		...(typeof entry.image === "string" ? { image: entry.image } : {}),
		install,
		npm,
		...(typeof entry.repository === "string" ? { repository: entry.repository } : {}),
		publishedAt,
	};
}

/** The whole file or nothing: it is our own build's output, so any bad shape is a broken publish. */
export function parseExtensionCatalog(value: unknown): ExtensionCatalog | null {
	if (!isRecord(value) || value.schema !== 1 || !isoDate(value.generatedAt)) return null;
	if (!Array.isArray(value.extensions)) return null;
	const extensions: ExtensionListing[] = [];
	const names = new Set<string>();
	for (const entry of value.extensions) {
		const listing = listingOf(entry);
		if (!listing || names.has(listing.name)) return null;
		names.add(listing.name);
		extensions.push(listing);
	}
	return { generatedAt: value.generatedAt, extensions };
}

function isOffline(): boolean {
	const value = process.env.PI_OFFLINE?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function fail(code: WsErrorCode, message: string): CodedError {
	return new CodedError(code, message);
}

function tooLarge(): CodedError {
	return fail("EXTENSION_CATALOG_INVALID", "The extension catalog is too large.");
}

async function readRemote(url: string, fetcher: typeof fetch): Promise<string> {
	let response: Response;
	try {
		response = await fetcher(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
			redirect: "follow",
		});
	} catch {
		throw fail("EXTENSION_CATALOG_UNREACHABLE", "The extension catalog could not be reached.");
	}
	if (!response.ok) {
		throw fail(
			"EXTENSION_CATALOG_UNREACHABLE",
			`The extension catalog answered HTTP ${response.status}.`,
		);
	}
	const declared = Number(response.headers.get("content-length"));
	if (declared > MAX_CATALOG_BYTES) throw tooLarge();
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	for (;;) {
		let chunk: Awaited<ReturnType<typeof reader.read>>;
		try {
			chunk = await reader.read();
		} catch {
			throw fail("EXTENSION_CATALOG_UNREACHABLE", "The extension catalog could not be read.");
		}
		if (chunk.done) break;
		bytes += chunk.value.byteLength;
		if (bytes > MAX_CATALOG_BYTES) {
			await reader.cancel().catch(() => {});
			throw tooLarge();
		}
		chunks.push(chunk.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readLocal(url: URL): Promise<string> {
	let size: number;
	try {
		size = (await stat(fileURLToPath(url))).size;
	} catch {
		throw fail("EXTENSION_CATALOG_UNREACHABLE", "The extension catalog file could not be read.");
	}
	if (size > MAX_CATALOG_BYTES) throw tooLarge();
	try {
		return await readFile(fileURLToPath(url), "utf8");
	} catch {
		throw fail("EXTENSION_CATALOG_UNREACHABLE", "The extension catalog file could not be read.");
	}
}

export function catalogUrl(override: string | undefined = process.env[EXTENSION_CATALOG_URL_ENV]) {
	return override?.trim() || EXTENSION_CATALOG_URL;
}

/** One fetched copy, kept for `CATALOG_CACHE_MS`; concurrent reads share one request, a failure is not cached. */
export class ExtensionCatalogSource {
	readonly #options: CatalogSourceOptions;
	#cached: { catalog: ExtensionCatalog; at: number } | null = null;
	#inflight: Promise<ExtensionCatalog> | null = null;

	constructor(options: CatalogSourceOptions = {}) {
		this.#options = options;
	}

	read({ force = false }: { force?: boolean } = {}): Promise<ExtensionCatalog> {
		const now = this.#options.now?.() ?? Date.now();
		if (!force && this.#cached && now - this.#cached.at < CATALOG_CACHE_MS) {
			return Promise.resolve(this.#cached.catalog);
		}
		if (this.#inflight) return this.#inflight;
		const pending = this.#fetch().then((catalog) => {
			this.#cached = { catalog, at: this.#options.now?.() ?? Date.now() };
			return catalog;
		});
		this.#inflight = pending;
		const clear = () => {
			if (this.#inflight === pending) this.#inflight = null;
		};
		pending.then(clear, clear);
		return pending;
	}

	async #fetch(): Promise<ExtensionCatalog> {
		const raw = this.#options.url ?? catalogUrl();
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw fail("EXTENSION_CATALOG_UNREACHABLE", "The extension catalog address is not a URL.");
		}
		let text: string;
		if (url.protocol === "file:") {
			text = await readLocal(url);
		} else if (url.protocol === "https:" || url.protocol === "http:") {
			if ((this.#options.offline ?? isOffline)()) {
				throw fail("EXTENSION_CATALOG_OFFLINE", "ThinkRail is in offline mode (PI_OFFLINE).");
			}
			text = await readRemote(url.href, this.#options.fetch ?? fetch);
		} else {
			throw fail(
				"EXTENSION_CATALOG_UNREACHABLE",
				"The extension catalog address is not supported.",
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw fail("EXTENSION_CATALOG_INVALID", "The extension catalog is not valid JSON.");
		}
		const catalog = parseExtensionCatalog(parsed);
		if (!catalog) {
			throw fail(
				"EXTENSION_CATALOG_INVALID",
				"The extension catalog does not have the expected shape.",
			);
		}
		return catalog;
	}
}

let shared: ExtensionCatalogSource | null = null;

export function extensionCatalogSource(): ExtensionCatalogSource {
	shared ??= new ExtensionCatalogSource();
	return shared;
}

export function resetExtensionCatalogSourceForTests(next: ExtensionCatalogSource | null): void {
	shared = next;
}

/** `extensions.browse`: the catalog with each listing marked when an installed extension has its name. */
export async function browseExtensions(
	installedNames: ReadonlySet<string>,
	options: { force?: boolean; source?: ExtensionCatalogSource } = {},
): Promise<ExtensionBrowseResult> {
	const catalog = await (options.source ?? extensionCatalogSource()).read({
		force: options.force === true,
	});
	return {
		generatedAt: catalog.generatedAt,
		extensions: catalog.extensions.map((listing) => ({
			...listing,
			installed: installedNames.has(listing.name),
		})),
	};
}
