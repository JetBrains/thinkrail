import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBunExecutable } from "./executables";
import { E2E_SPEECH_FIXTURE_DIR, E2E_SPEECH_MANIFEST } from "./paths";

/** What the fake engine "hears" in every dictation; one word per 160 ms of audio. */
export const FAKE_SPEECH_TEXT = "Hello from the fake engine";

const ROOT = "nemo-speech-0.3.0-e2e";
const FAKE_ENGINE = fileURLToPath(
	new URL("../../packages/server/src/speech/fakeNemoSpeech.ts", import.meta.url),
);

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function artifact(path: string) {
	return {
		url: pathToFileURL(path).href,
		sha256: sha256(path),
		bytes: readFileSync(path).byteLength,
	};
}

/**
 * Writes a manifest whose runtime archive holds a `nemo-speech` wrapper around the repo's fake engine
 * and whose models are a few KB, so the e2e host installs voice input in milliseconds and offline.
 */
export function seedSpeechFixture(): void {
	const bin = join(E2E_SPEECH_FIXTURE_DIR, "src", ROOT, "bin");
	mkdirSync(bin, { recursive: true });
	const wrapper = join(bin, "nemo-speech");
	writeFileSync(
		wrapper,
		`#!/bin/sh\nexec ${JSON.stringify(resolveBunExecutable())} ${JSON.stringify(FAKE_ENGINE)} "$@"\n`,
	);
	chmodSync(wrapper, 0o755);
	writeFileSync(join(bin, "nemo-speech.exe"), "");
	const archive = join(E2E_SPEECH_FIXTURE_DIR, `${ROOT}.tar.gz`);
	const tar = spawnSync("tar", ["-czf", archive, "-C", join(E2E_SPEECH_FIXTURE_DIR, "src"), ROOT]);
	if (tar.status !== 0) throw new Error(`could not pack the fake speech runtime: ${tar.stderr}`);
	const runtime = { ...artifact(archive), root: ROOT, backend: "cpu" };
	const models = { multilingual: "multilingual.gguf", english: "english.gguf" } as const;
	for (const [model, fileName] of Object.entries(models)) {
		writeFileSync(join(E2E_SPEECH_FIXTURE_DIR, fileName), `fake ${model} model\n`.repeat(64));
	}
	const model = (fileName: string, language: string) => ({
		...artifact(join(E2E_SPEECH_FIXTURE_DIR, fileName)),
		fileName,
		language,
	});
	writeFileSync(
		E2E_SPEECH_MANIFEST,
		JSON.stringify({
			runtimeVersion: "0.3.0",
			runtimes: {
				"darwin-arm64": runtime,
				"darwin-x64": runtime,
				"linux-x64": runtime,
				"linux-arm64": runtime,
			},
			models: {
				multilingual: model(models.multilingual, "auto"),
				english: model(models.english, "en-US"),
			},
		}),
	);
}
