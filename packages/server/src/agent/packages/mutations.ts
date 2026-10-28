import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
	DefaultPackageManager,
	type PackageSource,
	type ResolvedResource,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PiPackageResourceType, PiPackageScope } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { invalidatePiPackageCatalog, packageSourceIdentity } from "./catalog";
import { piPackageSourceKind } from "./identity";

const BUILTIN_PREFIX = "builtin:";
const UPDATE_CHECK_TTL_MS = 5 * 60_000;

export interface PiPackageHostContext {
	/** The workspace path; absent → user scope only. */
	cwd?: string;
	agentDir: string;
	/** Read fresh at every use: an npm install can outlast a trust change. */
	projectTrusted: () => boolean;
	builtinExtensions: readonly string[];
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

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = chain.then(task, task);
	chain = run.catch(() => undefined);
	return run;
}

function isOffline(): boolean {
	const value = process.env.PI_OFFLINE?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function openSettings(ctx: PiPackageHostContext): {
	settings: SettingsManager;
	packageManager: DefaultPackageManager;
} {
	const settings = SettingsManager.create(ctx.cwd ?? ctx.agentDir, ctx.agentDir, {
		projectTrusted: ctx.projectTrusted(),
	});
	const packageManager = new DefaultPackageManager({
		cwd: ctx.cwd ?? ctx.agentDir,
		agentDir: ctx.agentDir,
		settingsManager: settings,
		builtinExtensions: [...ctx.builtinExtensions],
	});
	return { settings, packageManager };
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

async function persist(settings: SettingsManager): Promise<void> {
	await settings.flush();
	const errors = settings.drainErrors();
	if (errors.length > 0) {
		throw new CodedError(
			"PACKAGE_SETTINGS_WRITE_FAILED",
			errors.map((entry) => entry.error.message).join("; "),
		);
	}
}

function settingsBaseDir(ctx: PiPackageHostContext, scope: PiPackageScope): string {
	return scope === "project" && ctx.cwd ? join(ctx.cwd, ".pi") : ctx.agentDir;
}

/** Installs, then persists the declaration in the scope's settings file; returns the package identity. */
export function installPiPackage(
	ctx: PiPackageHostContext,
	target: PiPackageTarget,
): Promise<string> {
	return enqueue(async () => {
		const source = target.source.trim();
		if (!source) throw new CodedError("PACKAGE_SOURCE_INVALID", "A package source is required.");
		assertScopeWritable(ctx, target.scope);
		const kind = piPackageSourceKind(source);
		if (kind === "local") {
			const path = resolve(
				settingsBaseDir(ctx, target.scope),
				source.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"),
			);
			if (!existsSync(path)) {
				throw new CodedError("PACKAGE_SOURCE_INVALID", `No such folder or file: ${path}`);
			}
		} else if (isOffline()) {
			throw new CodedError(
				"PACKAGE_OFFLINE",
				"pi is in offline mode; npm and git packages cannot be installed.",
			);
		}
		const local = target.scope === "project";
		const { settings, packageManager } = openSettings(ctx);
		try {
			await packageManager.install(source, { local });
		} catch (error) {
			throw new CodedError("PACKAGE_INSTALL_FAILED", messageOf(error));
		}
		assertScopeWritable(ctx, target.scope);
		packageManager.addSourceToSettings(source, { local });
		await persist(settings);
		invalidatePiPackageCatalog();
		updateCache.clear();
		return packageSourceIdentity(source, target.scope, ctx.cwd, ctx.agentDir);
	});
}

/** Removes the declaration first (so a later resolve cannot re-install), then the installed files. */
export function removePiPackage(ctx: PiPackageHostContext, target: PiPackageTarget): Promise<void> {
	return enqueue(async () => {
		assertScopeWritable(ctx, target.scope);
		const local = target.scope === "project";
		const { settings, packageManager } = openSettings(ctx);
		if (!packageManager.removeSourceFromSettings(target.source, { local })) {
			throw new CodedError(
				"PACKAGE_UNKNOWN",
				`No package ${target.source} is declared at ${target.scope} scope.`,
			);
		}
		await persist(settings);
		invalidatePiPackageCatalog();
		updateCache.clear();
		try {
			await packageManager.remove(target.source, { local });
		} catch (error) {
			throw new CodedError("PACKAGE_REMOVE_FAILED", messageOf(error));
		}
	});
}

/** pi's `update(source)` reconciles every declaration of that identity, at both scopes. */
export function updatePiPackages(
	ctx: PiPackageHostContext,
	sources: readonly string[],
): Promise<void> {
	return enqueue(async () => {
		if (isOffline()) {
			throw new CodedError("PACKAGE_OFFLINE", "pi is in offline mode; packages cannot be updated.");
		}
		const { packageManager } = openSettings(ctx);
		for (const source of sources) {
			try {
				await packageManager.update(source);
			} catch (error) {
				throw new CodedError("PACKAGE_UPDATE_FAILED", messageOf(error));
			}
		}
		invalidatePiPackageCatalog();
		updateCache.clear();
	});
}

const updateCache = new Map<string, { at: number; value: Promise<PiPackageTarget[]> }>();

/** The declarations pi reports a newer version for; pinned npm versions are never reported. Cached briefly. */
export function checkPiPackageUpdates(ctx: PiPackageHostContext): Promise<PiPackageTarget[]> {
	const key = JSON.stringify([ctx.cwd ?? null, ctx.agentDir, ctx.projectTrusted()]);
	const cached = updateCache.get(key);
	if (cached && Date.now() - cached.at < UPDATE_CHECK_TTL_MS) return cached.value;
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

/**
 * `pi config`'s write format: a package resource becomes a `±<path relative to the package root>`
 * filter on its declaration; a top-level resource (loose file, explicit settings entry, built-in)
 * becomes `±<pattern>` in the scope's array of that resource kind. One deliberate difference: a plain
 * explicit entry is kept beside its override — pi's TUI replaces it, after which the file is no longer
 * discovered and cannot be switched back on.
 */
export function setPiResourceEnabled(
	ctx: PiPackageHostContext,
	toggle: PiResourceToggle,
): Promise<void> {
	return enqueue(async () => {
		assertScopeWritable(ctx, toggle.scope);
		const { settings, packageManager } = openSettings(ctx);
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
		await persist(settings);
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

function isOverride(entry: string): boolean {
	return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-");
}

function patternTarget(entry: string): string {
	return isOverride(entry) ? entry.slice(1) : entry;
}

function togglePackageResource(
	settings: SettingsManager,
	resource: ResolvedResource,
	toggle: PiResourceToggle,
): void {
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
		typeof current === "string" ? { source: current } : { ...current, source: current.source };
	const pattern = relative(resource.metadata.baseDir ?? dirname(resource.path), resource.path);
	const kept = (pkg[toggle.type] ?? []).filter((entry) => patternTarget(entry) !== pattern);
	kept.push(`${toggle.enabled ? "+" : "-"}${pattern}`);
	pkg[toggle.type] = kept;
	packages[index] = pkg;
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
		: relative(resource.metadata.baseDir ?? settingsBaseDir(ctx, toggle.scope), resource.path);
	const scoped =
		toggle.scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
	const current: string[] = [...(scoped[toggle.type] ?? [])];
	const kept = current.filter((entry) => !(isOverride(entry) && patternTarget(entry) === pattern));
	kept.push(`${toggle.enabled ? "+" : "-"}${pattern}`);
	writeTopLevelPaths(settings, toggle.type, toggle.scope, kept);
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
