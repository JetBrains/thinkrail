import type {
	PiPackageResourceType,
	PiPackageScope,
	PiPackageSummary,
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

export function packagesList(params: { workspaceId?: string }): Promise<PiPackagesCatalog> {
	return piPackagesCatalog(target(params.workspaceId), disabledPackages());
}

/** A confirmed install turns the package on: its identity leaves `disabledPackages` before the row returns. */
export async function packagesInstall(params: {
	source: string;
	scope: PiPackageScope;
	workspaceId?: string;
}): Promise<PiPackageSummary> {
	const { identity, summary } = await piPackagesInstall(
		target(params.workspaceId),
		{ source: params.source, scope: params.scope },
		disabledPackages,
	);
	const disabled = getConfig().disabledPackages;
	if (disabled.includes(identity)) {
		updateConfig({ disabledPackages: disabled.filter((entry) => entry !== identity) });
	}
	return { ...summary, enabled: true };
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
