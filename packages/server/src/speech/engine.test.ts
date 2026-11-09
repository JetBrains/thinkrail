import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeLoggedErrors } from "../log";
import {
	ensureEngine,
	holdEngine,
	resetEngineForTests,
	setEngineIdleMsForTests,
	stopEngine,
} from "./engine";
import { resetSpeechStatusForTests, speechStatus } from "./status";

const posix = process.platform !== "win32";
let dir: string;
let bin: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "speech-engine-"));
	bin = join(dir, "nemo-speech");
	writeFileSync(
		bin,
		`#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "fakeNemoSpeech.ts")}" "$@"\n`,
	);
	chmodSync(bin, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function reported(): Array<{ scope: string; code: unknown }> {
	const seen: Array<{ scope: string; code: unknown }> = [];
	observeLoggedErrors((scope, error) =>
		seen.push({ scope, code: error instanceof Error ? Reflect.get(error, "code") : undefined }),
	);
	return seen;
}

afterEach(async () => {
	observeLoggedErrors(null);
	await stopEngine();
	delete process.env.FAKE_SPEECH_FAIL_START;
	delete process.env.FAKE_SPEECH_START_DELAY_MS;
	resetEngineForTests();
	resetSpeechStatusForTests();
});

const inputs = (modelPath = join(dir, "multi.gguf")) => ({
	bin,
	modelPath,
	language: "auto",
	model: "multilingual" as const,
});

function httpBase(realtimeUrl: string): string {
	const url = new URL(realtimeUrl);
	return `http://${url.host}`;
}

test.skipIf(!posix)("the engine starts on loopback behind a per-launch api key", async () => {
	const endpoint = await ensureEngine(inputs());
	expect(speechStatus().engine).toBe("ready");
	expect(endpoint.realtimeUrl).toStartWith("ws://127.0.0.1:");
	expect(endpoint.realtimeUrl).toEndWith("/v1/audio/transcriptions/realtime");
	const base = httpBase(endpoint.realtimeUrl);
	expect((await fetch(`${base}/v1/models`)).status).toBe(401);
	const authed = await fetch(`${base}/v1/models`, {
		headers: { Authorization: `Bearer ${endpoint.apiKey}` },
	});
	expect(authed.status).toBe(200);
});

test.skipIf(!posix)("the same inputs reuse the engine and a new model replaces it", async () => {
	const first = await ensureEngine(inputs());
	expect(await ensureEngine(inputs())).toEqual(first);
	const second = await ensureEngine(inputs(join(dir, "english.gguf")));
	expect(second.apiKey).not.toBe(first.apiKey);
	await expect(fetch(`${httpBase(first.realtimeUrl)}/health`)).rejects.toThrow();
});

test.skipIf(!posix)("an idle engine stops, but never while a dictation holds it", async () => {
	setEngineIdleMsForTests(60);
	await ensureEngine(inputs());
	const release = holdEngine();
	await Bun.sleep(200);
	expect(speechStatus().engine).toBe("ready");
	release();
	await Bun.sleep(400);
	expect(speechStatus().engine).toBe("stopped");
});

test.skipIf(!posix)("an engine that exits during start-up fails with its code", async () => {
	process.env.FAKE_SPEECH_FAIL_START = "1";
	await expect(ensureEngine(inputs())).rejects.toMatchObject({ code: "SPEECH_ENGINE_FAILED" });
	expect(speechStatus().engine).toBe("failed");
	delete process.env.FAKE_SPEECH_FAIL_START;
	await ensureEngine(inputs());
	expect(speechStatus().engine).toBe("ready");
});

test.skipIf(!posix)("a failed start reaches error tracking once, by its code", async () => {
	const seen = reported();
	process.env.FAKE_SPEECH_FAIL_START = "1";
	await Promise.allSettled([ensureEngine(inputs()), ensureEngine(inputs())]);
	expect(seen).toEqual([{ scope: "speech", code: "SPEECH_ENGINE_FAILED" }]);
});

test.skipIf(!posix)("stopping an engine on purpose reports nothing", async () => {
	const seen = reported();
	await ensureEngine(inputs());
	await stopEngine();
	process.env.FAKE_SPEECH_START_DELAY_MS = "30000";
	const start = ensureEngine(inputs());
	await Bun.sleep(300);
	await stopEngine();
	await start.catch(() => {});
	expect(seen).toEqual([]);
});

test.skipIf(!posix)("stopping waits for the engine to exit", async () => {
	const endpoint = await ensureEngine(inputs());
	await stopEngine();
	expect(speechStatus().engine).toBe("stopped");
	await expect(fetch(`${httpBase(endpoint.realtimeUrl)}/health`)).rejects.toThrow();
});

test.skipIf(!posix)("concurrent starts share one engine", async () => {
	const [a, b] = await Promise.all([ensureEngine(inputs()), ensureEngine(inputs())]);
	expect(a).toEqual(b);
});

test.skipIf(!posix)("stopping during start-up kills the loading engine at once", async () => {
	process.env.FAKE_SPEECH_START_DELAY_MS = "30000";
	const start = ensureEngine(inputs());
	await Bun.sleep(300);
	expect(speechStatus().engine).toBe("starting");
	const began = Date.now();
	await stopEngine();
	expect(Date.now() - began).toBeLessThan(5_000);
	await expect(start).rejects.toMatchObject({ code: "SPEECH_ENGINE_FAILED" });
	expect(speechStatus().engine).toBe("stopped");
});
