import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { EXTENSION_ASSETS_ROUTE, type ExtensionWebHalf } from "@thinkrail/contracts";
import type { InstalledExtensionRecord } from "./runtime";

export interface ExtensionAsset {
	path: string;
	contentType: string;
}

const CONTENT_TYPES = { web: "text/javascript; charset=utf-8", styles: "text/css; charset=utf-8" };

function statKey(path: string): string {
	const info = statSync(path);
	return `${info.mtimeMs}:${info.size}`;
}

export function webToken(record: InstalledExtensionRecord): string | undefined {
	const { root, manifest } = record;
	if (!root || !manifest?.web) return undefined;
	try {
		const hash = createHash("sha256");
		for (const file of [manifest.web, manifest.styles]) {
			if (file) hash.update(`${file}\0${statKey(join(root, file))}\0`);
		}
		return `${manifest.version ?? "0.0.0"}-${hash.digest("hex").slice(0, 12)}`;
	} catch {
		return undefined;
	}
}

function assetUrl(name: string, token: string, file: string): string {
	const path = file.split("/").map(encodeURIComponent).join("/");
	return `${EXTENSION_ASSETS_ROUTE}${encodeURIComponent(name)}/${encodeURIComponent(token)}/${path}`;
}

export function webHalfOf(record: InstalledExtensionRecord): ExtensionWebHalf | undefined {
	if (record.state !== "loaded" || !record.manifest?.web) return undefined;
	const token = webToken(record);
	if (token === undefined) return undefined;
	const { web, styles } = record.manifest;
	return {
		url: assetUrl(record.name, token, web),
		...(styles ? { styles: assetUrl(record.name, token, styles) } : {}),
	};
}

function decodeSegments(rest: string): string[] | undefined {
	try {
		return rest.split("/").map((segment) => decodeURIComponent(segment));
	} catch {
		return undefined;
	}
}

function staysInside(root: string, file: string): boolean {
	try {
		const rel = relative(realpathSync(root), realpathSync(file));
		return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
	} catch {
		return false;
	}
}

export function resolveExtensionAsset(
	records: readonly InstalledExtensionRecord[],
	pathname: string,
): ExtensionAsset | undefined {
	if (!pathname.startsWith(EXTENSION_ASSETS_ROUTE)) return undefined;
	const segments = decodeSegments(pathname.slice(EXTENSION_ASSETS_ROUTE.length));
	if (!segments || segments.length < 3) return undefined;
	const [name, token, ...fileSegments] = segments;
	const file = fileSegments.join("/");
	const record = records.find((entry) => entry.name === name && entry.state === "loaded");
	if (!record?.root || !record.manifest) return undefined;
	const kind =
		file === record.manifest.web ? "web" : file === record.manifest.styles ? "styles" : undefined;
	if (kind === undefined || webToken(record) !== token) return undefined;
	const path = join(record.root, file);
	if (!staysInside(record.root, path)) return undefined;
	return { path, contentType: CONTENT_TYPES[kind] };
}
