export type ExtensionHalf = "server" | "web";

export interface ExtensionManifest {
	api: string;
	server?: string;
	web?: string;
	styles?: string;
	title?: string;
	image?: string;
}

export type ExtensionManifestResult =
	| { ok: true; manifest: ExtensionManifest }
	| { ok: false; reason: string };

const apiVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function isPackageRelativePath(path: string): boolean {
	if (path.length === 0 || path.includes("\\") || path.includes("\0")) return false;
	if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path)) return false;
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment !== "..") segments.push(segment);
		else if (segments.pop() === undefined) return false;
	}
	return segments.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExtensionManifest(value: unknown): ExtensionManifestResult {
	if (!isRecord(value)) return { ok: false, reason: "the thinkrail manifest is not an object" };
	const { api, server, web, styles, title, image } = value;
	if (typeof api !== "string" || !apiVersion.test(api)) {
		return { ok: false, reason: "api must be a major.minor version string" };
	}
	const manifest: ExtensionManifest = { api };
	for (const [field, path] of [
		["server", server],
		["web", web],
		["styles", styles],
	] as const) {
		if (path === undefined) continue;
		if (typeof path !== "string" || !isPackageRelativePath(path)) {
			return { ok: false, reason: `${field} must be a relative path inside the package` };
		}
		manifest[field] = path;
	}
	if (manifest.server === undefined && manifest.web === undefined) {
		return { ok: false, reason: "declares neither server nor web" };
	}
	if (manifest.styles !== undefined && manifest.web === undefined) {
		return { ok: false, reason: "styles is declared without web" };
	}
	for (const [field, text] of [
		["title", title],
		["image", image],
	] as const) {
		if (text === undefined) continue;
		if (typeof text !== "string") return { ok: false, reason: `${field} must be a string` };
		manifest[field] = text;
	}
	return { ok: true, manifest };
}

export function manifestHalves(manifest: ExtensionManifest): ExtensionHalf[] {
	return (["server", "web"] as const).filter((half) => manifest[half] !== undefined);
}
