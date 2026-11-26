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

const ANTHROPIC = [
	"claude-haiku-4-5",
	"claude-opus-4-1",
	"claude-opus-4-5-20251101",
	"claude-opus-4-5",
	"claude-opus-5",
	"claude-opus-5-5",
	"claude-sonnet-4-20250514",
	"claude-sonnet-3-7",
].map((id) => ({ provider: "anthropic", id }));
const OPENAI = ["gpt-5", "gpt-5.1", "gpt-5-mini", "gpt-5.4-mini", "gpt-5.5-pro"].map((id) => ({
	provider: "openai",
	id,
}));
const OPENROUTER = ["anthropic/claude-opus-4.5", "anthropic/claude-opus-5.5", "x-ai/grok-4"].map(
	(id) => ({ provider: "openrouter", id }),
);

function modelError(model: string, availableModels: readonly { provider: string; id: string }[]) {
	try {
		toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels, model });
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error(`"${model}" resolved`);
}

test("informal names resolve case-insensitively on id words, newest of one family winning", () => {
	for (const catalog of [[...ANTHROPIC, ...OPENAI], [...ANTHROPIC, ...OPENAI].reverse()]) {
		const resolve = (ref: string) => resolveModelRef(ref, catalog)?.id;
		expect(resolve("opus")).toBe("claude-opus-5-5");
		expect(resolve("Opus")).toBe("claude-opus-5-5");
		expect(resolve("anthropic/opus")).toBe("claude-opus-5-5");
		expect(resolve("Anthropic/claude-opus")).toBe("claude-opus-5-5");
		expect(resolve("opus 4.5")).toBe("claude-opus-4-5");
		expect(resolve("opus-4")).toBe("claude-opus-4-5");
		expect(resolve("son")).toBe("claude-sonnet-4-20250514");
		expect(resolve("haiku")).toBe("claude-haiku-4-5");
		expect(resolve("GPT 5.4 mini")).toBe("gpt-5.4-mini");
		expect(resolve("gpt5.5 PRO")).toBe("gpt-5.5-pro");
		expect(resolve("pus")).toBeUndefined();
		expect(resolve("gpt")).toBeUndefined();
	}
	expect(resolveModelRef("claude-opus-4-5", ANTHROPIC)?.id).toBe("claude-opus-4-5");
	expect(resolveModelRef("claude-opus-4-5-2", ANTHROPIC)?.id).toBe("claude-opus-4-5-20251101");
	const dated = [
		{ provider: "anthropic", id: "claude-opus-4-5-20250101" },
		{ provider: "anthropic", id: "claude-opus-4-5-20251101" },
	];
	expect(resolveModelRef("opus", dated)?.id).toBe("claude-opus-4-5-20251101");
	const mirrored = ANTHROPIC.map((model) => ({ ...model, provider: "anthropic-proxy" }));
	expect(resolveModelRef("opus", [...ANTHROPIC, ...mirrored])).toBeUndefined();
	expect(resolveModelRef("anthropic-proxy/opus", [...ANTHROPIC, ...mirrored])).toEqual({
		provider: "anthropic-proxy",
		id: "claude-opus-5-5",
	});
});

test("informal names keep exact > prefix > word precedence and the thinking suffix", () => {
	const catalog = [
		{ provider: "openai", id: "opus-gpt" },
		{ provider: "openai", id: "opus" },
		...ANTHROPIC,
	];
	expect(resolveModelRef("opus", catalog)).toEqual({ provider: "openai", id: "opus" });
	expect(resolveModelRef("opus-", catalog)).toEqual({ provider: "openai", id: "opus-gpt" });
	for (const source of ["definition", "invocation"]) {
		const model = "opus 4.5:high";
		const mapping = toSpawnMapping(definition(source === "definition" ? { model } : {}), {
			cwd: "/tmp/x",
			availableModels: ANTHROPIC,
			model,
		});
		expect(mapping.session.model).toEqual({ provider: "anthropic", id: "claude-opus-4-5" });
		expect(mapping.session.thinkingLevel).toBe("high");
	}
	for (const model of ["opus:", "opus:turbo"]) {
		expect(modelError(model, ANTHROPIC)).toContain("supported thinking suffixes");
	}
});

test("a slash prefix naming no available provider is part of a bare id", () => {
	const catalog = [...ANTHROPIC, ...OPENROUTER];
	expect(resolveModelRef("x-ai/grok-4", catalog)).toEqual({
		provider: "openrouter",
		id: "x-ai/grok-4",
	});
	expect(resolveModelRef("grok", catalog)).toEqual({ provider: "openrouter", id: "x-ai/grok-4" });
	expect(resolveModelRef("openrouter/opus", catalog)).toEqual({
		provider: "openrouter",
		id: "anthropic/claude-opus-5.5",
	});
	expect(resolveModelRef("anthropic/claude-opus-4.5", catalog)).toEqual({
		provider: "anthropic",
		id: "claude-opus-4-5",
	});
});

