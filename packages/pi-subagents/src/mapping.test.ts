import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	expect(resolveModelRef("claude-", AVAILABLE)).toBeUndefined();
	expect(resolveModelRef("nope/nothing", AVAILABLE)).toBeUndefined();
	expect(resolveModelRef("nothing", AVAILABLE)).toBeUndefined();
});

test("an id mirrored by several providers is ambiguous — never resolved by registry order", () => {
	const mirrored = [...AVAILABLE, { provider: "openrouter", id: "gpt-5" }];
	expect(resolveModelRef("gpt-5", mirrored)).toBeUndefined();
	expect(resolveModelRef("gpt", mirrored)).toBeUndefined();
	expect(resolveModelRef("openrouter/gpt-5", mirrored)).toEqual({
		provider: "openrouter",
		id: "gpt-5",
	});
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

test("the env block reads the branch from .git/HEAD — plain repo, subdirectory, worktree, detached", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-subagents-git-"));
	try {
		const repo = join(root, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
		expect(buildChildSystemPrompt(definition(), repo)).toContain("Git branch: feature/x");

		const sub = join(repo, "src", "deep");
		mkdirSync(sub, { recursive: true });
		expect(buildChildSystemPrompt(definition(), sub)).toContain("Git branch: feature/x");

		const wtGitDir = join(root, "main", ".git", "worktrees", "wt1");
		mkdirSync(wtGitDir, { recursive: true });
		writeFileSync(join(wtGitDir, "HEAD"), "ref: refs/heads/wt-branch\n");
		const wt = join(root, "wt1");
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, ".git"), `gitdir: ${wtGitDir}\n`);
		expect(buildChildSystemPrompt(definition(), wt)).toContain("Git branch: wt-branch");

		const detached = join(root, "detached");
		mkdirSync(join(detached, ".git"), { recursive: true });
		writeFileSync(join(detached, ".git", "HEAD"), "0123abc\n");
		expect(buildChildSystemPrompt(definition(), detached)).not.toContain("Git branch:");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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
			extensions: true,
		}),
		{ cwd: "/tmp/x", availableModels: AVAILABLE },
	);
	expect(mapping.session.model).toEqual({ provider: "anthropic", id: "claude-haiku-4-5" });
	expect(mapping.session.thinkingLevel).toBe("low");
	expect(mapping.session.tools).toEqual(["read", "grep"]);
	expect(mapping.session.excludeTools).toEqual([...RECURSION_GUARD_TOOLS]);
	expect(mapping.session.contextFiles).toBe(true);
	expect(mapping.session.skills).toEqual(["alpha"]);
	expect(mapping.session.extensions).toBe(true);
	expect(mapping.maxTurns).toBe(9);
});

test("a per-call model selects the model for an unpinned definition", () => {
	const mapping = toSpawnMapping(definition(), {
		cwd: "/tmp/x",
		availableModels: AVAILABLE,
		model: "openai/gpt-5",
	});
	expect(mapping.session.model).toEqual({ provider: "openai", id: "gpt-5" });
});

test("a model thinking suffix maps the available base and requested effort separately", () => {
	const availableModels = [{ provider: "openai", id: "gpt-5.6-sol" }];
	const mapping = toSpawnMapping(definition({ name: "reviewer" }), {
		cwd: "/tmp/x",
		availableModels,
		model: "openai/gpt-5.6-sol:xhigh",
	});
	expect(mapping.session.model).toEqual(availableModels[0]);
	expect(mapping.session.thinkingLevel).toBe("xhigh");
	expect(resolveModelRef("openai/gpt-5.6-sol:xhigh", availableModels)).toBeUndefined();
});

