import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	DefaultPackageManager,
	DefaultResourceLoader,
	type ResolvedResource,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	PiBuiltinExtension,
	PiLooseExtension,
	PiPackageResource,
	PiPackageResourceType,
	PiPackageScope,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import { npmPackageName, piPackageIdentity, piPackageSourceKind } from "./identity";

const BUILTIN_PREFIX = "builtin:";
const RESOURCE_TYPES: readonly PiPackageResourceType[] = ["extensions", "skills", "prompts"];
const CATALOG_TTL_MS = 5_000;

export interface PiPackageCatalogOptions {
	/** The workspace path; absent → user scope only, no repository resources. */
	cwd?: string;
	agentDir: string;
	projectTrusted: boolean;
	/** The built-in extension names the host supplies (`mcp`, `tool-search`). */
	builtinExtensions: readonly string[];
	/** Extension paths the host never shows or loads (the Central artifact). */
	excludedExtensionPaths?: readonly string[];
	disabledPackages: ReadonlySet<string>;
}

interface LoadedExtensionInfo {
	tools?: string[];
	commands?: string[];
	error?: string;
}

const cache = new Map<string, { at: number; value: Promise<PiPackagesCatalog> }>();

export function invalidatePiPackageCatalog(): void {
	cache.clear();
}

export function listPiPackageCatalog(options: PiPackageCatalogOptions): Promise<PiPackagesCatalog> {
	const key = JSON.stringify([
		options.cwd ?? null,
		options.agentDir,
		options.projectTrusted,
		[...options.builtinExtensions],
		[...(options.excludedExtensionPaths ?? [])].map((path) => resolve(path)).sort(),
		[...options.disabledPackages].sort(),
	]);
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.value;
	const value = buildCatalog(options);
	cache.set(key, { at: Date.now(), value });
	value.catch(() => cache.delete(key));
	return value;
}

export function packageSourceIdentity(
	source: string,
	scope: PiPackageScope,
	cwd: string | undefined,
	agentDir: string,
): string {
	const baseDir = scope === "project" && cwd ? join(cwd, ".pi") : agentDir;
	return piPackageIdentity(source, (path) => resolve(baseDir, expandHome(path)));
}

function expandHome(path: string): string {
	if (path === "~") return process.env.HOME ?? path;
	if (path.startsWith("~/")) return join(process.env.HOME ?? "~", path.slice(2));
	return path;
}

