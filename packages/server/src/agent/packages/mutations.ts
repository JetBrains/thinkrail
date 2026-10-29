import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
	DefaultPackageManager,
	type PackageSource,
	type ResolvedResource,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type PiPackageResourceType,
	type PiPackageScope,
	parsePiPackageInput,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { invalidatePiPackageCatalog } from "./catalog";
import {
	BUILTIN_PREFIX,
	isOfflineMode,
	packageSourceIdentity,
	piPackageSourceKind,
	resolveLocalSource,
	settingsBaseDir,
} from "./identity";
import { createPiSettings } from "./settingsView";

const UPDATE_CHECK_TTL_MS = 5 * 60_000;
const RESOURCE_TYPES: ReadonlySet<string> = new Set(["extensions", "skills", "prompts"]);
const SCOPES: ReadonlySet<string> = new Set(["user", "project"]);

export interface PiPackageHostContext {
	/** The workspace path; absent → user scope only. */
	cwd?: string;
	agentDir: string;
	/** Read fresh at every use: an npm install can outlast a trust change. */
	projectTrusted: () => boolean;
	builtinExtensions: readonly string[];
	/** Called right after a settings file was written, before any further disk work. */
	onPersisted?: (settingsPath: string) => void;
}

export interface PiPackageTarget {
	source: string;
	scope: PiPackageScope;
}

export interface PiResourceToggle {
	path: string;
	type: PiPackageResourceType;
	scope: PiPackageScope;
	enabled: boolean;
}

let chain: Promise<unknown> = Promise.resolve();
const updateCache = new Map<string, { at: number; value: Promise<PiPackageTarget[]> }>();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = chain.then(task, task);
	chain = run.catch(() => undefined);
	return run;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertScope(scope: unknown): asserts scope is PiPackageScope {
	if (typeof scope !== "string" || !SCOPES.has(scope)) {
		throw new CodedError("PACKAGE_SOURCE_INVALID", "Unsupported package scope.");
	}
}

function assertToggleShape(toggle: PiResourceToggle): void {
	assertScope(toggle.scope);
	if (!RESOURCE_TYPES.has(toggle.type) || typeof toggle.path !== "string" || !toggle.path) {
		throw new CodedError("PACKAGE_SOURCE_INVALID", "Unsupported resource type or path.");
	}
}

/** A fresh settings read; pre-existing load errors are drained so only this mutation's write is judged. */
function openSettings(
	ctx: PiPackageHostContext,
	writeScope?: PiPackageScope,
): {
	settings: SettingsManager;
	packageManager: DefaultPackageManager;
} {
	const settings = createPiSettings(ctx.cwd ?? ctx.agentDir, ctx.agentDir, {
		projectTrusted: ctx.projectTrusted(),
		packages: "all",
	});
	assertScopeLoaded(settings, writeScope);
	const packageManager = new DefaultPackageManager({
		cwd: ctx.cwd ?? ctx.agentDir,
		agentDir: ctx.agentDir,
		settingsManager: settings,
		builtinExtensions: [...ctx.builtinExtensions],
	});
	return { settings, packageManager };
}

// pi's save() silently skips a scope whose file failed to parse; only that scope's error blocks a write.
function assertScopeLoaded(
	settings: SettingsManager,
	writeScope: PiPackageScope | undefined,
): void {
	const loadErrors = settings.drainErrors();
	if (writeScope === undefined) return;
	const blocking = loadErrors.find(
		(entry) => entry.scope === (writeScope === "project" ? "project" : "global"),
	);
	if (blocking) {
		throw new CodedError(
			"PACKAGE_SETTINGS_WRITE_FAILED",
			`The ${writeScope} settings file cannot be read: ${blocking.error.message}`,
		);
	}
}

function assertScopeWritable(ctx: PiPackageHostContext, scope: PiPackageScope): void {
	if (scope !== "project") return;
	if (!ctx.cwd || !ctx.projectTrusted()) {
		throw new CodedError(
			"PACKAGE_UNTRUSTED",
			"Repository packages need a trusted project before ThinkRail writes .pi/settings.json.",
		);
	}
}

