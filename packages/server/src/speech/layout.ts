import { join } from "node:path";
import { dataDir } from "../persistence";
import type { SpeechTarget } from "./manifest";

/** Everything ThinkRail itself stores for voice input; never holds a user's own `nemo-speech`. */
export function speechDir(): string {
	return join(dataDir(), "speech");
}

export function runtimeDir(version: string, target: SpeechTarget): string {
	return join(speechDir(), "runtime", `${version}-${target}`);
}

export function runtimeBinary(dir: string, platform: NodeJS.Platform = process.platform): string {
	return join(dir, "bin", platform === "win32" ? "nemo-speech.exe" : "nemo-speech");
}

export function modelsDir(): string {
	return join(speechDir(), "models");
}

export function stagingDir(): string {
	return join(speechDir(), ".staging");
}

/** Written once every file it names is verified; its absence means nothing is installed. */
export function markerPath(): string {
	return join(speechDir(), "installed.json");
}
