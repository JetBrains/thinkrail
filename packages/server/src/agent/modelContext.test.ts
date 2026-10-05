import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { parse } from "jsonc-parser";
import {
	listModelContextSettings,
	setModelContextPublisher,
	setModelContextWindow,
} from "./modelContext";
import { configurePiRuntime } from "./piRuntime";

let directory: string;
let path: string;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
const ref = { provider: "openai", id: "gpt-5.5" };
const model = {
	id: "gpt-5.5",
	name: "GPT-5.5",
	api: "openai-responses" as const,
	reasoning: true,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 272_000,
	maxTokens: 128_000,
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-model-context-"));
	path = join(directory, "models.json");
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = directory;
	process.env.PI_OFFLINE = "1";
});

afterEach(() => {
	setModelContextPublisher(null);
	configurePiRuntime(null);
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	rmSync(directory, { recursive: true, force: true });
});

async function runtime(
	providers: readonly (readonly [string, "openai-responses" | "openai-codex-responses"])[] = [
		["openai", "openai-responses"],
	],
) {
	const result = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		allowModelNetwork: false,
	});
	for (const [provider, api] of providers) {
		result.registerProvider(provider, {
			api,
			apiKey: "fixture-only-key",
			baseUrl: "http://fixture.invalid",
			models: [
				{ ...model, api },
				{ ...model, id: "gpt-5", contextWindow: 400_000, api },
				{ ...model, id: "gpt-5.5-pro", contextWindow: 1_050_000, api },
			],
		});
	}
	result.registerProvider("other", {
		api: "anthropic-messages",
		apiKey: "fixture-only-key",
		baseUrl: "http://fixture.invalid",
		models: [{ ...model, id: "claude", api: "anthropic-messages" }],
	});
	await result.refresh({ allowNetwork: false });
	configurePiRuntime(result);
	return result;
}

function config(): Record<string, unknown> {
	return parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""), [], { allowTrailingComma: true });
}

function temporaryFiles(): string[] {
	return readdirSync(directory).filter((entry) => entry.startsWith(".models"));
}

test("only OpenAI Responses models capped at 272K or already overridden are offered", async () => {
	writeFileSync(
		path,
		JSON.stringify({
			providers: { openai: { modelOverrides: { "gpt-5.5-pro": { contextWindow: 900_000 } } } },
		}),
	);
	await runtime();
	expect(await listModelContextSettings()).toEqual([
		{ ...ref, name: "GPT-5.5", contextWindow: 272_000, override: null },
		{
			provider: "openai",
			id: "gpt-5.5-pro",
			name: "GPT-5.5",
			contextWindow: 900_000,
			override: 900_000,
		},
	]);
	await setModelContextWindow({ provider: "openai", id: "gpt-5.5-pro" }, null);
	expect((await listModelContextSettings()).map((entry) => entry.id)).toEqual(["gpt-5.5"]);
});

test("saving 1M updates Pi metadata for new chats, keeps live session models, and notifies", async () => {
	const pi = await runtime();
	const before = pi.getModel("openai", "gpt-5.5");
	if (!before) throw new Error("Missing fixture model");
	const { session } = await createAgentSession({
		cwd: directory,
		modelRuntime: pi,
		model: before,
		sessionManager: SessionManager.inMemory(),
	});
	let published = 0;
	setModelContextPublisher(() => {
		published++;
	});
	try {
		const settings = await setModelContextWindow(ref, 1_000_000);
		expect(settings).toEqual([
			{ ...ref, name: "GPT-5.5", contextWindow: 1_000_000, override: 1_000_000 },
		]);
		expect(pi.getModel("openai", "gpt-5.5")).toMatchObject({
			contextWindow: 1_000_000,
			cost: model.cost,
			maxTokens: 128_000,
		});
		expect(session.model?.contextWindow).toBe(272_000);
		expect(config()).toEqual({
			providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 1_000_000 } } } },
		});
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(published).toBe(1);
		await setModelContextWindow(ref, 1_000_000);
		expect(published).toBe(1);
	} finally {
		session.dispose();
	}
});