async function persist(
	ctx: PiPackageHostContext,
	settings: SettingsManager,
	scope: PiPackageScope,
): Promise<void> {
	await settings.flush();
	const errors = settings.drainErrors();
	if (errors.length > 0) {
		throw new CodedError(
			"PACKAGE_SETTINGS_WRITE_FAILED",
			errors.map((entry) => entry.error.message).join("; "),
		);
	}
	ctx.onPersisted?.(join(settingsBaseDir(ctx.cwd, ctx.agentDir, scope), "settings.json"));
}

// pi matches an input source against the process cwd, not the settings file a declared one is relative to.
function declaredAsInput(ctx: PiPackageHostContext, target: PiPackageTarget): string {
	const source = target.source.trim();
	if (piPackageSourceKind(source) !== "local") return source;
	return resolveLocalSource(source, settingsBaseDir(ctx.cwd, ctx.agentDir, target.scope));
}

/** Installs, then persists the declaration; a relative local source reads like `pi install ./x` from the workspace. */
export function installPiPackage(
	ctx: PiPackageHostContext,
	target: PiPackageTarget,
): Promise<string> {
	return enqueue(async () => {
		assertScope(target.scope);
		const base = ctx.cwd ?? ctx.agentDir;
		const input = parsePiPackageInput(target.source);
		const raw =
			input.bareName !== undefined && existsSync(resolveLocalSource(input.bareName, base))
				? input.bareName
				: input.source;
		if (!raw) throw new CodedError("PACKAGE_SOURCE_INVALID", "A package source is required.");
		assertScopeWritable(ctx, target.scope);
		const kind = piPackageSourceKind(raw);
		const source = kind === "local" ? resolveLocalSource(raw, base) : raw;
		if (kind === "local" && !existsSync(source)) {
			throw new CodedError("PACKAGE_SOURCE_INVALID", `No such folder or file: ${source}`);
		}
		if (kind !== "local" && isOfflineMode()) {
			throw new CodedError(
				"PACKAGE_OFFLINE",
				"pi is in offline mode; npm and git packages cannot be installed.",
			);
		}
		const local = target.scope === "project";
		const { settings, packageManager } = openSettings(ctx, target.scope);
		try {
			await packageManager.install(source, { local });
		} catch (error) {
			throw new CodedError("PACKAGE_INSTALL_FAILED", messageOf(error));
		}
		assertScopeWritable(ctx, target.scope);
		await settings.reload();
		assertScopeLoaded(settings, target.scope);
		packageManager.addSourceToSettings(source, { local });
		await persist(ctx, settings, target.scope);
		invalidatePiPackageCatalog();
		updateCache.clear();
		return packageSourceIdentity(source, target.scope, ctx.cwd, ctx.agentDir);
	});
}

/** Removes the declaration first (so a later resolve cannot re-install), then the installed files. */
export function removePiPackage(ctx: PiPackageHostContext, target: PiPackageTarget): Promise<void> {
	return enqueue(async () => {
		assertScope(target.scope);
		assertScopeWritable(ctx, target.scope);
		const local = target.scope === "project";
		const { settings, packageManager } = openSettings(ctx, target.scope);
		const source = declaredAsInput(ctx, target);
		if (!packageManager.removeSourceFromSettings(source, { local })) {
			throw new CodedError(
				"PACKAGE_UNKNOWN",
				`No package ${target.source} is declared at ${target.scope} scope.`,
			);
		}
		await persist(ctx, settings, target.scope);
		invalidatePiPackageCatalog();
		updateCache.clear();
		try {
			await packageManager.remove(source, { local });
		} catch (error) {
			throw new CodedError("PACKAGE_REMOVE_FAILED", messageOf(error));
		}
	});
}

