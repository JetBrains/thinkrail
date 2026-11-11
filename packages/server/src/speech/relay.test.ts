import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpeechServerMessage, type SpeechServerMessage } from "@thinkrail/contracts";
import { observeLoggedErrors } from "../log";
import { enginePidForTests, resetEngineForTests, stopEngine } from "./engine";
import { initSpeech, resetSpeechInstallForTests } from "./install";
import { markerPath, modelsDir } from "./layout";
import { hostTarget, SPEECH_MANIFEST_ENV } from "./manifest";
import { createSpeechRelay } from "./relay";
import { resetSpeechStatusForTests } from "./status";

const posix = process.platform !== "win32";
const saved = {
	data: process.env.THINKRAIL_DATA_DIR,
	manifest: process.env[SPEECH_MANIFEST_ENV],
	path: process.env.PATH,
	log: process.env.FAKE_SPEECH_LOG,
	text: process.env.FAKE_SPEECH_TEXT,
	delay: process.env.FAKE_SPEECH_START_DELAY_MS,
};
let root: string;
const MODEL_BYTES = 1024;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "speech-relay-"));
	const bin = join(root, "bin");
	mkdirSync(bin);
	const script = join(bin, "nemo-speech");
	writeFileSync(
		script,
		`#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "fakeNemoSpeech.ts")}" "$@"\n`,
	);
	chmodSync(script, 0o755);
	const pin = { url: "http://127.0.0.1:9/x", sha256: "0".repeat(64), bytes: MODEL_BYTES };
	writeFileSync(
		join(root, "manifest.json"),
		JSON.stringify({
			runtimeVersion: "0.3.0",
			runtimes: { [hostTarget() ?? "linux-x64"]: { ...pin, root: "r", backend: "cpu" } },
			models: {
				multilingual: { ...pin, fileName: "multi.gguf", language: "auto" },
				english: { ...pin, fileName: "english.gguf", language: "en-US" },
			},
		}),
	);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
	process.env.THINKRAIL_DATA_DIR = mkdtempSync(join(root, "data-"));
	process.env[SPEECH_MANIFEST_ENV] = join(root, "manifest.json");
	process.env.PATH = `${join(root, "bin")}:/usr/bin:/bin`;
	process.env.FAKE_SPEECH_LOG = join(process.env.THINKRAIL_DATA_DIR, "sessions.log");
	process.env.FAKE_SPEECH_TEXT = "open useAppStore.tsx please";
	resetSpeechStatusForTests();
	resetSpeechInstallForTests();
});

