import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

// pi clears its process-wide factory cache only on a loaded loader's reload; see the packages SPEC.
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