// Parameterless update() also installs missing declarations, so it runs only when the targets cover them all.
export function updatePiPackages(
	ctx: PiPackageHostContext,
	targets: readonly PiPackageTarget[],
): Promise<void> {
	return enqueue(async () => {
		for (const target of targets) assertScope(target.scope);
		if (isOfflineMode()) {
			throw new CodedError("PACKAGE_OFFLINE", "pi is in offline mode; packages cannot be updated.");
		}
		const { packageManager } = openSettings(ctx);
		const requested = new Set(targets.map((target) => `${target.scope}\0${target.source}`));
		const configured = packageManager.listConfiguredPackages();
		const coversEverything =
			configured.length > 0 &&
			configured.every((entry) => requested.has(`${entry.scope}\0${entry.source}`));
		try {
			if (coversEverything) {
				await packageManager.update();
			} else {
				for (const target of targets) await packageManager.update(declaredAsInput(ctx, target));
			}
		} catch (error) {
			throw new CodedError("PACKAGE_UPDATE_FAILED", messageOf(error));
		}
		invalidatePiPackageCatalog();
		updateCache.clear();
	});
}

/** The declarations pi reports a newer version for; pinned npm versions are never reported. Cached briefly unless forced. */
export function checkPiPackageUpdates(
	ctx: PiPackageHostContext,
	options: { force?: boolean } = {},
): Promise<PiPackageTarget[]> {
	const key = JSON.stringify([ctx.cwd ?? null, ctx.agentDir, ctx.projectTrusted()]);
	const cached = updateCache.get(key);
	if (!options.force && cached && Date.now() - cached.at < UPDATE_CHECK_TTL_MS) return cached.value;
	const value = (async () => {
		const { packageManager } = openSettings(ctx);
		const updates = await packageManager.checkForAvailableUpdates();
		return updates.map((update) => ({ source: update.source, scope: update.scope }));
	})();
	updateCache.set(key, { at: Date.now(), value });
	value.catch(() => updateCache.delete(key));
	return value;
}

export function invalidatePiPackageUpdates(): void {
	updateCache.clear();
}

export function setPiResourceEnabled(
	ctx: PiPackageHostContext,
	toggle: PiResourceToggle,
): Promise<void> {
	return enqueue(async () => {
		assertToggleShape(toggle);
		assertScopeWritable(ctx, toggle.scope);
		const { settings, packageManager } = openSettings(ctx, toggle.scope);
		const resolved = await packageManager.resolve(async () => "skip");
		const resource = findResource(resolved[toggle.type], toggle.path, toggle.scope);
		if (!resource) {
			throw new CodedError("PACKAGE_UNKNOWN", `No ${toggle.type} resource at ${toggle.path}.`);
		}
		if (resource.metadata.origin === "package") {
			togglePackageResource(settings, resource, toggle);
		} else {
			toggleTopLevelResource(ctx, settings, resource, toggle);
		}
		await persist(ctx, settings, toggle.scope);
		invalidatePiPackageCatalog();
	});
}

function findResource(
	resources: readonly ResolvedResource[],
	path: string,
	scope: PiPackageScope,
): ResolvedResource | undefined {
	const isBuiltin = path.startsWith(BUILTIN_PREFIX);
	const wanted = isBuiltin ? path : resolve(path);
	return resources.find((resource) => {
		if (isBuiltin) return resource.path === wanted;
		const resourceScope = resource.metadata.scope === "project" ? "project" : "user";
		return resolve(resource.path) === wanted && resourceScope === scope;
	});
}

function isExactOverrideOf(entry: string, pattern: string): boolean {
	if (!entry.startsWith("+") && !entry.startsWith("-")) return false;
	return normalizeExactPattern(entry.slice(1)) === pattern;
}

function normalizeExactPattern(pattern: string): string {
	const trimmed =
		pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
	return trimmed.split(sep).join("/");
}

// Replaces only this resource's own exact override; pi's filter semantics are in the packages SPEC.
export function togglePackageFilter(
	current: readonly string[] | undefined,
	pattern: string,
	enabled: boolean,
): string[] | undefined {
	if (current === undefined) return enabled ? undefined : [`-${pattern}`];
	if (current.length === 0) return enabled ? [pattern] : [];
	const kept = current.filter((entry) => !isExactOverrideOf(entry, pattern));
	return [...kept, `${enabled ? "+" : "-"}${pattern}`];
}

const RESOURCE_KINDS = ["extensions", "skills", "prompts", "themes"] as const;