test("Default removes only the override and preserves credentials, comments, mode and BOM", async () => {
	const original =
		'\uFEFF{ // keep this note\n  "providers": {\n    "openai": {\n      "apiKey": "private-fixture-sentinel",\n      "modelOverrides": {\n        "gpt-5.5": { "maxTokens": 8192, "contextWindow": 500000, },\n        "gpt-5": { "contextWindow": 350000 },\n      },\n    },\n  },\n}\n';
	writeFileSync(path, original);
	chmodSync(path, 0o640);
	const pi = await runtime();
	const settings = await setModelContextWindow(ref, null);
	expect(JSON.stringify(settings)).not.toContain("private-fixture-sentinel");
	expect(settings).toEqual([
		{ ...ref, name: "GPT-5.5", contextWindow: 272_000, override: null },
		{ provider: "openai", id: "gpt-5", name: "GPT-5.5", contextWindow: 350_000, override: 350_000 },
	]);
	const saved = readFileSync(path, "utf8");
	expect(saved.startsWith("\uFEFF// keep")).toBe(false);
	expect(saved.startsWith("\uFEFF{ // keep this note")).toBe(true);
	expect(config()).toEqual({
		providers: {
			openai: {
				apiKey: "private-fixture-sentinel",
				modelOverrides: { "gpt-5.5": { maxTokens: 8192 }, "gpt-5": { contextWindow: 350_000 } },
			},
		},
	});
	expect(pi.getModel("openai", "gpt-5.5")?.maxTokens).toBe(8192);
	expect(pi.getError()).toBeUndefined();
	expect(statSync(path).mode & 0o777).toBe(0o640);
});

test("Default prunes override objects it empties but never the providers map", async () => {
	writeFileSync(
		path,
		JSON.stringify({
			providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 1_000_000 } } } },
		}),
	);
	await runtime();
	await setModelContextWindow(ref, null);
	expect(config()).toEqual({ providers: {} });
});

test("one bulk save covers API, Codex and proxy providers and leaves ineligible models alone", async () => {
	const pi = await runtime([
		["openai", "openai-responses"],
		["openai-codex", "openai-codex-responses"],
		["configured-proxy", "openai-responses"],
	]);
	const result = await setModelContextWindow("available", 600_000);
	expect(result.map((entry) => [entry.provider, entry.override])).toEqual([
		["openai", 600_000],
		["openai-codex", 600_000],
		["configured-proxy", 600_000],
	]);
	expect(pi.getModel("openai", "gpt-5")?.contextWindow).toBe(400_000);
	expect(pi.getModel("openai", "gpt-5.5-pro")?.contextWindow).toBe(1_050_000);
	expect(pi.getModel("other", "claude")?.contextWindow).toBe(272_000);
	expect(config()).toEqual({
		providers: {
			openai: { modelOverrides: { "gpt-5.5": { contextWindow: 600_000 } } },
			"openai-codex": { modelOverrides: { "gpt-5.5": { contextWindow: 600_000 } } },
			"configured-proxy": { modelOverrides: { "gpt-5.5": { contextWindow: 600_000 } } },
		},
	});
});

test("a bulk save from a mixed state replaces every override and bulk Default clears them all", async () => {
	writeFileSync(
		path,
		JSON.stringify({
			providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 500_000 } } } },
		}),
	);
	const pi = await runtime([
		["openai", "openai-responses"],
		["openai-codex", "openai-codex-responses"],
		["configured-proxy", "openai-responses"],
	]);
	const overrides = (settings: { override: number | null }[]) =>
		settings.map((entry) => entry.override);
	const effective = () =>
		["openai", "openai-codex", "configured-proxy"].map(
			(provider) => pi.getModel(provider, ref.id)?.contextWindow,
		);
	expect(overrides(await listModelContextSettings())).toEqual([500_000, null, null]);
	expect(overrides(await setModelContextWindow("available", 1_000_000))).toEqual([
		1_000_000, 1_000_000, 1_000_000,
	]);
	expect(
		overrides(await setModelContextWindow({ provider: "openai-codex", id: ref.id }, null)),
	).toEqual([1_000_000, null, 1_000_000]);
	expect(overrides(await setModelContextWindow("available", 600_000))).toEqual([
		600_000, 600_000, 600_000,
	]);
	expect(effective()).toEqual([600_000, 600_000, 600_000]);
	expect(overrides(await setModelContextWindow("available", null))).toEqual([null, null, null]);
	expect(effective()).toEqual([272_000, 272_000, 272_000]);
	expect(config()).toEqual({ providers: {} });
});

