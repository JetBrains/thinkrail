import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkillCommands } from "./extensions";

function writeSkill(root: string, name: string, description: string): void {
	const directory = join(root, name);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nPortable fixture.\n`,
	);
}

function restoreEnvironment(original: Record<string, string | undefined>): void {
	for (const [name, value] of Object.entries(original)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

describe("listSkillCommands", () => {
	it("shares Pi precedence/provenance and does not execute extensions", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-catalog-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const marker = join(root, "extension-executed");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });

		const original = Object.fromEntries(
			["HOME", "PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME"].map(
				(name) => [name, process.env[name]],
			),
		);
		process.env.HOME = home;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		delete process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CODEX_HOME;
		delete process.env.GEMINI_CLI_HOME;

		try {
			const configuredRoot = join(root, "configured-skills");
			const nativeRoot = join(project, ".pi", "skills");
			const projectRoot = join(project, ".claude", "skills");
			const personalRoot = join(home, ".claude", "skills");
			writeSkill(configuredRoot, "configured-wins", "configured description");
			writeSkill(projectRoot, "configured-wins", "project alias must lose");
			writeFileSync(
				join(agentDir, "settings.json"),
				`${JSON.stringify({ skills: [configuredRoot] }, null, 2)}\n`,
			);
			writeSkill(nativeRoot, "native-wins", "native description");
			writeSkill(projectRoot, "native-wins", "alias must lose");
			writeSkill(projectRoot, "project-wins", "project description");
			writeSkill(personalRoot, "project-wins", "personal must lose");
			writeSkill(personalRoot, "personal-only", "personal description");
			writeSkill(join(project, ".github", "skills"), "project-copilot", "copilot project");
			writeSkill(join(project, ".gemini", "skills"), "project-gemini", "gemini project");
			writeSkill(join(home, ".codex", "skills"), "personal-codex", "codex personal");
			writeSkill(join(home, ".copilot", "skills"), "personal-copilot", "copilot personal");
			writeSkill(join(home, ".gemini", "skills"), "personal-gemini", "gemini personal");
			// A personal portable skill deliberately shadows ThinkRail's bundled workflow skill.
			writeSkill(personalRoot, "brainstorming", "personal brainstorming override");

			const invalidDir = join(projectRoot, "invalid");
			mkdirSync(invalidDir, { recursive: true });
			writeFileSync(join(invalidDir, "SKILL.md"), "# no frontmatter\n");

			const extensionDir = join(project, ".pi", "extensions");
			mkdirSync(extensionDir, { recursive: true });
			writeFileSync(
				join(extensionDir, "probe.ts"),
				`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default () => {};\n`,
			);

			const commands = await listSkillCommands(project);
			const byName = (name: string) => commands.find((command) => command.name === `skill:${name}`);

			expect(byName("configured-wins")?.description).toBe("configured description");
			expect(byName("configured-wins")?.sourceInfo.scope).toBe("user");
			expect(byName("native-wins")?.description).toBe("native description");
			expect(byName("native-wins")?.sourceInfo.scope).toBe("project");
			expect(byName("project-wins")?.description).toBe("project description");
			expect(byName("project-wins")?.sourceInfo).toMatchObject({
				source: "claude",
				scope: "project",
			});
			expect(byName("personal-only")?.sourceInfo).toMatchObject({
				source: "claude",
				scope: "user",
			});
			expect(byName("project-copilot")?.sourceInfo).toMatchObject({
				source: "github-copilot",
				scope: "project",
			});
			expect(byName("project-gemini")?.sourceInfo).toMatchObject({
				source: "gemini",
				scope: "project",
			});
			expect(byName("personal-codex")?.sourceInfo).toMatchObject({
				source: "codex",
				scope: "user",
			});
			expect(byName("personal-copilot")?.sourceInfo).toMatchObject({
				source: "github-copilot",
				scope: "user",
			});
			expect(byName("personal-gemini")?.sourceInfo).toMatchObject({
				source: "gemini",
				scope: "user",
			});
			expect(byName("brainstorming")?.description).toBe("personal brainstorming override");
			expect(byName("invalid")).toBeUndefined();
			expect(existsSync(marker)).toBe(false);
		} finally {
			restoreEnvironment(original);
			rmSync(root, { recursive: true, force: true });
		}
	});
});