afterEach(async () => {
	await stopEngine();
	resetEngineForTests();
	resetSpeechInstallForTests();
	resetSpeechStatusForTests();
	for (const [key, value] of Object.entries({
		THINKRAIL_DATA_DIR: saved.data,
		[SPEECH_MANIFEST_ENV]: saved.manifest,
		PATH: saved.path,
		FAKE_SPEECH_LOG: saved.log,
		FAKE_SPEECH_TEXT: saved.text,
		FAKE_SPEECH_START_DELAY_MS: saved.delay,
	})) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function installFixture(): void {
	mkdirSync(modelsDir(), { recursive: true });
	writeFileSync(join(modelsDir(), "multi.gguf"), new Uint8Array(MODEL_BYTES));
	writeFileSync(markerPath(), JSON.stringify({ model: "multilingual" }));
}

function clientSocket() {
	const messages: SpeechServerMessage[] = [];
	let notify: () => void = () => {};
	return {
		messages,
		socket: {
			send(message: string) {
				const parsed = parseSpeechServerMessage(message);
				if (parsed) messages.push(parsed);
				notify();
			},
			close() {},
		},
		async until(type: SpeechServerMessage["type"], timeoutMs = 10_000) {
			const deadline = Date.now() + timeoutMs;
			while (!messages.some((message) => message.type === type)) {
				if (Date.now() > deadline) throw new Error(`no ${type}: ${JSON.stringify(messages)}`);
				await new Promise<void>((resolve) => {
					notify = resolve;
					setTimeout(resolve, 50);
				});
			}
		},
	};
}

const word = () => new Uint8Array(16_000 * 2 * 0.16);

test.skipIf(!posix)("a dictation streams partials, a final and an end", async () => {
	installFixture();
	await initSpeech();
	const client = clientSocket();
	const relay = createSpeechRelay(client.socket);
	relay.message(JSON.stringify({ type: "start" }));
	relay.message(word());
	await client.until("ready");
	relay.message(word());
	relay.message(word());
	await client.until("partial");
	relay.message(JSON.stringify({ type: "stop" }));
	await client.until("ended");
	const partials = client.messages.filter((message) => message.type === "partial");
	expect(partials.at(-1)).toEqual({ type: "partial", text: "open useAppStore.tsx please" });
	expect(client.messages.filter((message) => message.type === "final")).toEqual([
		{ type: "final", text: "open useAppStore.tsx please" },
	]);
	expect(client.messages.at(-1)).toEqual({ type: "ended" });
	const session = JSON.parse(readFileSync(process.env.FAKE_SPEECH_LOG ?? "", "utf8").trim());
	expect(session.sample_rate).toBe(16_000);
	expect(session.language).toBe("auto");
	expect(session.speech_contexts).toBeUndefined();
});

test.skipIf(!posix)(
	"a dictation stopped before a cold engine is ready still transcribes",
	async () => {
		installFixture();
		await initSpeech();
		process.env.FAKE_SPEECH_START_DELAY_MS = "9000";
		const client = clientSocket();
		const relay = createSpeechRelay(client.socket);
		relay.message(JSON.stringify({ type: "start" }));
		for (let i = 0; i < 4; i += 1) relay.message(word());
		relay.message(JSON.stringify({ type: "stop" }));
		await client.until("ended", 20_000);
		expect(client.messages.filter((message) => message.type === "final")).toEqual([
			{ type: "final", text: "open useAppStore.tsx please" },
		]);
	},
	30_000,
);

test.skipIf(!posix)(
	"an engine stopped on purpose mid-dictation ends it without a report",
	async () => {
		installFixture();
		await initSpeech();
		const seen: unknown[] = [];
		observeLoggedErrors((_scope, error) => seen.push(error));
		try {
			const client = clientSocket();
			const relay = createSpeechRelay(client.socket);
			relay.message(JSON.stringify({ type: "start" }));
			await client.until("ready");
			await stopEngine();
			await client.until("ended");
			expect(client.messages).toContainEqual({ type: "error", code: "SPEECH_ENGINE_FAILED" });
			await Bun.sleep(1_200);
			expect(seen).toEqual([]);
		} finally {
			observeLoggedErrors(null);
		}
	},
);

test.skipIf(!posix)(
	"an engine that rejects a stream while running is reported by the relay",
	async () => {
		installFixture();
		await initSpeech();
		process.env.FAKE_SPEECH_STREAM_ERROR = "invalid_audio";
		const seen: Array<{ scope: string; code: unknown }> = [];
		observeLoggedErrors((scope, error) =>
			seen.push({ scope, code: error instanceof Error ? Reflect.get(error, "code") : undefined }),
		);
		try {
			const client = clientSocket();
			const relay = createSpeechRelay(client.socket);
			relay.message(JSON.stringify({ type: "start" }));
			await client.until("ready");
			relay.message(word());
			await client.until("ended");
			expect(client.messages).toContainEqual({ type: "error", code: "SPEECH_ENGINE_FAILED" });
			await Bun.sleep(1_200);
			expect(seen).toEqual([{ scope: "speech", code: "SPEECH_ENGINE_FAILED" }]);
		} finally {
			observeLoggedErrors(null);
			delete process.env.FAKE_SPEECH_STREAM_ERROR;
		}
	},
);

test.skipIf(!posix)("an engine that crashes mid-dictation is reported exactly once", async () => {
	installFixture();
	await initSpeech();
	const seen: Array<{ scope: string; code: unknown }> = [];
	observeLoggedErrors((scope, error) =>
		seen.push({ scope, code: error instanceof Error ? Reflect.get(error, "code") : undefined }),
	);
	try {
		const client = clientSocket();
		const relay = createSpeechRelay(client.socket);
		relay.message(JSON.stringify({ type: "start" }));
		await client.until("ready");
		const pid = enginePidForTests();
		expect(pid).not.toBeNull();
		process.kill(-(pid ?? 0), "SIGKILL");
		await client.until("ended");
		await Bun.sleep(1_500);
		expect(seen).toEqual([{ scope: "speech", code: "SPEECH_ENGINE_FAILED" }]);
	} finally {
		observeLoggedErrors(null);
	}
});

test.skipIf(!posix)("a second start while dictating is refused", async () => {
	installFixture();
	await initSpeech();
	const client = clientSocket();
	const relay = createSpeechRelay(client.socket);
	relay.message(JSON.stringify({ type: "start" }));
	relay.message(JSON.stringify({ type: "start" }));
	expect(client.messages).toContainEqual({ type: "error", code: "SPEECH_BUSY" });
	relay.close();
	await client.until("ended");
});

test("dictating before voice is installed fails with its code", async () => {
	await initSpeech();
	const client = clientSocket();
	const relay = createSpeechRelay(client.socket);
	relay.message(JSON.stringify({ type: "start" }));
	await client.until("ended");
	expect(client.messages).toEqual([
		{ type: "error", code: "SPEECH_NOT_INSTALLED" },
		{ type: "ended" },
	]);
});

test("a malformed control message is a protocol error", () => {
	const client = clientSocket();
	createSpeechRelay(client.socket).message('{"type":"begin"}');
	expect(client.messages).toEqual([{ type: "error", code: "SPEECH_PROTOCOL" }]);
});