test("an ambiguous name fails listing the newest candidate of each family as provider/id", () => {
	expect(modelError("opus", [...ANTHROPIC, ...OPENROUTER])).toBe(
		'Agent "scout" requests model "opus", which is ambiguous — it matches anthropic/claude-opus-5-5, openrouter/anthropic/claude-opus-5.5. Retry with one of them as "provider/id".',
	);
	expect(modelError("gpt", OPENAI)).toContain(
		"it matches openai/gpt-5.1, openai/gpt-5.4-mini, openai/gpt-5.5-pro.",
	);
	const many = Array.from({ length: 23 }, (_, i) => ({ provider: `p${i}`, id: "same" }));
	const message = modelError("same", many);
	expect(message).toContain("p19/same (+3 more).");
	expect(message).not.toContain("Available models");
	const pinned = () =>
		toSpawnMapping(definition({ model: "opus" }), {
			cwd: "/tmp/x",
			availableModels: [...ANTHROPIC, ...OPENROUTER],
		});
	expect(pinned).toThrow('pins model "opus", which is ambiguous — it matches anthropic/');
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

test.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
	"%s is supported on qualified, exact and unique-prefix model references from either source",
	(thinking) => {
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
	},
);

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
				'Retry with one of them as "provider/id"',
			);
		}
		const mapping = toSpawnMapping(definition(), {
			cwd: "/tmp/x",
			availableModels,
			model: "proxy/gpt-5:xhigh",
		});
		expect(mapping.session.model).toEqual({ provider: "proxy", id: "gpt-5" });
	}
	for (const model of ["openai/gpt:xhigh", "OPENAI/gpt-5:xhigh"]) {
		const mapping = toSpawnMapping(definition(), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
			model,
		});
		expect(mapping.session.model).toEqual({ provider: "openai", id: "gpt-5" });
		expect(mapping.session.thinkingLevel).toBe("xhigh");
	}
	for (const model of [" openai/gpt-5:xhigh", "openai/claude-opus-4-5:xhigh"]) {
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

test("parent-model words in the call mean no invocation model, never a lookup", () => {
	for (const model of ["inherit", "parent", "default", "INHERIT", "Parent"]) {
		const mapping = toSpawnMapping(definition({ thinking: "low" }), {
			cwd: "/tmp/x",
			availableModels: [...AVAILABLE, { provider: "openai", id: "default-preview" }],
			model,
		});
		expect(mapping.session.model).toBeUndefined();
		expect(mapping.session.thinkingLevel).toBe("low");
	}
	const pinned = toSpawnMapping(definition({ model: "openai/gpt-5" }), {
		cwd: "/tmp/x",
		availableModels: AVAILABLE,
		model: "inherit",
	});
	expect(pinned.session.model).toEqual({ provider: "openai", id: "gpt-5" });
	for (const model of ["inherit:high", "provider/model"]) {
		expect(() =>
			toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: AVAILABLE, model }),
		).toThrow(`requests model "${model}"`);
	}
});

test("a blank model in the call means no invocation model, whatever the catalog holds", () => {
	for (const availableModels of [AVAILABLE, [{ provider: "openai", id: "gpt-5" }], []]) {
		for (const model of ["", " ", "\t\n"]) {
			const mapping = toSpawnMapping(definition({ thinking: "low" }), {
				cwd: "/tmp/x",
				availableModels,
				model,
			});
			expect(mapping.session.model).toBeUndefined();
			expect(mapping.session.thinkingLevel).toBe("low");
		}
	}
	const pinned = toSpawnMapping(definition({ model: "openai/gpt-5" }), {
		cwd: "/tmp/x",
		availableModels: AVAILABLE,
		model: "",
	});
	expect(pinned.session.model).toEqual({ provider: "openai", id: "gpt-5" });
});

test("a missing per-call model lists the available refs and says how to use the parent's", () => {
	expect(() =>
		toSpawnMapping(definition({ name: "worker" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
			model: "provider/model",
		}),
	).toThrow(
		'Agent "worker" requests model "provider/model", which is not available in this session. Available models: anthropic/claude-opus-4-5, anthropic/claude-haiku-4-5, openai/gpt-5. Leave model out to use the parent\'s model.',
	);
	const many = Array.from({ length: 23 }, (_, i) => ({ provider: "p", id: `m${i}` }));
	let message = "";
	try {
		toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: many, model: "nope" });
	} catch (error) {
		message = (error as Error).message;
	}
	expect(message).toContain("p/m19 (+3 more).");
	expect(message).not.toContain("p/m20");
	expect(() =>
		toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: [], model: "nope" }),
	).toThrow("No models are available in this session. Leave model out");
	expect(() =>
		toSpawnMapping(definition(), { cwd: "/tmp/x", availableModels: AVAILABLE, model: "claude-" }),
	).not.toThrow("Available models");
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
	let message = "";
	try {
		toSpawnMapping(definition({ model: "unobtanium" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
		});
	} catch (error) {
		message = (error as Error).message;
	}
	expect(message).toContain("Available models: anthropic/claude-opus-4-5");
	expect(message).not.toContain("Leave model out");
});