test("whole-reference ambiguity cannot be bypassed by resolving a suffix base", () => {
	const base = { provider: "openai", id: "gpt-5" };
	const catalogs = [
		[base, { provider: "openai", id: "gpt-5:xhigh" }, { provider: "proxy", id: "gpt-5:xhigh" }],
		[
			base,
			{ provider: "openai", id: "gpt-5:xhigh-preview" },
			{ provider: "openai", id: "gpt-5:xhigh-next" },
		],
	];
	for (const catalog of catalogs) {
		for (const availableModels of [catalog, [...catalog].reverse()]) {
			expect(() =>
				toSpawnMapping(definition(), {
					cwd: "/tmp/x",
					availableModels,
					model: "gpt-5:xhigh",
				}),
			).toThrow("ambiguous");
		}
	}
});

test("missing bases and unknown suffixes receive actionable diagnostics, not qualification hints", () => {
	const options = { cwd: "/tmp/x", availableModels: AVAILABLE };
	expect(() => toSpawnMapping(definition(), { ...options, model: "openai/missing:xhigh" })).toThrow(
		'Agent "scout" requests model "openai/missing:xhigh" (base "openai/missing"), which is not available in this session',
	);
	for (const suffix of ["turbo", "", "XHIGH"]) {
		expect(() =>
			toSpawnMapping(definition(), { ...options, model: `openai/gpt-5:${suffix}` }),
		).toThrow("thinking suffixes: off, minimal, low, medium, high, xhigh, max");
	}
	expect(() => toSpawnMapping(definition(), { ...options, model: "openai/missing" })).toThrow(
		'Agent "scout" requests model "openai/missing", which is not available in this session',
	);
});

test.each([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const)("%s is supported on qualified, exact and unique-prefix model references from either source", (thinking) => {
	for (const ref of ["openai/gpt-5", "gpt-5", "gpt"]) {
		for (const source of ["definition", "invocation"]) {
			const model = `${ref}:${thinking}`;
			const mapping = toSpawnMapping(definition(source === "definition" ? { model } : {}), {
				cwd: "/tmp/x",
				availableModels: AVAILABLE,
				model,
			});
			expect(mapping.session.model).toEqual({ provider: "openai", id: "gpt-5" });
			expect(mapping.session.thinkingLevel).toBe(thinking);
		}
	}
});

test("literal colon IDs and whole-reference prefixes keep their existing meaning", () => {
	for (const literal of [
		{ provider: "openai", id: "gpt-5:xhigh" },
		{ provider: "openai", id: "gpt-5:free" },
		{ provider: "openrouter", id: "vendor/model:free" },
	]) {
		const mapping = toSpawnMapping(definition(), {
			cwd: "/tmp/x",
			availableModels: [...AVAILABLE, literal],
			model: `${literal.provider}/${literal.id}`,
		});
		expect(mapping.session.model).toEqual(literal);
		expect(mapping.session.thinkingLevel).toBeUndefined();
	}
	for (const id of ["gpt-5:xhigh", "gpt-5:xhigh-preview"]) {
		const literal = { provider: "openai", id };
		const mapping = toSpawnMapping(definition(), {
			cwd: "/tmp/x",
			availableModels: [...AVAILABLE, literal],
			model: "gpt-5:xhigh",
		});
		expect(mapping.session.model).toEqual(literal);
		expect(mapping.session.thinkingLevel).toBeUndefined();
	}
});

test("a suffix may follow a literal colon/slash ID, but is never recursively stripped", () => {
	const literal = { provider: "openrouter", id: "vendor/model:low" };
	const options = { cwd: "/tmp/x", availableModels: [...AVAILABLE, literal] };
	const mapping = toSpawnMapping(definition(), {
		...options,
		model: "openrouter/vendor/model:low:xhigh",
	});
	expect(mapping.session.model).toEqual(literal);
	expect(mapping.session.thinkingLevel).toBe("xhigh");
	for (const model of ["openai/gpt-5:low:xhigh", ":xhigh"]) {
		expect(() =>
			toSpawnMapping(definition(), {
				cwd: "/tmp/x",
				availableModels: [{ provider: "openai", id: "gpt-5" }],
				model,
			}),
		).toThrow("not available");
	}
});

test("suffix bases retain exact matching, qualification and ambiguity safety", () => {
	const mirrored = [...AVAILABLE, { provider: "proxy", id: "gpt-5" }];
	for (const availableModels of [mirrored, [...mirrored].reverse()]) {
		for (const model of ["gpt-5:xhigh", "gpt:xhigh", "claude-:low"]) {
			expect(() => toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels, model })).toThrow(
				'ambiguous — qualify it as "provider/id"',
			);
		}
		const mapping = toSpawnMapping(definition(), {
			cwd: "/tmp/x",
			availableModels,
			model: "proxy/gpt-5:xhigh",
		});
		expect(mapping.session.model).toEqual({ provider: "proxy", id: "gpt-5" });
	}
	for (const model of ["openai/gpt:xhigh", "OPENAI/gpt-5:xhigh", " openai/gpt-5:xhigh"]) {
		expect(() =>
			toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: AVAILABLE, model }),
		).toThrow("not available");
	}
});

