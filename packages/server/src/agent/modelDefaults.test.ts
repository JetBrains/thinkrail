import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	PI_DEFAULT_MODEL_PER_PROVIDER,
	piDefaultModelRef,
	preferredDefaultModel,
} from "./modelDefaults";

const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const piResolver = (await import(join(piDist, "core", "model-resolver.js"))) as {
	defaultModelPerProvider: Record<string, string>;
};

test("the default-model preference mirrors pi's provider defaults, in pi's order", () => {
	expect(Object.entries(PI_DEFAULT_MODEL_PER_PROVIDER)).toEqual(
		Object.entries(piResolver.defaultModelPerProvider),
	);
});

test("the preferred default follows pi's provider order before falling back to the first model", () => {
	const available = [
		{ provider: "openai", id: "gpt-4" },
		{ provider: "openai", id: "gpt-6.1-sol" },
		{ provider: "anthropic", id: "claude-opus-4-8" },
	];
	expect(preferredDefaultModel(available)).toEqual({
		provider: "anthropic",
		id: "claude-opus-4-8",
	});
	expect(preferredDefaultModel(available.slice(0, 2))).toEqual({
		provider: "openai",
		id: "gpt-6.1-sol",
	});
	expect(preferredDefaultModel([{ provider: "custom", id: "local" }])).toEqual({
		provider: "custom",
		id: "local",
	});
	expect(preferredDefaultModel([])).toBeUndefined();
});

describe("piDefaultModelRef", () => {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "thinkrail-pi-default-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	});

	const writeSettings = (content: string) =>
		writeFileSync(join(agentDir, "settings.json"), content);

	test("reads the provider and model from pi's global settings", () => {
		writeSettings(JSON.stringify({ defaultProvider: "modal-glm", defaultModel: "glm" }));
		expect(piDefaultModelRef()).toEqual({ provider: "modal-glm", id: "glm" });
	});

	test("is undefined when the settings file is missing", () => {
		expect(piDefaultModelRef()).toBeUndefined();
	});

	test("is undefined when only one half of the pair is set", () => {
		writeSettings(JSON.stringify({ defaultModel: "glm" }));
		expect(piDefaultModelRef()).toBeUndefined();
	});

	test("is undefined when the settings file is malformed", () => {
		writeSettings("{ not json");
		expect(piDefaultModelRef()).toBeUndefined();
	});
});
