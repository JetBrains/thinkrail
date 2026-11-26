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

const apiVersion = /^\d+\.\d+$/;
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const pathSuffixes = {
	server: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
	web: [".js", ".mjs"],
	styles: [".css"],
} as const;

export function isPackageName(value: unknown): value is string {
	return typeof value === "string" && packageName.test(value);
}

export function packagePath(path: string): string | undefined {
	if (path.includes("\\") || path.includes("\0")) return undefined;
	if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
	const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
	return segments.length > 0 && !segments.includes("..") ? segments.join("/") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExtensionManifest(pkg: unknown): ExtensionManifestResult {
	if (!isRecord(pkg)) return { ok: false, reason: "the package.json is not an object" };
	if (!isPackageName(pkg.name)) return { ok: false, reason: "the package name is not valid" };
	const value = pkg.thinkrail;
	if (!isRecord(value)) return { ok: false, reason: "the thinkrail manifest is not an object" };
	const { api, title, image } = value;
	if (typeof api !== "string" || !apiVersion.test(api)) {
		return { ok: false, reason: "api must be a major.minor version string" };
	}
	const manifest: ExtensionManifest = { api };
	for (const field of ["server", "web", "styles"] as const) {
		const path = value[field];
		if (path === undefined) continue;
		const normalized = typeof path === "string" ? packagePath(path) : undefined;
		if (typeof path !== "string" || normalized === undefined) {
			return { ok: false, reason: `${field} must be a relative path inside the package` };
		}
		if (!pathSuffixes[field].some((suffix) => normalized.endsWith(suffix))) {
			return { ok: false, reason: `${field} must name a ${pathSuffixes[field].join(" or ")} file` };
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
		if (typeof text !== "string" || text.trim() === "") {
			return { ok: false, reason: `${field} must be a non-empty string` };
		}
		manifest[field] = text;
	}
	return { ok: true, manifest };
}

export function manifestHalves(manifest: ExtensionManifest): ExtensionHalf[] {
	return (["server", "web"] as const).filter((half) => manifest[half] !== undefined);
}