test("shared saves skip overrides outside the app range; only a targeted save changes them", async () => {
	writeFileSync(
		path,
		JSON.stringify({
			providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 1_050_000 } } } },
		}),
	);
	const pi = await runtime([
		["openai", "openai-responses"],
		["openai-codex", "openai-codex-responses"],
	]);
	const overrides = (settings: { override: number | null }[]) =>
		settings.map((entry) => entry.override);
	expect(overrides(await listModelContextSettings())).toEqual([1_050_000, null]);
	expect(overrides(await setModelContextWindow("available", 1_000_000))).toEqual([
		1_050_000, 1_000_000,
	]);
	expect(overrides(await setModelContextWindow("available", null))).toEqual([1_050_000, null]);
	expect(pi.getModel("openai", ref.id)?.contextWindow).toBe(1_050_000);
	expect(overrides(await setModelContextWindow(ref, null))).toEqual([null, null]);
	expect(pi.getModel("openai", ref.id)?.contextWindow).toBe(272_000);
});

test("budgets outside 272K–1M and unknown targets are refused before touching the file", async () => {
	await runtime();
	for (const value of [271_999, 1_000_001, 500_000.5, Number.NaN]) {
		await expect(setModelContextWindow(ref, value)).rejects.toThrow("whole number between");
	}
	await expect(
		setModelContextWindow({ provider: "openai", id: "gpt-5" }, 1_000_000),
	).rejects.toThrow("ineligible");
	await expect(
		setModelContextWindow({ provider: "other", id: "claude" }, 1_000_000),
	).rejects.toThrow("ineligible");
	expect(readdirSync(directory)).not.toContain("models.json");
	await setModelContextWindow(ref, 272_000);
	expect(config()).toEqual({
		providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 272_000 } } } },
	});
});

test("an invalid models.json is refused rather than patched", async () => {
	writeFileSync(path, '{"providers": {');
	await runtime();
	await expect(setModelContextWindow(ref, 1_000_000)).rejects.toThrow("isn't valid JSON");
	await expect(listModelContextSettings()).rejects.toThrow("isn't valid JSON");
	expect(readFileSync(path, "utf8")).toBe('{"providers": {');
	expect(temporaryFiles()).toEqual([]);
});

test("a read-only models.json is refused and left byte-for-byte intact", async () => {
	writeFileSync(path, '{"providers": {}}');
	chmodSync(path, 0o400);
	await runtime();
	await expect(setModelContextWindow(ref, 1_000_000)).rejects.toThrow("Couldn't save");
	expect(readFileSync(path, "utf8")).toBe('{"providers": {}}');
	expect(temporaryFiles()).toEqual([]);
});

test("writes follow a symlinked models.json and leave no temporary files", async () => {
	const target = join(directory, "dotfiles-models.json");
	writeFileSync(target, '{"providers":{}}');
	symlinkSync(target, path);
	await runtime();
	await setModelContextWindow(ref, 1_000_000);
	expect(lstatSync(path).isSymbolicLink()).toBe(true);
	expect(readFileSync(target, "utf8")).toContain("1000000");
	expect(temporaryFiles()).toEqual([]);
});

test("a dangling models.json symlink is kept and its missing target is created", async () => {
	const target = join(directory, "dotfiles", "pi", "models.json");
	symlinkSync(target, path);
	await runtime();
	await setModelContextWindow(ref, 1_000_000);
	expect(lstatSync(path).isSymbolicLink()).toBe(true);
	expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
		providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 1_000_000 } } } },
	});
	expect(statSync(target).mode & 0o777).toBe(0o600);
	expect(temporaryFiles()).toEqual([]);
});

test("concurrent saves serialize so neither edit is lost", async () => {
	await runtime([
		["openai", "openai-responses"],
		["openai-codex", "openai-codex-responses"],
	]);
	await Promise.all([
		setModelContextWindow(ref, 1_000_000),
		setModelContextWindow({ provider: "openai-codex", id: "gpt-5.5" }, 800_000),
	]);
	expect(config()).toEqual({
		providers: {
			openai: { modelOverrides: { "gpt-5.5": { contextWindow: 1_000_000 } } },
			"openai-codex": { modelOverrides: { "gpt-5.5": { contextWindow: 800_000 } } },
		},
	});
});

test("external edits are re-read on every read", async () => {
	const pi = await runtime();
	expect((await listModelContextSettings())[0]?.override).toBeNull();
	writeFileSync(
		path,
		JSON.stringify({
			providers: { openai: { modelOverrides: { "gpt-5.5": { contextWindow: 700_000 } } } },
		}),
	);
	expect((await listModelContextSettings())[0]).toMatchObject({
		contextWindow: 700_000,
		override: 700_000,
	});
	expect(pi.getModel("openai", "gpt-5.5")?.contextWindow).toBe(700_000);
});
