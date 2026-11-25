import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { EXTENSION_API_VERSION, SDK_PACKAGE } from "../shared";
import { ExtensionBuildError } from "./errors";

export const EXTENSION_KEYWORD = "thinkrail-extension";

const MANIFEST_KEYS = ["api", "server", "web", "styles", "title", "image"] as const;
const HOST_SINGLETONS = /^(?:@earendil-works\/.+|typebox)$/;
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export interface ThinkrailManifest {
	api: string;
	server?: string;
	web?: string;
	styles?: string;
	title?: string;
	image?: string;
}

export interface ExtensionPackage {
	root: string;
	name: string;
	manifest: ThinkrailManifest;
	warnings: string[];
}

interface PackageJson {
	name?: unknown;
	keywords?: unknown;
	thinkrail?: unknown;
	dependencies?: Record<string, string>;
}

function fail(problems: string[]): never {
	throw new ExtensionBuildError(
		`package.json has an invalid "thinkrail" manifest:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
	);
}

function packagePath(path: string): string | undefined {
	if (path.includes("\\") || path.includes("\0") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) {
		return undefined;
	}
	if (path.startsWith("/")) return undefined;
	const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
	return segments.length > 0 && !segments.includes("..") ? segments.join("/") : undefined;
}

export function readExtensionPackage(root: string): ExtensionPackage {
	const path = join(root, "package.json");
	if (!existsSync(path)) {
		throw new ExtensionBuildError(
			`no package.json in ${root}: run the build from the extension's folder.`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ExtensionBuildError(
			`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ExtensionBuildError("package.json must hold a JSON object.");
	}
	const pkg = parsed as PackageJson;
	if (typeof pkg.name !== "string" || pkg.name.length === 0) {
		throw new ExtensionBuildError(
			'package.json needs a "name": it is the extension\'s identity in ThinkRail.',
		);
	}
	if (!PACKAGE_NAME.test(pkg.name)) {
		throw new ExtensionBuildError(
			`package.json "name" must be a valid npm package name (got "${pkg.name}").`,
		);
	}
	const raw = pkg.thinkrail;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ExtensionBuildError(
			`package.json has no "thinkrail" manifest. Add one, for example:\n  "thinkrail": { "api": "${EXTENSION_API_VERSION}", "server": "./server/index.ts", "web": "./dist/web.js", "styles": "./dist/web.css" }`,
		);
	}
	const fields = raw as Record<string, unknown>;
	const problems: string[] = [];
	const warnings: string[] = [];
	for (const key of Object.keys(fields)) {
		if (!(MANIFEST_KEYS as readonly string[]).includes(key)) {
			warnings.push(`"thinkrail.${key}" is not a manifest field and is ignored.`);
		}
	}
	for (const key of MANIFEST_KEYS) {
		if (fields[key] !== undefined && typeof fields[key] !== "string") {
			problems.push(`"${key}" must be a string.`);
		}
	}
	for (const key of ["title", "image"] as const) {
		if (typeof fields[key] === "string" && !fields[key].trim()) {
			problems.push(`"${key}" must not be empty.`);
		}
	}
	const manifest = fields as Partial<Record<(typeof MANIFEST_KEYS)[number], string>>;
	if (manifest.api === undefined) {
		problems.push(`"api" is required: set it to "${EXTENSION_API_VERSION}".`);
	} else if (!/^\d+\.\d+$/.test(manifest.api)) {
		problems.push(`"api" must be "major.minor" (for example "${EXTENSION_API_VERSION}").`);
	} else if (manifest.api !== EXTENSION_API_VERSION) {
		problems.push(
			`"api" is "${manifest.api}", but this ${SDK_PACKAGE} builds extension API ${EXTENSION_API_VERSION}: set "api" to "${EXTENSION_API_VERSION}" or install the SDK release for API ${manifest.api}.`,
		);
	}
	if (manifest.server === undefined && manifest.web === undefined) {
		problems.push('declare at least one of "server" and "web".');
	}
	if (manifest.styles !== undefined && manifest.web === undefined) {
		problems.push('"styles" is only allowed together with "web".');
	}
	const paths: Partial<Record<"server" | "web" | "styles", string>> = {};
	for (const key of ["server", "web", "styles"] as const) {
		const value = manifest[key];
		if (typeof value !== "string") continue;
		const path = packagePath(value);
		if (path === undefined) {
			problems.push(`"${key}" must be a relative path inside the package (got "${value}").`);
		} else paths[key] = path;
	}
	if (paths.server !== undefined && !/\.[cm]?[jt]s$/.test(paths.server)) {
		problems.push(
			`"server" must point at a TypeScript or JavaScript file (got "${manifest.server}").`,
		);
	}
	if (paths.web !== undefined && !/\.m?js$/.test(paths.web)) {
		problems.push(`"web" is the built bundle and must end in .js (got "${manifest.web}").`);
	}
	if (paths.styles !== undefined && !paths.styles.endsWith(".css")) {
		problems.push(`"styles" must end in .css (got "${manifest.styles}").`);
	}
	if (paths.server !== undefined) {
		if (!existsSync(join(root, paths.server))) {
			problems.push(`"server" points at ${manifest.server}, which does not exist.`);
		}
	}
	const bundled = Object.keys(pkg.dependencies ?? {})
		.filter((name) => HOST_SINGLETONS.test(name))
		.sort();
	if (bundled.length > 0) {
		problems.push(
			`${bundled.join(", ")} must be peerDependencies, not dependencies: ThinkRail provides its own copy, and a second one in the extension's node_modules breaks a server half and is dead weight for a web half.`,
		);
	}
	if (problems.length > 0) fail(problems);
	if (manifest.image !== undefined) {
		warnings.push('"image" is not used: neither the showcase nor ThinkRail shows preview images.');
	}
	const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
	if (!keywords.includes(EXTENSION_KEYWORD)) {
		warnings.push(
			`add "${EXTENSION_KEYWORD}" to "keywords" so the ThinkRail extension catalog lists the package once it is on npm.`,
		);
	}
	return { root, name: pkg.name, manifest: manifest as ThinkrailManifest, warnings };
}

export function displayPath(root: string, path: string): string {
	return relative(root, path) || ".";
}
