import { logger } from "../log";
import {
	type ExtensionInstaller,
	InstalledExtensions,
	installedExtensions,
	type NpmCommand,
	piExtensionInstaller,
	setInstalledExtensions,
} from "./installed";
import { builtinServerExtensions } from "./registry";
import { skillPackageRoots } from "./skills";

const log = logger("extensions");

export interface InstalledExtensionsHostOptions {
	dataDir: string;
	onChange: () => void;
	/** The user's pi `npmCommand`, read at each install. */
	npmCommand?: NpmCommand;
	installer?: ExtensionInstaller;
}

/** Starts the host's installed-extension runtime: watches `extensions.json` and reconciles in the background. */
export function startInstalledExtensions(options: InstalledExtensionsHostOptions): () => void {
	const runtime = new InstalledExtensions({
		dataDir: options.dataDir,
		reservedNames: () => builtinServerExtensions.map((entry) => entry.extension.name),
		skillRoots: skillPackageRoots,
		onChange: options.onChange,
		installer: options.installer ?? piExtensionInstaller(options.npmCommand),
	});
	setInstalledExtensions(runtime);
	const stopWatching = runtime.watch();
	void runtime.reconcile().catch((error) => log.warn("installed extensions did not load", error));
	return () => {
		stopWatching();
		if (installedExtensions() === runtime) setInstalledExtensions(undefined);
	};
}
