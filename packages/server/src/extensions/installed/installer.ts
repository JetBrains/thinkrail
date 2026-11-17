import { type Dirent, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ExtensionInstaller {
	/** Installs an npm or git source into `installDir`; resolves the package root relative to it. */
	install(source: string, installDir: string): Promise<string>;
	/** Whether the source installed in `installDir` has a newer version. */
	hasUpdate(source: string, installDir: string): Promise<boolean>;
}

const HOST_OWNED_DEPENDENCIES = ["@earendil-works", "typebox"];

function packageManager(
	installDir: string,
	sources: readonly string[] = [],
): DefaultPackageManager {
	return new DefaultPackageManager({
		cwd: installDir,
		agentDir: installDir,
		settingsManager: SettingsManager.inMemory({ packages: [...sources] }),
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

export const piExtensionInstaller: ExtensionInstaller = {
	async install(source, installDir) {
		mkdirSync(installDir, { recursive: true });
		const manager = packageManager(installDir);
		await manager.install(source);
		const root = manager.getInstalledPath(source, "user");
		if (root === undefined) throw new Error(`pi installed ${source} but reports no install folder`);
		pruneHostOwnedDependencies(installDir);
		return relative(installDir, root);
	},
	async hasUpdate(source, installDir) {
		const updates = await packageManager(installDir, [source]).checkForAvailableUpdates();
		return updates.length > 0;
	},
};