test("a definition pin wins without resolving the invocation model or its thinking suffix", () => {
	for (const model of ["unobtanium", "openai/gpt-5:xhigh", "unobtanium:turbo"]) {
		const mapping = toSpawnMapping(definition({ model: "claude-haiku-4-5" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
			model,
		});
		expect(mapping.session.model).toEqual({ provider: "anthropic", id: "claude-haiku-4-5" });
		expect(mapping.session.thinkingLevel).toBeUndefined();
	}
	const mapping = toSpawnMapping(definition({ model: "claude-haiku-4-5:low" }), {
		cwd: "/tmp/x",
		availableModels: AVAILABLE,
		model: "openai/gpt-5:xhigh",
	});
	expect(mapping.session.thinkingLevel).toBe("low");
});

test("explicit definition thinking overrides either source's suffix, including off", () => {
	for (const thinking of ["off", "low"] as const) {
		for (const pinned of [true, false]) {
			const mapping = toSpawnMapping(
				definition({ thinking, ...(pinned ? { model: "openai/gpt-5:xhigh" } : {}) }),
				{ cwd: "/tmp/x", availableModels: AVAILABLE, model: "openai/gpt-5:xhigh" },
			);
			expect(mapping.session.thinkingLevel).toBe(thinking);
		}
		const inherited = toSpawnMapping(definition({ thinking }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
		});
		expect(inherited.session.model).toBeUndefined();
		expect(inherited.session.thinkingLevel).toBe(thinking);
	}
});

test("an unpinned definition inherits the parent: no model/thinking/tools in the options", () => {
	const mapping = toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: AVAILABLE });
	expect(mapping.session.model).toBeUndefined();
	expect(mapping.session.thinkingLevel).toBeUndefined();
	expect(mapping.session.tools).toBeUndefined();
	expect(mapping.session.contextFiles).toBeUndefined();
	expect(mapping.session.skills).toBeUndefined();
	expect(mapping.session.extensions).toBeUndefined();
	expect(mapping.maxTurns).toBeUndefined();
	expect(mapping.session.excludeTools).toEqual([...RECURSION_GUARD_TOOLS]);
});

test("an unavailable or ambiguous per-call model throws loud", () => {
	for (const model of ["unobtanium", "claude-"]) {
		expect(() =>
			toSpawnMapping(definition(), {
				cwd: "/tmp/x",
				availableModels: AVAILABLE,
				model,
			}),
		).toThrow(`requests model "${model}"`);
	}
});

test("an unavailable pin cannot fall back to a valid invocation model", () => {
	expect(() =>
		toSpawnMapping(definition({ model: "openai/missing:xhigh" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
			model: "openai/gpt-5:low",
		}),
	).toThrow('pins model "openai/missing:xhigh" (base "openai/missing"), which is not available');
});

test("a pinned model that matches nothing throws loud", () => {
	expect(() =>
		toSpawnMapping(definition({ model: "unobtanium" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
		}),
	).toThrow('pins model "unobtanium"');
});
