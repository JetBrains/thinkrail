import { getAgentDir, type PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";
import { declarationsOf, disabledDeclarationIdentities, piDeclarationIdentity } from "./identity";

export type PackageDeclarationScope = "user" | "project";

const noneDisabled = (): ReadonlySet<string> => new Set();
let disabledPackagesResolver: () => ReadonlySet<string> = noneDisabled;

export function setDisabledPackagesResolver(resolver: (() => ReadonlySet<string>) | null): void {
	disabledPackagesResolver = resolver ?? noneDisabled;
}

export function disabledPackages(): ReadonlySet<string> {
	try {
		return disabledPackagesResolver();
	} catch {
		return new Set();
	}
}

/**
 * Which package declarations a `SettingsManager` shows pi: `all` for the host's own reads and writes,
 * `enabled` for anything that loads resources for a chat (the switched-off ones are hidden, so pi never
 * installs or loads them), `none` for a loader that resolves nothing from packages.
 */
export type PiSettingsPackages = "all" | "enabled" | "none";

export interface PiSettingsOptions {
	projectTrusted?: boolean;
	packages: PiSettingsPackages;
}

/** The only way the host opens pi settings; `agentDir` undefined means pi's default. */
export function createPiSettings(
	cwd: string,
	agentDir: string | undefined,
	options: PiSettingsOptions,
): SettingsManager {
	const settings = SettingsManager.create(
		cwd,
		agentDir,
		options.projectTrusted === undefined ? undefined : { projectTrusted: options.projectTrusted },
	);
	if (options.packages === "all") return settings;
	if (options.packages === "none") return withPackageDeclarations(settings, () => false);
	const resolvedAgentDir = agentDir ?? getAgentDir();
	const getGlobalSettings = settings.getGlobalSettings.bind(settings);
	const getProjectSettings = settings.getProjectSettings.bind(settings);
	return withPackageDeclarations(settings, (declaration, scope) => {
		const disabled = disabledPackages();
		if (disabled.size === 0) return true;
		const off = disabledDeclarationIdentities(
			[
				...declarationsOf(getGlobalSettings().packages, "user"),
				...declarationsOf(getProjectSettings().packages, "project"),
			],
			disabled,
			cwd,
			resolvedAgentDir,
		);
		const source = typeof declaration === "string" ? declaration : declaration.source;
		return !off.has(piDeclarationIdentity(source, scope, cwd, resolvedAgentDir));
	});
}

const patched = new WeakSet<SettingsManager>();

function withPackageDeclarations(
	settings: SettingsManager,
	keep: (declaration: PackageSource, scope: PackageDeclarationScope) => boolean,
): SettingsManager {
	if (patched.has(settings)) throw new Error("pi settings already carry a package view");
	patched.add(settings);
	const filtered = <T extends { packages?: PackageSource[] }>(
		current: T,
		scope: PackageDeclarationScope,
	): T => {
		const packages = current.packages;
		if (!packages) return current;
		const kept = packages.filter((declaration) => keep(declaration, scope));
		return kept.length === packages.length ? current : { ...current, packages: kept };
	};
	const getGlobalSettings = settings.getGlobalSettings.bind(settings);
	const getProjectSettings = settings.getProjectSettings.bind(settings);
	settings.getGlobalSettings = () => filtered(getGlobalSettings(), "user");
	settings.getProjectSettings = () => filtered(getProjectSettings(), "project");
	const refuse = () => {
		throw new Error("pi settings opened with a package view are read-only for packages");
	};
	settings.setPackages = refuse;
	settings.setProjectPackages = refuse;
	return settings;
}