async function buildCatalog(options: PiPackageCatalogOptions): Promise<PiPackagesCatalog> {
	const { agentDir, projectTrusted } = options;
	const cwd = options.cwd ?? agentDir;
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
		builtinExtensions: [...options.builtinExtensions],
	});
	const resolved = await packageManager.resolve(async () => "skip");
	const excluded = new Set((options.excludedExtensionPaths ?? []).map((path) => resolve(path)));
	const isExcluded = (path: string) => excluded.has(resolve(path));

	const packages = new Map<string, PiPackageSummary>();
	const loose: PiLooseExtension[] = [];
	const builtins: PiBuiltinExtension[] = [];
	const packageOf = (resource: ResolvedResource): PiPackageSummary | undefined => {
		const { metadata } = resource;
		if (metadata.origin !== "package") return undefined;
		const scope: PiPackageScope = metadata.scope === "project" ? "project" : "user";
		const key = `${scope}\0${metadata.source}`;
		const existing = packages.get(key);
		if (existing) return existing;
		const installedPath =
			metadata.packageRoot ?? packageManager.getInstalledPath(metadata.source, scope);
		if (!installedPath) return undefined;
		const summary: PiPackageSummary = {
			identity: packageSourceIdentity(metadata.source, scope, options.cwd, agentDir),
			source: metadata.source,
			kind: piPackageSourceKind(metadata.source),
			scope,
			...readPackageMetadata(installedPath, metadata.source),
			installedPath,
			enabled: true,
			resources: [],
		};
		summary.enabled = !options.disabledPackages.has(summary.identity);
		packages.set(key, summary);
		return summary;
	};

	for (const type of RESOURCE_TYPES) {
		for (const resource of resolved[type]) {
			if (type === "extensions" && isExcluded(resource.path)) continue;
			const owner = packageOf(resource);
			if (owner) {
				owner.resources.push({
					type,
					path: resource.path,
					displayName: resourceDisplayName(resource.path, type),
					enabled: resource.enabled,
				});
				continue;
			}
			if (type !== "extensions") continue;
			if (resource.metadata.source === "builtin") {
				const name = resource.path.slice(BUILTIN_PREFIX.length);
				if (!options.builtinExtensions.includes(name)) continue;
				builtins.push({
					name,
					enabled: resource.enabled,
					scope: resource.metadata.scope === "project" ? "project" : "user",
				});
				continue;
			}
			loose.push({
				path: resource.path,
				displayName: resourceDisplayName(resource.path, type),
				scope: resource.metadata.scope === "project" ? "project" : "user",
				explicit: resource.metadata.source === "local",
				enabled: resource.enabled,
			});
		}
	}

	const loadable = [
		...[...packages.values()]
			.filter((summary) => summary.enabled)
			.flatMap((summary) =>
				summary.resources.filter((r) => r.type === "extensions" && r.enabled).map((r) => r.path),
			),
		...loose.filter((entry) => entry.enabled).map((entry) => entry.path),
	];
	const loaded = await loadExtensionInfo(cwd, agentDir, loadable);
	const annotate = (entry: PiPackageResource | PiLooseExtension): void => {
		const info = loaded.get(resolve(entry.path));
		if (!info) return;
		if (info.tools) entry.tools = info.tools;
		if (info.commands) entry.commands = info.commands;
		if (info.error !== undefined) entry.error = info.error;
	};
	for (const summary of packages.values()) {
		for (const resource of summary.resources)
			if (resource.type === "extensions") annotate(resource);
	}
	for (const entry of loose) annotate(entry);

	return {
		agentDir,
		settingsPath: join(agentDir, "settings.json"),
		...(options.cwd ? { projectSettingsPath: join(options.cwd, ".pi", "settings.json") } : {}),
		projectTrusted,
		packages: [...packages.values()],
		loose,
		builtins,
	};
}

/**
 * Loads exactly these extension files through a loader that cannot install anything: empty in-memory
 * settings (no `packages` to resolve), `noExtensions` so only the explicit file paths load, and every
 * other resource kind off. Enabled factories run, as they do at every chat start.
 */
async function loadExtensionInfo(
	cwd: string,
	agentDir: string,
	paths: readonly string[],
): Promise<Map<string, LoadedExtensionInfo>> {
	const info = new Map<string, LoadedExtensionInfo>();
	if (paths.length === 0) return info;
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		noExtensions: true,
		additionalExtensionPaths: [...paths],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const result = loader.getExtensions();
	for (const extension of result.extensions) {
		info.set(resolve(extension.resolvedPath), {
			tools: [...extension.tools.keys()],
			commands: [...extension.commands.keys()],
		});
	}
	for (const failure of result.errors) {
		const key = resolve(failure.path);
		info.set(key, { ...info.get(key), error: failure.error });
	}
	return info;
}

function resourceDisplayName(path: string, type: PiPackageResourceType): string {
	const fileName = basename(path);
	const parentFolder = basename(dirname(path));
	if (type === "extensions" && parentFolder !== "extensions") return `${parentFolder}/${fileName}`;
	if (type === "skills" && fileName === "SKILL.md") return parentFolder;
	return fileName;
}

function readPackageMetadata(
	installedPath: string,
	source: string,
): { name: string; version?: string; description?: string } {
	const fallback = { name: fallbackName(installedPath, source) };
	try {
		if (!statSync(installedPath).isDirectory()) return fallback;
		const parsed: unknown = JSON.parse(readFileSync(join(installedPath, "package.json"), "utf8"));
		if (!parsed || typeof parsed !== "object") return fallback;
		const manifest = parsed as Record<string, unknown>;
		return {
			name: typeof manifest.name === "string" && manifest.name ? manifest.name : fallback.name,
			...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
			...(typeof manifest.description === "string" && manifest.description
				? { description: manifest.description }
				: {}),
		};
	} catch {
		return fallback;
	}
}

function fallbackName(installedPath: string, source: string): string {
	if (piPackageSourceKind(source) === "npm") return npmPackageName(source.trim().slice(4).trim());
	return basename(installedPath);
}
