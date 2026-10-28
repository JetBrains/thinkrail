import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { refreshExtensionTools } from "./agentSessionManager";
import { bumpPackagesRevision, setResolvedPackagesListener } from "./extensions";
import { invalidatePiPackageCatalog, invalidatePiPackageUpdates } from "./packages";

type PiPackagesPublisher = () => void;

let publish: PiPackagesPublisher | null = null;

export function setPiPackagesPublisher(fn: PiPackagesPublisher | null): void {
	publish = fn;
}

setResolvedPackagesListener(() => publish?.());

/**
 * The declared or installed package set changed (own mutation, outside edit, repository checkout):
 * every chat re-decides through the gated reload — idle ones now, busy ones when their turn ends —
 * and open pages re-list.
 */
export function refreshPiPackages(): void {
	bumpPackagesRevision();
	invalidatePiPackageCatalog();
	invalidatePiPackageUpdates();
	refreshExtensionTools();
	publish?.();
}

const RESOURCE_KEYS = ["packages", "extensions", "skills", "prompts"] as const;

function resourceFingerprint(path: string): string {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		return JSON.stringify(RESOURCE_KEYS.map((key) => record[key] ?? null));
	} catch {
		return "";
	}
}

const seenSettings = new Map<string, string>();

/** Records the user settings file's current declarations so only a later semantic change refreshes. */
export function primeUserPiSettings(): void {
	const path = join(getAgentDir(), "settings.json");
	seenSettings.set(resolve(path), resourceFingerprint(path));
}

/** A workspace change touched its repository's `.pi/settings.json` (or `.pi` itself). */
export function handleProjectPiSettingsChanged(worktreePath: string): boolean {
	return handlePiSettingsFileChanged(join(worktreePath, ".pi", "settings.json"));
}

/**
 * A pi settings file changed on disk. Only a change to its `packages` / `extensions` / `skills` /
 * `prompts` declarations counts — an unrelated setting, or the echo of the host's own write, does not.
 */
export function handlePiSettingsFileChanged(path: string): boolean {
	const key = resolve(path);
	const next = resourceFingerprint(path);
	const previous = seenSettings.get(key);
	seenSettings.set(key, next);
	if (previous === next) return false;
	refreshPiPackages();
	return true;
}
