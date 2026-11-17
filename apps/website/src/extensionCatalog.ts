import { type ExtensionHalf, manifestHalves, parseExtensionManifest } from "./extensionManifest";

const catalogKeyword = "thinkrail-extension";
const searchPageSize = 250;
export const searchOffsetLimit = 5000;
const registryOrigin = "https://registry.npmjs.org";
const maxTitleLength = 100;
const maxDescriptionLength = 400;
const fetchAttempts = 3;

export interface CatalogEntry {
	name: string;
	version: string;
	title?: string;
	description: string;
	author?: string;
	api: string;
	halves: ExtensionHalf[];
	image?: string;
	install: string;
	npm: string;
	repository?: string;
	publishedAt: string;
}

export interface ExtensionCatalog {
	schema: 1;
	generatedAt: string;
	extensions: CatalogEntry[];
}

export type RegistryFetch = (url: string) => Promise<Response>;

export interface BuildCatalogOptions {
	fetch: RegistryFetch;
	now: Date;
	pageSize?: number;
	retryDelayMs?: number;
	log?: (line: string) => void;
}

interface SearchHit {
	name: string;
	date: string | undefined;
	maintainer: string | undefined;
}

type EntryResult = { entry: CatalogEntry } | { rejected: string };

const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length === 0) return undefined;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function isoDate(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function searchUrl(from: number, size = searchPageSize): string {
	return `${registryOrigin}/-/v1/search?text=keywords%3A${catalogKeyword}&size=${size}&from=${from}`;
}

export function latestUrl(name: string): string {
	return `${registryOrigin}/${name.replace("/", "%2F")}/latest`;
}

function npmPageUrl(name: string): string {
	return `https://www.npmjs.com/package/${name}`;
}

function httpsUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" && url.hostname !== "" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export function normalizeAuthor(value: unknown): string | undefined {
	const raw = isRecord(value) ? value.name : value;
	if (typeof raw !== "string") return undefined;
	return nonEmptyText(raw.replace(/<[^>]*>/g, "").replace(/\([^)]*\)/g, ""), maxTitleLength);
}

const repositoryHosts: Record<string, string> = {
	github: "github.com",
	gitlab: "gitlab.com",
	bitbucket: "bitbucket.org",
};

export function normalizeRepository(value: unknown): string | undefined {
	const raw = isRecord(value) ? value.url : value;
	if (typeof raw !== "string") return undefined;
	let url = raw.trim();
	const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(url);
	if (shorthand?.[2]) {
		url = `https://${repositoryHosts[shorthand[1] ?? "github"]}/${shorthand[2]}`;
	}
	url = url
		.replace(/^git\+/, "")
		.replace(/^git@([^:/]+):/, "https://$1/")
		.replace(/^(?:git|ssh):\/\/(?:[^@/]+@)?/, "https://")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
	return httpsUrl(url)?.replace(/\/+$/, "");
}

function firstMaintainer(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	const [first] = value;
	return isRecord(first) ? nonEmptyText(first.name ?? first.username, maxTitleLength) : undefined;
}

function catalogEntry(pkg: unknown, hit: SearchHit): EntryResult {
	if (!isRecord(pkg)) return { rejected: "the latest package.json is not an object" };
	if (pkg.name !== hit.name) return { rejected: "the latest package.json names another package" };
	if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes(catalogKeyword)) {
		return { rejected: `the latest version lacks the ${catalogKeyword} keyword` };
	}
	if (!("thinkrail" in pkg)) return { rejected: "no thinkrail manifest" };
	const parsed = parseExtensionManifest(pkg.thinkrail);
	if (!parsed.ok) return { rejected: `invalid thinkrail manifest: ${parsed.reason}` };
	if (typeof pkg.version !== "string" || pkg.version.length === 0) {
		return { rejected: "no version" };
	}
	const publishedAt = isoDate(hit.date);
	if (publishedAt === undefined) return { rejected: "no publish date" };

	const { manifest } = parsed;
	const title = nonEmptyText(manifest.title, maxTitleLength);
	const author = normalizeAuthor(pkg.author) ?? firstMaintainer(pkg.maintainers) ?? hit.maintainer;
	const image = httpsUrl(manifest.image);
	const repository = normalizeRepository(pkg.repository);
	return {
		entry: {
			name: hit.name,
			version: pkg.version,
			...(title === undefined ? {} : { title }),
			description: nonEmptyText(pkg.description, maxDescriptionLength) ?? "",
			...(author === undefined ? {} : { author }),
			api: manifest.api,
			halves: manifestHalves(manifest),
			...(image === undefined ? {} : { image }),
			install: `npm:${hit.name}`,
			npm: npmPageUrl(hit.name),
			...(repository === undefined ? {} : { repository }),
			publishedAt,
		},
	};
}

