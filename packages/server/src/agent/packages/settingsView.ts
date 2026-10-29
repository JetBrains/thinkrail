import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

export type PackageDeclarationScope = "user" | "project";

export type PackageDeclarationFilter = (
	declaration: PackageSource,
	scope: PackageDeclarationScope,
) => boolean;

const patched = new WeakSet<SettingsManager>();

export function withPackageDeclarations(
	settings: SettingsManager,
	keep: PackageDeclarationFilter,
): SettingsManager {
	if (patched.has(settings)) return settings;
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
	return settings;
}

export function withoutPackages(settings: SettingsManager): SettingsManager {
	return withPackageDeclarations(settings, () => false);
}
