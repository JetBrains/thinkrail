import { readFileSync } from "node:fs";
import { isSpeechModel, type SpeechModel } from "@thinkrail/contracts";

export type SpeechTarget =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-x64"
	| "linux-arm64"
	| "win32-x64";

export interface SpeechArtifact {
	url: string;
	sha256: string;
	bytes: number;
}

export interface RuntimePin extends SpeechArtifact {
	/** The archive's single top-level directory, holding `bin/nemo-speech[.exe]`. */
	root: string;
	backend: string;
}

export interface ModelPin extends SpeechArtifact {
	fileName: string;
	/** The realtime session language: auto-detect for the multilingual model. */
	language: string;
}

export interface SpeechManifest {
	runtimeVersion: string;
	runtimes: Partial<Record<SpeechTarget, RuntimePin>>;
	models: Record<SpeechModel, ModelPin>;
}

/** Test seam: a JSON file replacing the pinned manifest (e2e serves tiny fixtures from it). */
export const SPEECH_MANIFEST_ENV = "THINKRAIL_SPEECH_MANIFEST";

const RUNTIME_VERSION = "0.3.0";
const RELEASE = `https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${RUNTIME_VERSION}`;

function runtime(name: string, ext: string, sha256: string, bytes: number, backend: string) {
	const root = `nemo-speech-${RUNTIME_VERSION}-${name}`;
	return { url: `${RELEASE}/${root}.${ext}`, sha256, bytes, root, backend };
}

const PINNED: SpeechManifest = {
	runtimeVersion: RUNTIME_VERSION,
	runtimes: {
		"darwin-arm64": runtime(
			"macos-aarch64-metal",
			"tar.gz",
			"2b972ed8b5dba07492212acf8cb75cbf34ecb141198ffa1997febe84b7c4d9ed",
			7_239_335,
			"metal",
		),
		"darwin-x64": runtime(
			"macos-x86_64-cpu",
			"tar.gz",
			"97e98aa5eb82dffa4f513f26336b5301d792c9fb43f720ac8f9520a0e92ffe3f",
			7_742_012,
			"cpu",
		),
		"linux-x64": runtime(
			"linux-x86_64-cpu",
			"tar.gz",
			"255f12b722ab15b2a38a51cf125d56e3fa97058b528f7e895b39d6a473deb06e",
			9_605_101,
			"cpu",
		),
		"linux-arm64": runtime(
			"linux-aarch64-cpu",
			"tar.gz",
			"56858eaf50d19b05902c043f65d0057352bdc107ae380c41053bfbddfc204bf1",
			9_064_856,
			"cpu",
		),
		"win32-x64": runtime(
			"windows-x86_64-cpu",
			"zip",
			"4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05",
			8_694_509,
			"cpu",
		),
	},
	models: {
		multilingual: {
			url: "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/ea30d66debe3740a08b573244286791d423d6b3e/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf",
			sha256: "3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1",
			bytes: 742_090_464,
			fileName: "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf",
			language: "auto",
		},
		english: {
			url: "https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/resolve/ebe59e5a817142986528bbbee5dba8db7b38ed50/nemotron-speech-streaming-en-0.6b.q8_0.gguf",
			sha256: "d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d",
			bytes: 699_872_960,
			fileName: "nemotron-speech-streaming-en-0.6b.q8_0.gguf",
			language: "en-US",
		},
	},
};

/** Windows on Arm runs the x64 build under emulation; NVIDIA ships no CPU arm64 Windows build. */
export function hostTarget(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): SpeechTarget | null {
	if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	if (platform === "linux") {
		if (arch === "x64") return "linux-x64";
		if (arch === "arm64") return "linux-arm64";
		return null;
	}
	if (platform === "win32" && (arch === "x64" || arch === "arm64")) return "win32-x64";
	return null;
}

function isArtifact(value: unknown): value is SpeechArtifact {
	if (typeof value !== "object" || value === null) return false;
	const sha256 = Reflect.get(value, "sha256");
	const bytes = Reflect.get(value, "bytes");
	return (
		typeof Reflect.get(value, "url") === "string" &&
		typeof sha256 === "string" &&
		/^[0-9a-f]{64}$/.test(sha256) &&
		typeof bytes === "number" &&
		Number.isSafeInteger(bytes) &&
		bytes > 0
	);
}

function isSafeName(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) && !value.startsWith(".");
}

function isRuntimePin(value: unknown): value is RuntimePin {
	return (
		isArtifact(value) &&
		isSafeName(Reflect.get(value, "root")) &&
		typeof Reflect.get(value, "backend") === "string"
	);
}

function isModelPin(value: unknown): value is ModelPin {
	return (
		isArtifact(value) &&
		isSafeName(Reflect.get(value, "fileName")) &&
		typeof Reflect.get(value, "language") === "string"
	);
}

const SPEECH_TARGETS: readonly SpeechTarget[] = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
	"win32-x64",
];

function isSpeechTarget(value: string): value is SpeechTarget {
	return SPEECH_TARGETS.some((target) => target === value);
}

function modelPin(models: object, model: SpeechModel): ModelPin {
	const pin = Reflect.get(models, model);
	if (!isModelPin(pin)) throw new Error(`speech manifest: bad model ${model}`);
	return pin;
}

export function parseManifest(value: unknown): SpeechManifest {
	if (typeof value !== "object" || value === null)
		throw new Error("speech manifest: not an object");
	const runtimeVersion = Reflect.get(value, "runtimeVersion");
	const runtimes = Reflect.get(value, "runtimes");
	const models = Reflect.get(value, "models");
	if (!isSafeName(runtimeVersion)) throw new Error("speech manifest: bad runtimeVersion");
	if (typeof runtimes !== "object" || runtimes === null)
		throw new Error("speech manifest: runtimes");
	if (typeof models !== "object" || models === null) throw new Error("speech manifest: models");
	const parsedRuntimes: Partial<Record<SpeechTarget, RuntimePin>> = {};
	for (const [target, pin] of Object.entries(runtimes)) {
		if (!isSpeechTarget(target) || !isRuntimePin(pin)) {
			throw new Error(`speech manifest: bad runtime ${target}`);
		}
		parsedRuntimes[target] = pin;
	}
	for (const key of Object.keys(models)) {
		if (!isSpeechModel(key)) throw new Error(`speech manifest: unknown model ${key}`);
	}
	return {
		runtimeVersion,
		runtimes: parsedRuntimes,
		models: {
			multilingual: modelPin(models, "multilingual"),
			english: modelPin(models, "english"),
		},
	};
}

export function loadManifest(
	env: Record<string, string | undefined> = process.env,
): SpeechManifest {
	const override = env[SPEECH_MANIFEST_ENV];
	if (!override) return PINNED;
	return parseManifest(JSON.parse(readFileSync(override, "utf8")));
}
