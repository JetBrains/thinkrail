import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildResourceLoader, listProjectAliasSkillNames, listSkillCommands } from "./extensions";
import type { SkillAdmissionContext } from "./skillAdmission";

function ctx(trusted: boolean, acknowledged: string[] = []): SkillAdmissionContext {
	return { trusted, acknowledged, disabled: [], disabledGroups: [], overrides: {} };
}

function stubSkillEnv(home: string, agentDir: string): () => void {
	const names = [
		"HOME",
		"PI_CODING_AGENT_DIR",
		"CLAUDE_CONFIG_DIR",
		"CODEX_HOME",
		"GEMINI_CLI_HOME",
	];
	const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.CLAUDE_CONFIG_DIR;
	delete process.env.CODEX_HOME;
	delete process.env.GEMINI_CLI_HOME;
	return () => restoreEnvironment(original);
}

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
			writeSkill(projectRoot, "personal-wins", "project alias must lose");
			writeSkill(personalRoot, "personal-wins", "personal description");
			writeSkill(personalRoot, "personal-only", "personal description");
			writeSkill(join(project, ".github", "skills"), "project-copilot", "copilot project");
			writeSkill(join(project, ".gemini", "skills"), "project-gemini", "gemini project");
			writeSkill(join(home, ".codex", "skills"), "personal-codex", "codex personal");
			writeSkill(join(home, ".copilot", "skills"), "personal-copilot", "copilot personal");
			writeSkill(join(home, ".gemini", "skills"), "personal-gemini", "gemini personal");
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

			const commands = await listSkillCommands(
				project,
				ctx(true, await listProjectAliasSkillNames(project)),
			);
			const byName = (name: string) => commands.find((command) => command.name === `skill:${name}`);

			expect(byName("configured-wins")?.description).toBe("configured description");
			expect(byName("configured-wins")?.sourceInfo.scope).toBe("user");
			expect(byName("native-wins")?.description).toBe("native description");
			expect(byName("native-wins")?.sourceInfo.scope).toBe("project");
			expect(byName("personal-wins")?.description).toBe("personal description");
			expect(byName("personal-wins")?.sourceInfo).toMatchObject({
				source: "claude",
				scope: "user",
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
			expect(byName("brainstorming")).toBeDefined();
			expect(byName("brainstorming")?.description).not.toBe("personal brainstorming override");
			expect(byName("invalid")).toBeUndefined();
			expect(existsSync(marker)).toBe(false);
		} finally {
			restoreEnvironment(original);
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("withholds project-scoped aliases until the project is trusted", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-trust-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
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
			writeSkill(join(project, ".claude", "skills"), "repo-alias", "committed repo skill");
			writeSkill(join(project, ".pi", "skills"), "repo-native", "pi-native repo skill");
			writeSkill(join(home, ".claude", "skills"), "personal-skill", "personal skill");

			const untrusted = await listSkillCommands(project, ctx(false));
			expect(untrusted.some((command) => command.name === "skill:repo-alias")).toBe(false);
			expect(untrusted.some((command) => command.name === "skill:personal-skill")).toBe(true);
			expect(untrusted.some((command) => command.name === "skill:repo-native")).toBe(true);

			const trusted = await listSkillCommands(
				project,
				ctx(true, await listProjectAliasSkillNames(project)),
			);
			expect(trusted.some((command) => command.name === "skill:repo-alias")).toBe(true);
		} finally {
			restoreEnvironment(original);
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not serve a stale catalog when only disabledGroups differs", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-groups-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);

		try {
			writeSkill(join(home, ".claude", "skills"), "personal-widget", "personal skill");

			const enabled = await listSkillCommands(project, {
				trusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				overrides: {},
			});
			expect(enabled.some((command) => command.name === "skill:personal-widget")).toBe(true);

			const groupOff = await listSkillCommands(project, {
				trusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: ["personal"],
				overrides: {},
			});
			expect(groupOff.some((command) => command.name === "skill:personal-widget")).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("buildResourceLoader", () => {
	it("reload re-reads admission so a mid-session group toggle applies", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-reload-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);

		try {
			writeSkill(join(home, ".claude", "skills"), "reload-widget", "personal skill");

			let admission: SkillAdmissionContext = {
				trusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				overrides: {},
			};
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => admission);
			const hasWidget = () =>
				loader.getSkills().skills.some((skill) => skill.name === "reload-widget");

			expect(hasWidget()).toBe(true);

			admission = { ...admission, disabledGroups: ["personal"] };
			await loader.reload();
			expect(hasWidget()).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reload picks up a compatibility dir created after construction", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-newdir-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);

		try {
			const admission: SkillAdmissionContext = {
				trusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				overrides: {},
			};
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => admission);
			const hasLate = () => loader.getSkills().skills.some((skill) => skill.name === "late-widget");

			expect(hasLate()).toBe(false);

			writeSkill(join(home, ".claude", "skills"), "late-widget", "appeared after start");
			await loader.reload();
			expect(hasLate()).toBe(true);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a late-appearing untrusted project alias behind the trust gate on reload", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-latetrust-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);

		try {
			const admission: SkillAdmissionContext = {
				trusted: false,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				overrides: {},
			};
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => admission);

			writeSkill(join(project, ".claude", "skills"), "repo-late", "committed, appeared late");
			await loader.reload();
			expect(loader.getSkills().skills.some((skill) => skill.name === "repo-late")).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
