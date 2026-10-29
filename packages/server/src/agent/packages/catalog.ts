import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	DefaultPackageManager,
	DefaultResourceLoader,
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
import { advancePiExtensionCache } from "./extensionCache";
import {
	BUILTIN_PREFIX,
	npmPackageName,
	piPackageIdentity,
	piPackageSourceKind,
	resolveLocalSource,
	settingsBaseDir,
} from "./identity";

const RESOURCE_TYPES: readonly PiPackageResourceType[] = ["extensions", "skills", "prompts"];
/** Every change path invalidates explicitly; the TTL only bounds a change the host did not see. */
const CATALOG_TTL_MS = 5 * 60_000;

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
	extensionInfoMemo.clear();
	memoGeneration += 1;
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
	const baseDir = settingsBaseDir(cwd, agentDir, scope);
	return piPackageIdentity(source, (path) => resolveLocalSource(path, baseDir));
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
	const declarationKey = (scope: PiPackageScope, source: string) => `${scope}\0${source}`;
	const configured = packageManager
		.listConfiguredPackages()
		.filter((entry) => !(entry.scope === "project" && !projectTrusted));
	const identityOf = (source: string, scope: PiPackageScope) =>
		packageSourceIdentity(source, scope, options.cwd, agentDir);
	const projectIdentities = new Set(
		configured
			.filter((entry) => entry.scope === "project")
			.map((entry) => identityOf(entry.source, "project")),
	);
	for (const entry of configured) {
		if (!entry.installedPath) continue;
		const identity = identityOf(entry.source, entry.scope);
		const shadowed = entry.scope === "user" && projectIdentities.has(identity);
		packages.set(declarationKey(entry.scope, entry.source), {
			identity,
			source: entry.source,
			kind: piPackageSourceKind(entry.source),
			scope: entry.scope,
			...readPackageMetadata(entry.installedPath, entry.source),
			installedPath: entry.installedPath,
			singleFile: !isDirectory(entry.installedPath),
			enabled: !options.disabledPackages.has(identity),
			...(shadowed ? { shadowed: true } : {}),
			resources: [],
		});
	}

	const loose: PiLooseExtension[] = [];
	const builtins: PiBuiltinExtension[] = [];
	for (const type of RESOURCE_TYPES) {
		for (const resource of resolved[type]) {
			if (type === "extensions" && isExcluded(resource.path)) continue;
			const { metadata } = resource;
			if (metadata.origin === "package") {
				const scope: PiPackageScope = metadata.scope === "project" ? "project" : "user";
				packages.get(declarationKey(scope, metadata.source))?.resources.push({
					type,
					path: resource.path,
					displayName: resourceDisplayName(resource.path, type),
					enabled: resource.enabled,
				});
				continue;
			}
			if (type !== "extensions") continue;
			if (metadata.source === "builtin") {
				const name = resource.path.slice(BUILTIN_PREFIX.length);
				if (!options.builtinExtensions.includes(name)) continue;
				builtins.push({
					name,
					enabled: resource.enabled,
					scope: metadata.scope === "project" ? "project" : "user",
				});
				continue;
			}
			loose.push({
				path: resource.path,
				displayName: resourceDisplayName(resource.path, type),
				scope: metadata.scope === "project" ? "project" : "user",
				explicit: metadata.source === "local",
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

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

const extensionInfoMemo = new Map<string, { mtimeMs: number; info: LoadedExtensionInfo }>();
let memoGeneration = 0;

function fileMtime(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

// In-memory settings + noExtensions: this loader can never install a declared-but-missing package.
// A file's factory runs once per content change: the memo is keyed by its mtime.
async function loadExtensionInfo(
	cwd: string,
	agentDir: string,
	paths: readonly string[],
): Promise<Map<string, LoadedExtensionInfo>> {
	const info = new Map<string, LoadedExtensionInfo>();
	const pending: string[] = [];
	for (const path of paths) {
		const key = resolve(path);
		const memo = extensionInfoMemo.get(key);
		const mtimeMs = fileMtime(key);
		if (memo && mtimeMs !== undefined && memo.mtimeMs === mtimeMs) info.set(key, memo.info);
		else pending.push(path);
	}
	if (pending.length === 0) return info;
	const probedGeneration = memoGeneration;
	await advancePiExtensionCache(agentDir);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		noExtensions: true,
		additionalExtensionPaths: pending,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const result = loader.getExtensions();
	const fresh = new Map<string, LoadedExtensionInfo>();
	for (const extension of result.extensions) {
		fresh.set(resolve(extension.resolvedPath), {
			tools: [...extension.tools.keys()],
			commands: [...extension.commands.keys()],
		});
	}
	for (const failure of result.errors) {
		const key = resolve(failure.path);
		fresh.set(key, { ...fresh.get(key), error: failure.error });
	}
	for (const [key, value] of fresh) {
		info.set(key, value);
		const mtimeMs = fileMtime(key);
		if (mtimeMs !== undefined && probedGeneration === memoGeneration) {
			extensionInfoMemo.set(key, { mtimeMs, info: value });
		}
	}
	return info;
}

/** The on-disk targets a reveal may open, read without executing any extension. */
export async function listPiPackageRevealTargets(options: {
	cwd?: string;
	agentDir: string;
	projectTrusted: boolean;
	builtinExtensions: readonly string[];
}): Promise<{ packageRoots: string[]; looseFiles: string[] }> {
	const cwd = options.cwd ?? options.agentDir;
	const settingsManager = SettingsManager.create(cwd, options.agentDir, {
		projectTrusted: options.projectTrusted,
	});
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir: options.agentDir,
		settingsManager,
		builtinExtensions: [...options.builtinExtensions],
	});
	const packageRoots = packageManager
		.listConfiguredPackages()
		.filter((entry) => entry.installedPath !== undefined)
		.filter((entry) => !(entry.scope === "project" && !options.projectTrusted))
		.map((entry) => entry.installedPath as string);
	const resolved = await packageManager.resolve(async () => "skip");
	const looseFiles = resolved.extensions
		.filter((r) => r.metadata.origin !== "package" && r.metadata.source !== "builtin")
		.map((r) => r.path);
	return { packageRoots, looseFiles };
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
