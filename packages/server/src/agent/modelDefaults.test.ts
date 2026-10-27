import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_DEFAULT_MODEL_PER_PROVIDER, preferredDefaultModel } from "./modelDefaults";

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
		{ provider: "openai", id: "gpt-5.5" },
		{ provider: "anthropic", id: "claude-opus-4-8" },
	];
	expect(preferredDefaultModel(available)).toEqual({
		provider: "anthropic",
		id: "claude-opus-4-8",
	});
	expect(preferredDefaultModel(available.slice(0, 2))).toEqual({
		provider: "openai",
		id: "gpt-5.5",
	});
	expect(preferredDefaultModel([{ provider: "custom", id: "local" }])).toEqual({
		provider: "custom",
		id: "local",
	});
	expect(preferredDefaultModel([])).toBeUndefined();
});
