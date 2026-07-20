import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCompatibilitySkillSources } from "./skillSources";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
	const path = mkdtempSync(join(tmpdir(), "thinkrail-skill-sources-"));
	temporaryRoots.push(path);
	return path;
}

function directory(path: string): string {
	mkdirSync(path, { recursive: true });
	return path;
}

afterEach(() => {
	for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("discoverCompatibilitySkillSources", () => {
	it("discovers only the explicit project and personal allowlist in precedence order", () => {
		const root = temporaryRoot();
		const project = directory(join(root, "project"));
		const home = directory(join(root, "home"));
		const claudeConfig = directory(join(root, "claude-config"));
		const codexHome = directory(join(root, "codex-home"));
		const geminiHome = directory(join(root, "gemini-home"));

		for (const path of [
			join(project, ".claude", "skills"),
			join(project, ".github", "skills"),
			join(project, ".gemini", "skills"),
			join(claudeConfig, "skills"),
			join(codexHome, "skills"),
			join(home, ".copilot", "skills"),
			join(geminiHome, ".gemini", "skills"),
			// Deliberately unsupported locations must not be swept in.
			join(project, ".cursor", "skills"),
			join(home, ".random-agent", "skills"),
		]) {
			directory(path);
		}

		const sources = discoverCompatibilitySkillSources(project, {
			env: {
				HOME: home,
				CLAUDE_CONFIG_DIR: claudeConfig,
				CODEX_HOME: codexHome,
				GEMINI_CLI_HOME: geminiHome,
			},
		});

		expect(sources.map(({ scope, provider }) => `${scope}:${provider}`)).toEqual([
			"project:claude",
			"project:github-copilot",
			"project:gemini",
			"user:claude",
			"user:codex",
			"user:github-copilot",
			"user:gemini",
		]);
		expect(sources.map((source) => source.path)).not.toContain(join(project, ".cursor", "skills"));
	});

	it("uses default homes, ignores missing roots, and deduplicates aliased directories", () => {
		const root = temporaryRoot();
		const project = directory(join(root, "project"));
		const home = directory(join(root, "home"));
		const sharedConfig = directory(join(root, "shared-config"));
		directory(join(home, ".claude", "skills"));
		directory(join(home, ".codex", "skills"));
		directory(join(home, ".gemini", "skills"));
		directory(join(sharedConfig, "skills"));

		const defaults = discoverCompatibilitySkillSources(project, { env: { HOME: home } });
		expect(defaults.map((source) => source.provider)).toEqual(["claude", "codex", "gemini"]);

		const deduplicated = discoverCompatibilitySkillSources(project, {
			env: { HOME: home, CLAUDE_CONFIG_DIR: sharedConfig, CODEX_HOME: sharedConfig },
		});
		expect(
			deduplicated.filter((source) => source.path === join(sharedConfig, "skills")),
		).toHaveLength(1);
		expect(
			deduplicated.find((source) => source.path === join(sharedConfig, "skills"))?.provider,
		).toBe("claude");
	});
});
