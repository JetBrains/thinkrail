import { readFileSync } from "node:fs";
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
import { bumpPackagesRevision, setResolvedPackagesListener } from "./extensions";
import { HOST_BUILTIN_EXTENSION_NAMES } from "./mcp";
import {
	checkPiPackageUpdates,
	installPiPackage,
	invalidatePiPackageCatalog,
	invalidatePiPackageUpdates,
	listPiPackageCatalog,
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

function hostContext(target: PiPackagesTarget): PiPackageHostContext {
	return {
		...(target.cwd ? { cwd: target.cwd } : {}),
		agentDir: getAgentDir(),
		projectTrusted: target.projectTrusted,
		builtinExtensions: HOST_BUILTIN_EXTENSION_NAMES,
	};
}

async function excludedExtensionPaths(): Promise<readonly string[]> {
	try {
		return (await getPiRuntimeGeneration()).excludedSessionExtensionPaths;
	} catch {
		return [];
	}
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

/** Installs, then applies to chats and pages; returns the new row. The caller clears its `disabledPackages` entry. */
export async function piPackagesInstall(
	target: PiPackagesTarget,
	request: { source: string; scope: PiPackageScope },
	disabledPackages: ReadonlySet<string>,
): Promise<{ identity: string; summary: PiPackageSummary }> {
	const identity = await installPiPackage(hostContext(target), request);
	primeUserPiSettings();
	refreshPiPackages();
	const enabledFromNowOn = new Set(disabledPackages);
	enabledFromNowOn.delete(identity);
	const catalog = await piPackagesCatalog(target, enabledFromNowOn);
	const summary = catalog.packages.find(
		(entry) => entry.identity === identity && entry.scope === request.scope,
	);
	if (!summary) {
		throw new CodedError(
			"PACKAGE_NOTHING_LOADABLE",
			`${request.source} was installed but contributes nothing pi can load.`,
		);
	}
	return { identity, summary };
}

export async function piPackagesRemove(
	target: PiPackagesTarget,
	request: { source: string; scope: PiPackageScope },
): Promise<void> {
	await removePiPackage(hostContext(target), request);
	primeUserPiSettings();
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
): Promise<{ source: string; scope: PiPackageScope }[]> {
	return checkPiPackageUpdates(hostContext(target));
}

export async function piPackagesSetResourceEnabled(
	target: PiPackagesTarget,
	toggle: { path: string; type: PiPackageResourceType; scope: PiPackageScope; enabled: boolean },
): Promise<void> {
	await setPiResourceEnabled(hostContext(target), toggle);
	primeUserPiSettings();
	refreshPiPackages();
}

/** The folder to open for a catalog path: a package's install folder, or a loose file's directory. */
export async function piPackagesRevealTarget(
	target: PiPackagesTarget,
	path: string,
	disabledPackages: ReadonlySet<string>,
): Promise<string> {
	const catalog = await piPackagesCatalog(target, disabledPackages);
	const wanted = resolve(path);
	const pkg = catalog.packages.find((entry) => resolve(entry.installedPath) === wanted);
	if (pkg) return pkg.installedPath;
	const loose = catalog.loose.find((entry) => resolve(entry.path) === wanted);
	if (loose) return dirname(loose.path);
	throw new CodedError(
		"PACKAGE_UNKNOWN",
		"That path is not an installed package or extension file.",
	);
}

type PiPackagesPublisher = () => void;

let publish: PiPackagesPublisher | null = null;

export function setPiPackagesPublisher(fn: PiPackagesPublisher | null): void {
	publish = fn;
}

setResolvedPackagesListener(() => publish?.());

export function refreshPiPackages(): void {
	bumpPackagesRevision();
	invalidatePiPackageCatalog();
	invalidatePiPackageUpdates();
	refreshExtensionTools();
	publish?.();
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

/** Records the user settings file's current declarations so only a later semantic change refreshes. */
export function primeUserPiSettings(): void {
	const path = join(getAgentDir(), "settings.json");
	seenSettings.set(resolve(path), resourceFingerprint(path));
}

/** A workspace change touched its repository's `.pi/settings.json` (or `.pi` itself). */
export function handleProjectPiSettingsChanged(worktreePath: string): boolean {
	return handlePiSettingsFileChanged(join(worktreePath, ".pi", "settings.json"));
}

export function handlePiSettingsFileChanged(path: string): boolean {
	const key = resolve(path);
	const next = resourceFingerprint(path);
	const previous = seenSettings.get(key);
	seenSettings.set(key, next);
	if (previous === next) return false;
	refreshPiPackages();
	return true;
}