// A string declaration loads only what a present manifest names; pi's object form falls back to the
// convention directory for every kind the filter leaves undefined, so those are pinned to `[]`.
function materializeDeclaration(
	source: string,
	packageRoot: string,
): Exclude<PackageSource, string> {
	const pkg: Exclude<PackageSource, string> = { source };
	const manifest = readPiManifest(packageRoot);
	if (!manifest) return pkg;
	for (const kind of RESOURCE_KINDS) {
		if (manifest[kind] === undefined && existsSync(join(packageRoot, kind))) pkg[kind] = [];
	}
	return pkg;
}

function readPiManifest(
	packageRoot: string,
): Partial<Record<(typeof RESOURCE_KINDS)[number], string[]>> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
		const pi = (parsed as { pi?: unknown } | null)?.pi;
		if (!pi || typeof pi !== "object" || Array.isArray(pi)) return null;
		const manifest: Partial<Record<(typeof RESOURCE_KINDS)[number], string[]>> = {};
		for (const kind of RESOURCE_KINDS) {
			const entries = (pi as Record<string, unknown>)[kind];
			if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) {
				manifest[kind] = entries;
			}
		}
		return manifest;
	} catch {
		return null;
	}
}

function togglePackageResource(
	settings: SettingsManager,
	resource: ResolvedResource,
	toggle: PiResourceToggle,
): void {
	const packageRoot = resource.metadata.packageRoot;
	if (packageRoot === undefined || !statSync(packageRoot).isDirectory()) {
		throw new CodedError(
			"PACKAGE_SOURCE_INVALID",
			"A single-file package has no resource filters; use its package switch.",
		);
	}
	const scoped =
		toggle.scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
	const packages: PackageSource[] = [...(scoped.packages ?? [])];
	const index = packages.findIndex(
		(pkg) => (typeof pkg === "string" ? pkg : pkg.source) === resource.metadata.source,
	);
	if (index === -1) {
		throw new CodedError(
			"PACKAGE_UNKNOWN",
			`No declaration of ${resource.metadata.source} at ${toggle.scope} scope.`,
		);
	}
	const current = packages[index] ?? resource.metadata.source;
	const pkg: Exclude<PackageSource, string> =
		typeof current === "string"
			? materializeDeclaration(current, packageRoot)
			: { ...current, source: current.source };
	const pattern = normalizeExactPattern(relative(packageRoot, resource.path));
	const next = togglePackageFilter(pkg[toggle.type], pattern, toggle.enabled);
	if (next === undefined) delete pkg[toggle.type];
	else pkg[toggle.type] = next;
	const hasFilters = RESOURCE_KINDS.some((key) => pkg[key] !== undefined);
	packages[index] = hasFilters || pkg.autoload !== undefined ? pkg : pkg.source;
	if (toggle.scope === "project") settings.setProjectPackages(packages);
	else settings.setPackages(packages);
}

function toggleTopLevelResource(
	ctx: PiPackageHostContext,
	settings: SettingsManager,
	resource: ResolvedResource,
	toggle: PiResourceToggle,
): void {
	const isBuiltin = resource.metadata.source === "builtin";
	const pattern = isBuiltin
		? resource.path
		: normalizeExactPattern(
				relative(
					resource.metadata.baseDir ?? settingsBaseDir(ctx.cwd, ctx.agentDir, toggle.scope),
					resource.path,
				),
			);
	const scoped =
		toggle.scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
	const kept = (scoped[toggle.type] ?? []).filter((entry) => !isExactOverrideOf(entry, pattern));
	writeTopLevelPaths(settings, toggle.type, toggle.scope, [
		...kept,
		`${toggle.enabled ? "+" : "-"}${pattern}`,
	]);
}

function writeTopLevelPaths(
	settings: SettingsManager,
	type: PiPackageResourceType,
	scope: PiPackageScope,
	paths: string[],
): void {
	if (scope === "project") {
		if (type === "extensions") settings.setProjectExtensionPaths(paths);
		else if (type === "skills") settings.setProjectSkillPaths(paths);
		else settings.setProjectPromptTemplatePaths(paths);
		return;
	}
	if (type === "extensions") settings.setExtensionPaths(paths);
	else if (type === "skills") settings.setSkillPaths(paths);
	else settings.setPromptTemplatePaths(paths);
}
