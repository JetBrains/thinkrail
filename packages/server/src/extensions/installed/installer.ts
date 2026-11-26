import { type Dirent, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export type CommandOutput = "inherit" | "capture";

export interface ExtensionInstaller {
	install(source: string, installDir: string, output?: CommandOutput): Promise<string>;
	hasUpdate(source: string, installDir: string): Promise<boolean>;
}

export type NpmCommand = () => string[] | undefined;

const HOST_OWNED_DEPENDENCIES = ["@earendil-works", "typebox"];

function packageManager(
	installDir: string,
	npmCommand: NpmCommand,
	sources: readonly string[] = [],
	commandOutput: CommandOutput = "inherit",
): DefaultPackageManager {
	const command = npmCommand();
	return new DefaultPackageManager({
		cwd: installDir,
		agentDir: installDir,
		commandOutput,
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
		async install(source, installDir, output = "inherit") {
			mkdirSync(installDir, { recursive: true });
			const manager = packageManager(installDir, npmCommand, [], output);
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
