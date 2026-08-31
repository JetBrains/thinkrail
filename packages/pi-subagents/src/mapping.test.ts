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

test("a pinned model that matches nothing throws loud", () => {
	expect(() =>
		toSpawnMapping(definition({ model: "unobtanium" }), {
			cwd: "/tmp/x",
			availableModels: AVAILABLE,
		}),
	).toThrow('pins model "unobtanium"');
});
