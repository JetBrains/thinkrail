import { statSync } from "node:fs";
import { resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { advancePiExtensionCache } from "./extensionCache";

export interface LoadedExtensionInfo {
	tools?: string[];
	commands?: string[];
	error?: string;
}

interface LoadedExtensions {
	extensions: ReadonlyArray<{
		resolvedPath: string;
		tools: ReadonlyMap<string, unknown>;
		commands: ReadonlyMap<string, unknown>;
	}>;
	errors: ReadonlyArray<{ path: string; error: string }>;
}

const memo = new Map<string, { mtimeMs: number; info: LoadedExtensionInfo }>();

function fileMtime(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

/** What a loader saw when it loaded these files; a chat's load and the install probe both report here. */
export function recordLoadedExtensions(result: LoadedExtensions): void {
	const fresh = new Map<string, LoadedExtensionInfo>();
	for (const extension of result.extensions) {
		fresh.set(resolve(extension.resolvedPath), {
			tools: [...extension.tools.keys()],
			commands: [...extension.commands.keys()],
		});
	}
	for (const failure of result.errors) {
		const key = resolve(failure.path);
		fresh.set(key, { ...fresh.get(key), error: failure.error });
	}
	for (const [key, info] of fresh) {
		const mtimeMs = fileMtime(key);
		if (mtimeMs !== undefined) memo.set(key, { mtimeMs, info });
	}
}

/** The last recorded load of this file, as long as the file has not changed since. */
export function knownExtensionInfo(path: string): LoadedExtensionInfo | undefined {
	const key = resolve(path);
	const entry = memo.get(key);
	if (!entry) return undefined;
	return fileMtime(key) === entry.mtimeMs ? entry.info : undefined;
}

export function forgetExtensionInfo(): void {
	memo.clear();
}

// In-memory settings + noExtensions: this loader can never install a declared-but-missing package.
export async function probeExtensionInfo(
	cwd: string,
	agentDir: string,
	paths: readonly string[],
): Promise<void> {
	if (paths.length === 0) return;
	await advancePiExtensionCache(agentDir);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		noExtensions: true,
		additionalExtensionPaths: [...paths],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	recordLoadedExtensions(loader.getExtensions());
}
