import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * pi caches extension factories process-wide and clears that cache only when an already-loaded
 * loader reloads; a loader that loads nothing and reloads twice is the cheapest way to make the
 * next load read the files on disk.
 */
export async function advancePiExtensionCache(agentDir: string): Promise<void> {
	const loader = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	await loader.reload();
}