function delay(ms: number): Promise<void> {
	return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function registryResponse(
	options: BuildCatalogOptions,
	url: string,
	allowMissing: boolean,
): Promise<Response | undefined> {
	let failure = "";
	for (let attempt = 1; attempt <= fetchAttempts; attempt++) {
		try {
			const response = await options.fetch(url);
			if (response.ok) return response;
			if (allowMissing && response.status === 404) return undefined;
			failure = `HTTP ${response.status}`;
			if (response.status < 500 && response.status !== 429) break;
		} catch (error) {
			failure = error instanceof Error ? error.name : "network error";
		}
		if (attempt < fetchAttempts) await delay((options.retryDelayMs ?? 1000) * attempt);
	}
	throw new Error(`npm registry request failed (${failure}): ${url}`);
}

async function searchHits(options: BuildCatalogOptions): Promise<SearchHit[]> {
	const pageSize = options.pageSize ?? searchPageSize;
	const hits = new Map<string, SearchHit>();
	let total = 0;
	for (let from = 0; from < searchOffsetLimit; from += pageSize) {
		const response = await registryResponse(options, searchUrl(from, pageSize), false);
		const page: unknown = await response?.json();
		if (!isRecord(page) || !Array.isArray(page.objects) || typeof page.total !== "number") {
			throw new Error(`npm search returned an unexpected body: ${searchUrl(from, pageSize)}`);
		}
		total = page.total;
		for (const object of page.objects) {
			const pkg = isRecord(object) ? object.package : undefined;
			if (!isRecord(pkg) || typeof pkg.name !== "string" || !packageName.test(pkg.name)) continue;
			if (hits.has(pkg.name)) continue;
			hits.set(pkg.name, {
				name: pkg.name,
				date: typeof pkg.date === "string" ? pkg.date : undefined,
				maintainer: firstMaintainer(pkg.maintainers),
			});
		}
		if (page.objects.length === 0 || from + pageSize >= total) break;
	}
	if (total > searchOffsetLimit) {
		options.log?.(
			`npm search lists ${total} packages; only the first ${searchOffsetLimit} are reachable`,
		);
	}
	return [...hits.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function mapLimited<In, Out>(
	items: readonly In[],
	limit: number,
	map: (item: In) => Promise<Out>,
): Promise<Out[]> {
	const results: Out[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await map(items[index] as In);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

export async function buildExtensionCatalog(
	options: BuildCatalogOptions,
): Promise<ExtensionCatalog> {
	const hits = await searchHits(options);
	const results = await mapLimited(hits, 8, async (hit) => {
		const response = await registryResponse(options, latestUrl(hit.name), true);
		if (response === undefined) return { name: hit.name, result: { rejected: "unpublished" } };
		return { name: hit.name, result: catalogEntry(await response.json(), hit) };
	});
	const extensions: CatalogEntry[] = [];
	for (const { name, result } of results) {
		if ("entry" in result) extensions.push(result.entry);
		else options.log?.(`not listed: ${name}: ${result.rejected}`);
	}
	options.log?.(`listed ${extensions.length} of ${hits.length} npm candidates`);
	return { schema: 1, generatedAt: options.now.toISOString(), extensions };
}

const entryKeys = new Set([
	"name",
	"version",
	"title",
	"description",
	"author",
	"api",
	"halves",
	"image",
	"install",
	"npm",
	"repository",
	"publishedAt",
]);

export function catalogErrors(value: unknown): string[] {
	if (!isRecord(value)) return ["catalog is not an object"];
	const errors: string[] = [];
	if (value.schema !== 1) errors.push("schema must be 1");
	if (isoDate(value.generatedAt) !== value.generatedAt) errors.push("generatedAt must be ISO");
	if (!Array.isArray(value.extensions)) return [...errors, "extensions must be an array"];
	let previous = "";
	value.extensions.forEach((entry: unknown, index) => {
		const at = `extensions[${index}]`;
		if (!isRecord(entry)) {
			errors.push(`${at} is not an object`);
			return;
		}
		for (const key of Object.keys(entry)) {
			if (!entryKeys.has(key)) errors.push(`${at} has unknown field ${key}`);
		}
		const { name } = entry;
		if (typeof name !== "string" || !packageName.test(name)) {
			errors.push(`${at}.name is not a package name`);
			return;
		}
		if (name <= previous) errors.push(`${at} is not sorted by unique name`);
		previous = name;
		for (const key of ["version", "description", "api"] as const) {
			if (typeof entry[key] !== "string") errors.push(`${at}.${key} must be a string`);
		}
		for (const key of ["title", "author"] as const) {
			if (entry[key] !== undefined && typeof entry[key] !== "string") {
				errors.push(`${at}.${key} must be a string`);
			}
		}
		for (const key of ["image", "repository"] as const) {
			if (entry[key] !== undefined && httpsUrl(entry[key]) === undefined) {
				errors.push(`${at}.${key} must be an https URL`);
			}
		}
		const halves = entry.halves;
		if (!Array.isArray(halves) || !["server", "web", "server,web"].includes(halves.join(","))) {
			errors.push(`${at}.halves must be server, web, or both in that order`);
		}
		if (entry.install !== `npm:${name}`) errors.push(`${at}.install must be npm:${name}`);
		if (entry.npm !== npmPageUrl(name)) errors.push(`${at}.npm must be ${npmPageUrl(name)}`);
		if (isoDate(entry.publishedAt) !== entry.publishedAt) {
			errors.push(`${at}.publishedAt must be ISO`);
		}
	});
	return errors;
}
