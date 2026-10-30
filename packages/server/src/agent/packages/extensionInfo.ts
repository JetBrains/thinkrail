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
let changedListener: (() => void) | null = null;

/** Called when a recorded load changed what the catalog would show for some file. */
export function setExtensionInfoListener(listener: (() => void) | null): void {
	changedListener = listener;
}

function sameInfo(a: LoadedExtensionInfo, b: LoadedExtensionInfo): boolean {
	return (
		a.error === b.error &&
		(a.tools ?? []).join("\0") === (b.tools ?? []).join("\0") &&
		(a.commands ?? []).join("\0") === (b.commands ?? []).join("\0")
	);
}

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
	let changed = false;
	for (const [key, info] of fresh) {
		const mtimeMs = fileMtime(key);
		if (mtimeMs === undefined) continue;
		const previous = memo.get(key);
		if (!previous || previous.mtimeMs !== mtimeMs || !sameInfo(previous.info, info)) changed = true;
		memo.set(key, { mtimeMs, info });
	}
	if (changed) changedListener?.();
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
