import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { SpeechStatus } from "@thinkrail/contracts";
import {
	cancelSpeechInstall,
	engineInputs,
	initSpeech,
	installSpeech,
	removeSpeech,
	resetSpeechInstallForTests,
	speechInstallSettled,
	stopSpeechInstall,
} from "./install";
import { markerPath, modelsDir, speechDir } from "./layout";
import { hostTarget, SPEECH_MANIFEST_ENV } from "./manifest";
import { resetSpeechStatusForTests, setSpeechPublisher, speechStatus } from "./status";
import { type ServedFile, serveFiles, sha256 } from "./testServer";

const saved = {
	data: process.env.THINKRAIL_DATA_DIR,
	manifest: process.env[SPEECH_MANIFEST_ENV],
	path: process.env.PATH,
};
const target = hostTarget();
const ROOT = "nemo-speech-0.3.0-test";
let root: string;
let runtimeArchive: Uint8Array;
const multilingual = new Uint8Array(40_000).fill(7);
const english = new Uint8Array(30_000).fill(9);
let files: Map<string, ServedFile>;
let server: ReturnType<typeof serveFiles>;
let pushes: SpeechStatus[];

function writeFakeBinary(dir: string, version: string): void {
	mkdirSync(dir, { recursive: true });
	const script = join(dir, "nemo-speech");
	writeFileSync(
		script,
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo "nemo-speech ${version}"; else echo '{"features":{"backend_metal":true}}'; fi\n`,
	);
	chmodSync(script, 0o755);
	writeFileSync(join(dir, "nemo-speech.exe"), "");
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "speech-install-"));
	const archiveSrc = join(root, "archive-src");
	writeFakeBinary(join(archiveSrc, ROOT, "bin"), "0.3.0");
	const archivePath = join(root, "runtime.tar.gz");
	const tar = Bun.spawnSync(["tar", "-czf", archivePath, "-C", archiveSrc, ROOT]);
	if (tar.exitCode !== 0) throw new Error("could not build the runtime fixture");
	runtimeArchive = new Uint8Array(readFileSync(archivePath));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeManifest(overrides: { runtimes?: object; multilingualSha?: string } = {}): void {
	const manifestPath = join(root, "manifest.json");
	writeFileSync(
		manifestPath,
		JSON.stringify({
			runtimeVersion: "0.3.0",
			runtimes: overrides.runtimes ?? {
				[target ?? "linux-x64"]: {
					url: server.url("/runtime.tar.gz"),
					sha256: sha256(runtimeArchive),
					bytes: runtimeArchive.length,
					root: ROOT,
					backend: "cpu",
				},
			},
			models: {
				multilingual: {
					url: server.url("/multi.gguf"),
					sha256: overrides.multilingualSha ?? sha256(multilingual),
					bytes: multilingual.length,
					fileName: "multi.gguf",
					language: "auto",
				},
				english: {
					url: server.url("/english.gguf"),
					sha256: sha256(english),
					bytes: english.length,
					fileName: "english.gguf",
					language: "en-US",
				},
			},
		}),
	);
	process.env[SPEECH_MANIFEST_ENV] = manifestPath;
}

let pathDir = "";

beforeEach(() => {
	process.env.THINKRAIL_DATA_DIR = mkdtempSync(join(root, "data-"));
	pathDir = mkdtempSync(join(root, "path-"));
	process.env.PATH = [pathDir, "/usr/bin", "/bin"].join(delimiter);
	files = new Map([
		["/runtime.tar.gz", { body: runtimeArchive }],
		["/multi.gguf", { body: multilingual }],
		["/english.gguf", { body: english }],
	]);
	server = serveFiles(files);
	writeManifest();
	resetSpeechStatusForTests();
	resetSpeechInstallForTests();
	pushes = [];
	setSpeechPublisher((status) => pushes.push(status));
});

afterEach(async () => {
	await speechInstallSettled();
	server.stop();
	resetSpeechInstallForTests();
	resetSpeechStatusForTests();
	for (const [key, value] of [
		["THINKRAIL_DATA_DIR", saved.data],
		[SPEECH_MANIFEST_ENV, saved.manifest],
		["PATH", saved.path],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const posix = process.platform !== "win32";

test.skipIf(!target)("a fresh host reports voice as supported and not installed", async () => {
	await initSpeech();
	const status = speechStatus();
	expect(status.supported).toBe(true);
	expect(status.install).toEqual({ status: "not-installed" });
	expect(status.runtime).toBeNull();
	expect(status.downloadBytes).toEqual({
		multilingual: runtimeArchive.length + multilingual.length,
		english: runtimeArchive.length + english.length,
	});
	expect(engineInputs()).toBeNull();
});

test.skipIf(!target)("installing downloads the runtime and model, then reports ready", async () => {
	await initSpeech();
	installSpeech("multilingual");
	await speechInstallSettled();
	const status = speechStatus();
	expect(status.install).toEqual({ status: "ready", model: "multilingual" });
	expect(status.runtime).toEqual({ source: "managed", version: "0.3.0", backend: "cpu" });
	expect(status.downloadBytes).toEqual({ multilingual: 0, english: english.length });
	expect(status.diskBytes).toBeGreaterThan(multilingual.length);
	expect(pushes.some((push) => push.install.status === "installing")).toBe(true);
	expect(JSON.parse(readFileSync(markerPath(), "utf8"))).toEqual({ model: "multilingual" });
	const inputs = engineInputs();
	expect(inputs?.language).toBe("auto");
	expect(inputs && existsSync(inputs.bin)).toBe(true);
	expect(inputs?.modelPath).toBe(join(modelsDir(), "multi.gguf"));
	expect(existsSync(join(speechDir(), ".staging", "runtime.tar.gz"))).toBe(false);
});

test.skipIf(!target)(
	"switching models downloads only the new model and deletes the old one",
	async () => {
		await initSpeech();
		installSpeech("multilingual");
		await speechInstallSettled();
		const before = server.requests.length;
		installSpeech("english");
		await speechInstallSettled();
		expect(speechStatus().install).toEqual({ status: "ready", model: "english" });
		expect(server.requests.slice(before).map((request) => request.path)).toEqual(["/english.gguf"]);
		expect(existsSync(join(modelsDir(), "multi.gguf"))).toBe(false);
		expect(engineInputs()?.language).toBe("en-US");
	},
);

test.skipIf(!target)("a checksum mismatch fails with its code, and a retry succeeds", async () => {
	writeManifest({ multilingualSha: "0".repeat(64) });
	await initSpeech();
	installSpeech("multilingual");
	await speechInstallSettled();
	expect(speechStatus().install).toEqual({
		status: "failed",
		model: "multilingual",
		code: "SPEECH_CHECKSUM_MISMATCH",
		usable: null,
	});
	writeManifest();
	await initSpeech();
	installSpeech("multilingual");
	await speechInstallSettled();
	expect(speechStatus().install).toEqual({ status: "ready", model: "multilingual" });
});

test.skipIf(!target)("a failed switch keeps the installed model usable", async () => {
	await initSpeech();
	installSpeech("english");
	await speechInstallSettled();
	writeManifest({ multilingualSha: "0".repeat(64) });
	await initSpeech();
	installSpeech("multilingual");
	await speechInstallSettled();
	expect(speechStatus().install).toEqual({
		status: "failed",
		model: "multilingual",
		code: "SPEECH_CHECKSUM_MISMATCH",
		usable: "english",
	});
	expect(engineInputs()?.model).toBe("english");
});

test.skipIf(!target)("an installed model clears the other model's stale partial", async () => {
	await initSpeech();
	mkdirSync(modelsDir(), { recursive: true });
	writeFileSync(join(modelsDir(), "multi.gguf.partial"), multilingual.slice(0, 100));
	installSpeech("english");
	await speechInstallSettled();
	expect(existsSync(join(modelsDir(), "multi.gguf.partial"))).toBe(false);
});

test.skipIf(!target)("a second install while one runs is refused", async () => {
	await initSpeech();
	installSpeech("multilingual");
	expect(() => installSpeech("english")).toThrow(
		expect.objectContaining({ code: "SPEECH_INSTALL_BUSY" }),
	);
});

test.skipIf(!target)("cancelling returns to the previous state and discards partials", async () => {
	await initSpeech();
	installSpeech("multilingual");
	cancelSpeechInstall();
	await speechInstallSettled();
	expect(speechStatus().install).toEqual({ status: "not-installed" });
	expect(existsSync(join(modelsDir(), "multi.gguf.partial"))).toBe(false);
	expect(existsSync(join(speechDir(), ".staging"))).toBe(false);
});

test.skipIf(!target)(
	"a host shutdown mid-install keeps the partials for the next launch",
	async () => {
		await initSpeech();
		mkdirSync(modelsDir(), { recursive: true });
		writeFileSync(join(modelsDir(), "multi.gguf.partial"), multilingual.slice(0, 100));
		installSpeech("multilingual");
		stopSpeechInstall();
		await speechInstallSettled();
		expect(existsSync(join(modelsDir(), "multi.gguf.partial"))).toBe(true);
	},
);

test.skipIf(!target)("removing deletes ThinkRail's speech files", async () => {
	await initSpeech();
	installSpeech("multilingual");
	await speechInstallSettled();
	await removeSpeech();
	expect(existsSync(speechDir())).toBe(false);
	expect(speechStatus().install).toEqual({ status: "not-installed" });
	expect(speechStatus().runtime).toBeNull();
});

test.skipIf(!target || !posix)(
	"a compatible nemo-speech on PATH replaces the runtime download",
	async () => {
		writeFakeBinary(pathDir, "0.3.4");
		await initSpeech();
		expect(speechStatus().runtime).toEqual({ source: "path", version: "0.3.4", backend: "metal" });
		expect(speechStatus().downloadBytes.multilingual).toBe(multilingual.length);
		installSpeech("multilingual");
		await speechInstallSettled();
		expect(server.requests.map((request) => request.path)).toEqual(["/multi.gguf"]);
		expect(engineInputs()?.bin).toBe(join(pathDir, "nemo-speech"));
	},
);

test.skipIf(!target || !posix)(
	"an install started while startup still probes PATH keeps its progress",
	async () => {
		const script = join(pathDir, "nemo-speech");
		writeFileSync(script, '#!/bin/sh\nsleep 1\necho "nemo-speech 0.4.0"\n');
		chmodSync(script, 0o755);
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		files.set("/multi.gguf", { body: multilingual, gate });
		const init = initSpeech();
		installSpeech("multilingual");
		await init;
		expect(speechStatus().install.status).toBe("installing");
		open();
		await speechInstallSettled();
		expect(speechStatus().install).toEqual({ status: "ready", model: "multilingual" });
	},
);

test.skipIf(!target || !posix)("an incompatible nemo-speech on PATH is ignored", async () => {
	writeFakeBinary(pathDir, "0.4.0");
	await initSpeech();
	expect(speechStatus().runtime).toBeNull();
});

test("a platform without a pinned runtime is unsupported", async () => {
	writeManifest({ runtimes: {} });
	await initSpeech();
	expect(speechStatus().supported).toBe(false);
	expect(() => installSpeech("multilingual")).toThrow(
		expect.objectContaining({ code: "SPEECH_UNSUPPORTED_PLATFORM" }),
	);
});
