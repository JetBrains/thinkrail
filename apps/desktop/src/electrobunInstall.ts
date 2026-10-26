import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ElectrobunInstall {
	identifier: string;
	channel: string;
	startMenuShortcut: string | null;
}

const MANIFEST_NAME = ".electrobun-uninstall.json";

function text(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

export function readElectrobunInstall(appDir: string): ElectrobunInstall | null {
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(join(dirname(appDir), MANIFEST_NAME), "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
	if (!manifest || typeof manifest !== "object") return null;
	if (!("schema_version" in manifest) || manifest.schema_version !== 1) return null;
	const identifier = "identifier" in manifest ? text(manifest.identifier) : null;
	const channel = "channel" in manifest ? text(manifest.channel) : null;
	if (!identifier || !channel) return null;
	return {
		identifier,
		channel,
		startMenuShortcut:
			"start_menu_shortcut" in manifest ? text(manifest.start_menu_shortcut) : null,
	};
}
