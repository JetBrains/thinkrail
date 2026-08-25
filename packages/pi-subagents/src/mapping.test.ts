import { expect, test } from "bun:test";
import type { AgentDefinition } from "./definitions";
import {
	buildChildSystemPrompt,
	RECURSION_GUARD_TOOLS,
	resolveModelRef,
	toSpawnMapping,
} from "./mapping";

const AVAILABLE = [
	{ provider: "anthropic", id: "claude-opus-4-5" },
	{ provider: "anthropic", id: "claude-haiku-4-5" },
	{ provider: "openai", id: "gpt-5" },
];

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "scout",
		description: "recon",
		source: "builtin",
		systemPrompt: "You are a scout.",
		...overrides,
	};
}

test("model refs resolve fuzzily: provider/id, exact id, unique prefix — ambiguity fails", () => {
	expect(resolveModelRef("openai/gpt-5", AVAILABLE)).toEqual({ provider: "openai", id: "gpt-5" });
	expect(resolveModelRef("claude-haiku-4-5", AVAILABLE)).toEqual({
		provider: "anthropic",
		id: "claude-haiku-4-5",
	});
	expect(resolveModelRef("gpt", AVAILABLE)).toEqual({ provider: "openai", id: "gpt-5" });
	// "claude-" prefixes two different models — ambiguous, no match.
	expect(resolveModelRef("claude-", AVAILABLE)).toBeUndefined();
	expect(resolveModelRef("nope/nothing", AVAILABLE)).toBeUndefined();
	expect(resolveModelRef("nothing", AVAILABLE)).toBeUndefined();
});

test("the child prompt is stable-first: body, then bridge, then env", () => {
	const prompt = buildChildSystemPrompt(definition(), "/tmp/somewhere");
	const body = prompt.indexOf("You are a scout.");
	const bridge = prompt.indexOf("## Subagent protocol");
	const env = prompt.indexOf("## Environment");
	expect(body).toBe(0);
	expect(bridge).toBeGreaterThan(body);
	expect(env).toBeGreaterThan(bridge);
	expect(prompt).toContain("Working directory: /tmp/somewhere");
});

test("the mapping mirrors the definition onto SessionOptions with the recursion guard always on", () => {
	const mapping = toSpawnMapping(
		definition({
			tools: ["read", "grep"],
			model: "claude-haiku-4-5",
			thinking: "low",
			maxTurns: 9,
			inheritProjectContext: true,
			skills: ["alpha"],
		}),
		{ cwd: "/tmp/x", availableModels: AVAILABLE },
	);
	expect(mapping.session.model).toEqual({ provider: "anthropic", id: "claude-haiku-4-5" });
	expect(mapping.session.thinkingLevel).toBe("low");
	expect(mapping.session.tools).toEqual(["read", "grep"]);
	expect(mapping.session.excludeTools).toEqual([...RECURSION_GUARD_TOOLS]);
	expect(mapping.session.contextFiles).toBe(true);
	expect(mapping.session.skills).toEqual(["alpha"]);
	expect(mapping.maxTurns).toBe(9);
});

test("an unpinned definition inherits the parent: no model/thinking/tools in the options", () => {
	const mapping = toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: AVAILABLE });
	expect(mapping.session.model).toBeUndefined();
	expect(mapping.session.thinkingLevel).toBeUndefined();
	expect(mapping.session.tools).toBeUndefined();
	expect(mapping.session.contextFiles).toBeUndefined();
	expect(mapping.session.skills).toBeUndefined();
	expect(mapping.maxTurns).toBeUndefined();
	// The guard is unconditional.
	expect(mapping.session.excludeTools).toEqual([...RECURSION_GUARD_TOOLS]);
});

test("a pinned model that matches nothing throws loud", () => {
	expect(() =>
		toSpawnMapping(definition({ model: "unobtanium" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
		}),
	).toThrow('pins model "unobtanium"');
});
