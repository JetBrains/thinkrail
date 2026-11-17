import { type Dirent, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ExtensionInstaller {
	/** Installs an npm or git source into `installDir`; resolves the package root relative to it. */
	install(source: string, installDir: string): Promise<string>;
	/** Whether the source installed in `installDir` has a newer version. */
	hasUpdate(source: string, installDir: string): Promise<boolean>;
}

/** The npm command the user configured for pi (`npmCommand`), or `undefined` for pi's default. */
export type NpmCommand = () => string[] | undefined;

const HOST_OWNED_DEPENDENCIES = ["@earendil-works", "typebox"];

function packageManager(
	installDir: string,
	npmCommand: NpmCommand,
	sources: readonly string[] = [],
): DefaultPackageManager {
	const command = npmCommand();
	return new DefaultPackageManager({
		cwd: installDir,
		agentDir: installDir,
		settingsManager: SettingsManager.inMemory({
			packages: [...sources],
			...(command && command.length > 0 ? { npmCommand: command } : {}),
		}),
	});
}

export function pruneHostOwnedDependencies(dir: string): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === ".git") continue;
		const path = join(dir, entry.name);
		if (entry.name === "node_modules") {
			for (const owned of HOST_OWNED_DEPENDENCIES) {
				rmSync(join(path, owned), { recursive: true, force: true });
			}
		}
		pruneHostOwnedDependencies(path);
	}
}

export function piExtensionInstaller(npmCommand: NpmCommand = () => undefined): ExtensionInstaller {
	return {
		async install(source, installDir) {
			mkdirSync(installDir, { recursive: true });
			const manager = packageManager(installDir, npmCommand);
			await manager.install(source);
			const root = manager.getInstalledPath(source, "user");
			if (root === undefined)
				throw new Error(`pi installed ${source} but reports no install folder`);
			pruneHostOwnedDependencies(installDir);
			return relative(installDir, root);
		},
		async hasUpdate(source, installDir) {
			const manager = packageManager(installDir, npmCommand, [source]);
			return (await manager.checkForAvailableUpdates()).length > 0;
		},
	};
}
