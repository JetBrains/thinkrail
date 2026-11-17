import type {
	PackageInstallResult,
	PiPackageResourceType,
	PiPackageScope,
	PiPackageSourceKind,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import {
	type PiPackagesTarget,
	piPackagesCatalog,
	piPackagesCheckUpdates,
	piPackagesInstall,
	piPackagesRemove,
	piPackagesRevealTarget,
	piPackagesSetResourceEnabled,
	piPackagesUpdate,
} from "../agent";
import { revealInFileManager } from "../editors";
import {
	type ExtensionSourceKind,
	type InstalledExtensionRecord,
	listExtensionCatalog,
} from "../extensions";
import { getProjects } from "../projects";
import { getConfig, updateConfig } from "../settings";
import { getWorkspace } from "../workspaces";

function target(workspaceId: string | undefined): PiPackagesTarget {
	if (workspaceId === undefined) return { projectTrusted: () => false };
	const workspace = getWorkspace(workspaceId);
	return {
		cwd: workspace.worktreePath,
		projectTrusted: () =>
			getProjects().find((project) => project.id === workspace.projectId)?.piResourceTrust ===
			"granted",
	};
}

const disabledPackages = (): ReadonlySet<string> => new Set(getConfig().disabledPackages);

export function packagesList(params: {
	workspaceId?: string;
	force?: boolean;
}): Promise<PiPackagesCatalog> {
	return piPackagesCatalog(target(params.workspaceId), disabledPackages(), {
		fresh: params.force === true,
	});
}

/** A confirmed install turns the package or extension on: it leaves its switch list before the row returns. */
export async function packagesInstall(params: {
	source: string;
	scope: PiPackageScope;
	workspaceId?: string;
}): Promise<PackageInstallResult> {
	const outcome = await piPackagesInstall(
		target(params.workspaceId),
		{ source: params.source, scope: params.scope },
		disabledPackages,
	);
	if (outcome.installed === "extension") return installedExtensionResult(outcome.record);
	const { identity, summary } = outcome;
	const keys = new Set([identity, ...summary.switchKeys]);
	const disabled = getConfig().disabledPackages;
	if (disabled.some((entry) => keys.has(entry))) {
		updateConfig({ disabledPackages: disabled.filter((entry) => !keys.has(entry)) });
	}
	return { ...summary, enabled: true, installed: "package" };
}

const PI_SOURCE_KIND: Record<ExtensionSourceKind, PiPackageSourceKind> = {
	npm: "npm",
	git: "git",
	folder: "local",
};

async function installedExtensionResult(
	record: InstalledExtensionRecord,
): Promise<PackageInstallResult> {
	const disabled = getConfig().disabledExtensions;
	if (disabled.includes(record.name)) {
		updateConfig({ disabledExtensions: disabled.filter((name) => name !== record.name) });
	}
	const catalog = await listExtensionCatalog(new Set(getConfig().disabledExtensions));
	const extension = catalog.find(
		(entry) => entry.kind === "installed" && entry.source === record.source,
	);
	return {
		installed: "extension",
		identity: record.name,
		source: record.source,
		kind: PI_SOURCE_KIND[record.sourceKind ?? "folder"],
		scope: "user",
		name: record.name,
		...(record.version ? { version: record.version } : {}),
		...(record.description ? { description: record.description } : {}),
		...(record.root ? { installedPath: record.root } : {}),
		switchKeys: [],
		enabled: true,
		resources: [],
		...(extension ? { extension } : {}),
	};
}

export async function packagesRemove(params: {
	source: string;
	scope: PiPackageScope;
	workspaceId?: string;
}): Promise<{ ok: true }> {
	await piPackagesRemove(target(params.workspaceId), {
		source: params.source,
		scope: params.scope,
	});
	return { ok: true };
}

export async function packagesUpdate(params: {
	packages: { source: string; scope: PiPackageScope }[];
	workspaceId?: string;
}): Promise<{ ok: true }> {
	await piPackagesUpdate(target(params.workspaceId), params.packages);
	return { ok: true };
}

export function packagesCheckUpdates(params: {
	workspaceId?: string;
	force?: boolean;
}): Promise<{ source: string; scope: PiPackageScope }[]> {
	return piPackagesCheckUpdates(target(params.workspaceId), { force: params.force === true });
}

export async function packagesSetResourceEnabled(params: {
	path: string;
	type: PiPackageResourceType;
	scope: PiPackageScope;
	enabled: boolean;
	workspaceId?: string;
}): Promise<{ ok: true }> {
	await piPackagesSetResourceEnabled(target(params.workspaceId), {
		path: params.path,
		type: params.type,
		scope: params.scope,
		enabled: params.enabled,
	});
	return { ok: true };
}

export async function packagesReveal(params: {
	path: string;
	workspaceId?: string;
}): Promise<{ ok: true }> {
	const folder = await piPackagesRevealTarget(target(params.workspaceId), params.path);
	revealInFileManager(folder);
	return { ok: true };
}
