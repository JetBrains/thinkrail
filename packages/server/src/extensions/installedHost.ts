import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { logger } from "../log";
import { extensionToolNames, setHostToolFactories } from "./catalog";
import {
	type ExtensionInstaller,
	InstalledExtensions,
	installedExtensions,
	type NpmCommand,
	piExtensionInstaller,
	setInstalledExtensions,
} from "./installed";
import { builtinExtensionNames } from "./registry";
import { skillPackageRoots } from "./skills";

const log = logger("extensions");

export interface InstalledExtensionsHostOptions {
	dataDir: string;
	onChange: () => void;
	/** The user's pi `npmCommand`, read at each install. */
	npmCommand?: NpmCommand;
	installer?: ExtensionInstaller;
	/** The names of the host's own named inline extensions (pi's built-in slots it supplies), also reserved. */
	hostExtensionNames?: readonly string[];
	/** The host's own static inline factories; an installed extension's same-named tools are listed as shadowed. */
	hostToolFactories?: readonly ExtensionFactory[];
}

/** Starts the host's installed-extension runtime: watches `extensions.json` and reconciles in the background. */
export function startInstalledExtensions(options: InstalledExtensionsHostOptions): () => void {
	setHostToolFactories(options.hostToolFactories ?? []);
	const runtime = new InstalledExtensions({
		dataDir: options.dataDir,
		reservedNames: () => [...builtinExtensionNames(), ...(options.hostExtensionNames ?? [])],
		skillRoots: skillPackageRoots,
		onChange: options.onChange,
		toolNames: (extension) => extensionToolNames(extension),
		installer: options.installer ?? piExtensionInstaller(options.npmCommand),
	});
	setInstalledExtensions(runtime);
	const stopWatching = runtime.watch();
	void runtime.reconcile().catch((error) => log.warn("installed extensions did not load", error));
	return () => {
		stopWatching();
		if (installedExtensions() !== runtime) return;
		setInstalledExtensions(undefined);
		setHostToolFactories([]);
	};
}
