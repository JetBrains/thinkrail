export const EXTENSION_API_VERSION = "1.0";

export const EXTENSION_KEYWORD = "thinkrail-extension";

export const EXTENSION_MANIFEST_KEY = "thinkrail";

export interface ExtensionManifest {
	name: string;
	version?: string;
	description?: string;
	author?: string;
	api: string;
	server?: string;
	web?: string;
	styles?: string;
	title?: string;
	image?: string;
}

export type ExtensionManifestResult =
	| { ok: true; manifest: ExtensionManifest }
	| { ok: false; error: string };

export interface ExtensionManifestOptions {
	reservedNames?: Iterable<string>;
}

const API_VERSION = /^(\d+)\.(\d+)$/;
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function hasExtensionManifest(packageJson: unknown): boolean {
	return isRecord(packageJson) && EXTENSION_MANIFEST_KEY in packageJson;
}

export function normalizeManifestPath(path: string): string | undefined {
	if (path.includes("\\") || path.includes("\0") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) {
		return undefined;
	}
	if (path.startsWith("/")) return undefined;
	const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.length === 0 || segments.includes("..")) return undefined;
	return segments.join("/");
}

function authorOf(author: unknown): string | undefined {
	if (typeof author === "string" && author.trim()) return author.trim();
	if (isRecord(author) && typeof author.name === "string" && author.name.trim()) {
		return author.name.trim();
	}
	return undefined;
}

function optionalText(fields: Fields, key: string): string | undefined | Error {
	const value = fields[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim())
		return new Error(`"${key}" must be a non-empty string`);
	return value.trim();
}

function entryPath(
	fields: Fields,
	key: "server" | "web" | "styles",
	suffixes: readonly string[],
): string | undefined | Error {
	const value = fields[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") return new Error(`"${key}" must be a path`);
	const normalized = normalizeManifestPath(value);
	if (normalized === undefined) {
		return new Error(`"${key}" must be a relative path that stays inside the package`);
	}
	if (!suffixes.some((suffix) => normalized.endsWith(suffix))) {
		return new Error(`"${key}" must name a ${suffixes.join(" or ")} file`);
	}
	return normalized;
}

export function parseExtensionManifest(
	packageJson: unknown,
	options: ExtensionManifestOptions = {},
): ExtensionManifestResult {
	const fail = (error: string): ExtensionManifestResult => ({ ok: false, error });
	if (!isRecord(packageJson)) return fail("package.json is not an object");
	const { name } = packageJson;
	if (typeof name !== "string" || !PACKAGE_NAME.test(name)) {
		return fail("package.json needs a valid npm package name");
	}
	if (new Set(options.reservedNames ?? []).has(name)) {
		return fail(`"${name}" is the name of a built-in extension`);
	}
	const fields = packageJson[EXTENSION_MANIFEST_KEY];
	if (!isRecord(fields)) return fail(`"${EXTENSION_MANIFEST_KEY}" must be an object`);
	const { api } = fields;
	if (typeof api !== "string" || !API_VERSION.test(api)) {
		return fail(`"api" must be a "major.minor" version such as "${EXTENSION_API_VERSION}"`);
	}
	const server = entryPath(fields, "server", [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
	const web = entryPath(fields, "web", [".js", ".mjs"]);
	const styles = entryPath(fields, "styles", [".css"]);
	const title = optionalText(fields, "title");
	const image = optionalText(fields, "image");
	for (const value of [server, web, styles, title, image]) {
		if (value instanceof Error) return fail(value.message);
	}
	if (server === undefined && web === undefined) return fail('declare "server", "web" or both');
	if (styles !== undefined && web === undefined) return fail('"styles" needs a "web" half');
	const version = typeof packageJson.version === "string" ? packageJson.version : undefined;
	const description =
		typeof packageJson.description === "string" && packageJson.description.trim()
			? packageJson.description.trim()
			: undefined;
	const author = authorOf(packageJson.author);
	const manifest: ExtensionManifest = { name, api };
	if (version) manifest.version = version;
	if (description) manifest.description = description;
	if (author) manifest.author = author;
	if (typeof server === "string") manifest.server = server;
	if (typeof web === "string") manifest.web = web;
	if (typeof styles === "string") manifest.styles = styles;
	if (typeof title === "string") manifest.title = title;
	if (typeof image === "string") manifest.image = image;
	return { ok: true, manifest };
}

export function extensionApiMismatch(
	api: string,
	host: string = EXTENSION_API_VERSION,
): string | undefined {
	const wanted = API_VERSION.exec(api);
	const own = API_VERSION.exec(host);
	if (!wanted || !own) return `extension API "${api}" is not a "major.minor" version`;
	if (Number(wanted[1]) !== Number(own[1])) {
		return `built for extension API ${api}; this ThinkRail supports ${host}`;
	}
	if (Number(wanted[2]) > Number(own[2])) {
		return `built for extension API ${api}, newer than this ThinkRail's ${host}; update ThinkRail`;
	}
	return undefined;
}

export function isExtensionApiCompatible(
	api: string,
	host: string = EXTENSION_API_VERSION,
): boolean {
	return extensionApiMismatch(api, host) === undefined;
}
