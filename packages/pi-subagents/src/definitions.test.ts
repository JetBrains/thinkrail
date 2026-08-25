import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "./builtins";
import { discoverAgentDefinitions, parseAgentDefinition } from "./definitions";

function definitionFile(name: string, extra = ""): string {
	return `---\nname: ${name}\ndescription: A ${name} definition\n${extra}---\n\nDo ${name} things.\n`;
}

test("parses the full community frontmatter surface", () => {
	const parsed = parseAgentDefinition(
		`---
name: my-agent
description: Does things
tools: read, grep, find
model: claude-haiku-4-5
thinking: low
max_turns: 12
inherit_project_context: true
skills: [alpha, beta]
---

System prompt body.`,
		"personal",
		"/tmp/my-agent.md",
	);
	expect(parsed).toEqual({
		name: "my-agent",
		description: "Does things",
		source: "personal",
		filePath: "/tmp/my-agent.md",
		tools: ["read", "grep", "find"],
		model: "claude-haiku-4-5",
		thinking: "low",
		maxTurns: 12,
		inheritProjectContext: true,
		skills: ["alpha", "beta"],
		systemPrompt: "System prompt body.",
	});
});

test("malformed definitions are skipped, never fatal", () => {
	// No frontmatter at all.
	expect(parseAgentDefinition("just a body", "personal")).toBeUndefined();
	// Missing description.
	expect(parseAgentDefinition("---\nname: x\n---\nbody", "personal")).toBeUndefined();
	// Missing body.
	expect(parseAgentDefinition("---\nname: x\ndescription: y\n---\n", "personal")).toBeUndefined();
	// Invalid thinking level + non-numeric max_turns degrade to absent, not failure.
	const parsed = parseAgentDefinition(
		"---\nname: x\ndescription: y\nthinking: turbo\nmax_turns: many\n---\nbody",
		"project",
	);
	expect(parsed?.thinking).toBeUndefined();
	expect(parsed?.maxTurns).toBeUndefined();
});

test("discovery precedence: builtins > personal > project, first-name-wins (trust posture)", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-subagents-defs-"));
	try {
		const agentDir = join(root, "agent");
		const cwd = join(root, "worktree");
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		mkdirSync(join(cwd, ".agents", "agents"), { recursive: true });

		// A repo trying to shadow the builtin "scout" and the personal "deploy" — must never win.
		writeFileSync(join(cwd, ".pi", "agents", "scout.md"), definitionFile("scout"));
		writeFileSync(join(cwd, ".pi", "agents", "deploy.md"), definitionFile("deploy"));
		writeFileSync(join(cwd, ".pi", "agents", "repo-only.md"), definitionFile("repo-only"));
		writeFileSync(join(cwd, ".agents", "agents", "legacy.md"), definitionFile("legacy"));
		writeFileSync(join(agentDir, "agents", "deploy.md"), definitionFile("deploy"));

		const trusted = discoverAgentDefinitions({ cwd, agentDir, includeProject: true });
		const byName = new Map(trusted.map((d) => [d.name, d]));
		expect(byName.get("scout")?.source).toBe("builtin");
		expect(byName.get("deploy")?.source).toBe("personal");
		expect(byName.get("repo-only")?.source).toBe("project");
		expect(byName.get("legacy")?.source).toBe("project");

		// Untrusted worktree: project definitions load not at all.
		const untrusted = discoverAgentDefinitions({ cwd, agentDir, includeProject: false });
		const untrustedNames = new Set(untrusted.map((d) => d.name));
		expect(untrustedNames.has("repo-only")).toBe(false);
		expect(untrustedNames.has("legacy")).toBe(false);
		expect(untrustedNames.has("deploy")).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the builtin set is the settled four, all with prompts and descriptions", () => {
	expect(BUILTIN_AGENTS.map((d) => d.name)).toEqual(["scout", "planner", "worker", "reviewer"]);
	for (const definition of BUILTIN_AGENTS) {
		expect(definition.source).toBe("builtin");
		expect(definition.description.length).toBeGreaterThan(20);
		expect(definition.systemPrompt.length).toBeGreaterThan(100);
	}
	// Read-only roles must not carry write tools.
	for (const name of ["scout", "planner"]) {
		const tools = BUILTIN_AGENTS.find((d) => d.name === name)?.tools ?? [];
		expect(tools).not.toContain("write");
		expect(tools).not.toContain("edit");
		expect(tools).not.toContain("bash");
	}
});
