import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	PiPackageResourceType,
	PiPackageScope,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { refreshExtensionTools } from "./agentSessionManager";
import { bumpPackagesRevision, setInstalledPackagesListener } from "./extensions";
import { HOST_BUILTIN_EXTENSION_NAMES } from "./mcp";
import {
	checkPiPackageUpdates,
	installPiPackage,
	invalidatePiPackageCatalog,
	invalidatePiPackageUpdates,
	listPiPackageCatalog,
	listPiPackageRevealTargets,
	type PiPackageHostContext,
	removePiPackage,
	setPiResourceEnabled,
	updatePiPackages,
} from "./packages";
import { getPiRuntimeGeneration } from "./piRuntime";

/** Where a request is aimed: a workspace's checkout and its project's pi-level trust, or user scope alone. */
export interface PiPackagesTarget {
	cwd?: string;
	/** Read fresh at every use. */
	projectTrusted: () => boolean;
}

type PiPackagesPublisher = () => void;

let publish: PiPackagesPublisher | null = null;

export function setPiPackagesPublisher(fn: PiPackagesPublisher | null): void {
	publish = fn;
}

setInstalledPackagesListener(() => {
	invalidatePiPackageCatalog();
	publish?.();
});

/** Open pages re-list; nothing about what chats load changed (a switch flip, a package pi installed itself). */
export function publishPiPackagesChanged(): void {
	publish?.();
}

/** The declared or installed set changed: every registered chat re-decides through the gated reload, pages re-list. */
export function refreshPiPackages(): void {
	bumpPackagesRevision();
	invalidatePiPackageCatalog();
	invalidatePiPackageUpdates();
	refreshExtensionTools();
	publish?.();
}

function hostContext(target: PiPackagesTarget): PiPackageHostContext {
	return {
		...(target.cwd ? { cwd: target.cwd } : {}),
		agentDir: getAgentDir(),
		projectTrusted: target.projectTrusted,
		builtinExtensions: HOST_BUILTIN_EXTENSION_NAMES,
		onPersisted: primePiSettingsFile,
	};
}

async function excludedExtensionPaths(): Promise<readonly string[]> {
	return (await getPiRuntimeGeneration()).excludedSessionExtensionPaths;
}

export async function piPackagesCatalog(
	target: PiPackagesTarget,
	disabledPackages: ReadonlySet<string>,
): Promise<PiPackagesCatalog> {
	return listPiPackageCatalog({
		...(target.cwd ? { cwd: target.cwd } : {}),
		agentDir: getAgentDir(),
		projectTrusted: target.projectTrusted(),
		builtinExtensions: HOST_BUILTIN_EXTENSION_NAMES,
		excludedExtensionPaths: await excludedExtensionPaths(),
		disabledPackages,
	});
}

/**
 * Installs, applies to chats and pages, and returns the new row. `disabledPackages` is read after the
 * install finished — it can take minutes — so another client's switch flips are honoured; the caller
 * clears the installed identity from the setting.
 */
export async function piPackagesInstall(
	target: PiPackagesTarget,
	request: { source: string; scope: PiPackageScope },
	disabledPackages: () => ReadonlySet<string>,
): Promise<{ identity: string; summary: PiPackageSummary }> {
	const identity = await installPiPackage(hostContext(target), request);
	refreshPiPackages();
	const enabledFromNowOn = new Set(disabledPackages());
	enabledFromNowOn.delete(identity);
	const catalog = await piPackagesCatalog(target, enabledFromNowOn);
	const summary =
		catalog.packages.find((e) => e.identity === identity && e.scope === request.scope) ??
		catalog.packages.find((e) => e.identity === identity);
	if (!summary) {
		throw new CodedError(
			"PACKAGE_INSTALL_FAILED",
			`${request.source} was declared but ThinkRail cannot find it on disk afterwards.`,
		);
	}
	return { identity, summary };
}

export async function piPackagesRemove(
	target: PiPackagesTarget,
	request: { source: string; scope: PiPackageScope },
): Promise<void> {
	await removePiPackage(hostContext(target), request);
	refreshPiPackages();
}

export async function piPackagesUpdate(
	target: PiPackagesTarget,
	packages: readonly { source: string; scope: PiPackageScope }[],
): Promise<void> {
	await updatePiPackages(hostContext(target), packages);
	refreshPiPackages();
}

export function piPackagesCheckUpdates(
	target: PiPackagesTarget,
	options: { force?: boolean } = {},
): Promise<{ source: string; scope: PiPackageScope }[]> {
	return checkPiPackageUpdates(hostContext(target), options);
}

export async function piPackagesSetResourceEnabled(
	target: PiPackagesTarget,
	toggle: { path: string; type: PiPackageResourceType; scope: PiPackageScope; enabled: boolean },
): Promise<void> {
	await setPiResourceEnabled(hostContext(target), toggle);
	refreshPiPackages();
}

/** The folder to open for a catalog path — a package's install folder or a file's directory — read without running extension code. */
export async function piPackagesRevealTarget(
	target: PiPackagesTarget,
	path: string,
): Promise<string> {
	const { packageRoots, looseFiles } = await listPiPackageRevealTargets({
		...(target.cwd ? { cwd: target.cwd } : {}),
		agentDir: getAgentDir(),
		projectTrusted: target.projectTrusted(),
		builtinExtensions: HOST_BUILTIN_EXTENSION_NAMES,
	});
	const wanted = resolve(path);
	const root = packageRoots.find((candidate) => resolve(candidate) === wanted);
	if (root) return statSync(root).isDirectory() ? root : dirname(root);
	if (looseFiles.some((candidate) => resolve(candidate) === wanted)) return dirname(path);
	throw new CodedError(
		"PACKAGE_UNKNOWN",
		"That path is not an installed package or extension file.",
	);
}

const RESOURCE_KEYS = ["packages", "extensions", "skills", "prompts"] as const;

function resourceFingerprint(path: string): string {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		return JSON.stringify(RESOURCE_KEYS.map((key) => record[key] ?? null));
	} catch {
		return "";
	}
}

const seenSettings = new Map<string, string>();

function primePiSettingsFile(path: string): void {
	seenSettings.set(resolve(path), resourceFingerprint(path));
}

/** Records the user settings file's current declarations so only a later semantic change refreshes. */
export function primeUserPiSettings(): void {
	primePiSettingsFile(join(getAgentDir(), "settings.json"));
}

/** Records a worktree's `.pi/settings.json` (present or not) so its first watched change is judged against it. */
export function primeProjectPiSettings(worktreePath: string): void {
	primePiSettingsFile(join(worktreePath, ".pi", "settings.json"));
}

/** A workspace change touched its repository's `.pi/settings.json` (or `.pi` itself). */
export function handleProjectPiSettingsChanged(worktreePath: string): boolean {
	return handlePiSettingsFileChanged(join(worktreePath, ".pi", "settings.json"));
}

/**
 * A pi settings file changed on disk. Only a change to its `packages` / `extensions` / `skills` /
 * `prompts` declarations counts — an unrelated setting, the echo of the host's own write, or the first
 * sight of a file that does not exist does not.
 */
export function handlePiSettingsFileChanged(path: string): boolean {
	const key = resolve(path);
	const next = resourceFingerprint(path);
	const previous = seenSettings.get(key) ?? "";
	seenSettings.set(key, next);
	if (previous === next) return false;
	refreshPiPackages();
	return true;
}
