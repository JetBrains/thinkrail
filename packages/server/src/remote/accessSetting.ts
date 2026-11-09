import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../persistence";

const SETTING_FILE = "remote-access.json";
const SETTING_VERSION = 1;

interface StoredSetting {
	version: number;
	enabled: boolean;
}

/** Whether the user turned phone access on in Settings; off when never set or unreadable. */
export function loadRemoteAccessEnabled(dir: string = dataDir()): boolean {
	const path = join(dir, SETTING_FILE);
	if (!existsSync(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredSetting;
		return parsed.version === SETTING_VERSION && parsed.enabled === true;
	} catch {
		return false;
	}
}

export function saveRemoteAccessEnabled(enabled: boolean, dir: string = dataDir()): void {
	mkdirSync(dir, { recursive: true });
	const payload: StoredSetting = { version: SETTING_VERSION, enabled };
	writeFileSync(join(dir, SETTING_FILE), `${JSON.stringify(payload, null, "\t")}\n`, {
		mode: 0o600,
	});
}
