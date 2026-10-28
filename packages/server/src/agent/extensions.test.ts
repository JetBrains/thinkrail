import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { registryInlineExtensions } from "../extensions";
import {
	buildResourceLoader,
	childBaseExtensionFactories,
	childExtensionFactories,
	disabledExtensions,
	listProjectAliasSkillNames,
	listSkillCatalog,
	listSkillCommands,
	setDisabledExtensionsResolver,
} from "./extensions";
import { headlessSearchPolicy } from "./headlessSearch";
import { oversizedImageGuard } from "./imageGuard";
import type { SkillAdmissionContext } from "./skillAdmission";

function ctx(trusted: boolean, acknowledged: string[] = []): SkillAdmissionContext {
	return {
		trusted,
		piResourceTrusted: trusted,
		acknowledged,
		disabled: [],
		disabledGroups: [],
		overrides: {},
	};
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
			expect(untrusted.some((command) => command.name === "skill:repo-native")).toBe(false);
			const nativeOnly = await listSkillCommands(project, {
				...ctx(false),
				piResourceTrusted: true,
			});
			expect(nativeOnly.some((command) => command.name === "skill:repo-native")).toBe(true);
			expect(nativeOnly.some((command) => command.name === "skill:repo-alias")).toBe(false);

			const trusted = await listSkillCommands(
				project,
				ctx(true, await listProjectAliasSkillNames(project)),
			);
			expect(trusted.some((command) => command.name === "skill:repo-alias")).toBe(true);
			expect(trusted.some((command) => command.name === "skill:repo-native")).toBe(true);
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
				piResourceTrusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				overrides: {},
			});
			expect(enabled.some((command) => command.name === "skill:personal-widget")).toBe(true);

			const groupOff = await listSkillCommands(project, {
				trusted: true,
				piResourceTrusted: true,
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
	for (const excluding of [false, true]) {
		it(`runs a project's .pi/extensions code only under pi-level trust (exclusion branch: ${excluding})`, async () => {
			const root = mkdtempSync(join(tmpdir(), "thinkrail-project-extension-"));
			const project = join(root, "project");
			const home = join(root, "home");
			const agentDir = join(root, "pi-agent");
			const generationArtifact = join(agentDir, "extensions", "generation.ts");
			const loads = `__thinkrailProjectExtensionLoads_${excluding}`;
			const counters = globalThis as typeof globalThis & Record<string, number | undefined>;
			mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
			mkdirSync(join(agentDir, "extensions"), { recursive: true });
			mkdirSync(home, { recursive: true });
			writeFileSync(generationArtifact, "export default function generation() {}\n");
			writeFileSync(
				join(project, ".pi", "extensions", "repo-code.ts"),
				`export default function repoCode() { globalThis.${loads} = (globalThis.${loads} ?? 0) + 1; }\n`,
			);
			const restore = stubSkillEnv(home, agentDir);
			let piResourceTrusted = false;
			try {
				const loader = await buildResourceLoader(
					project,
					SettingsManager.create(project, agentDir, { projectTrusted: false }),
					() => ({ ...ctx(false), piResourceTrusted }),
					excluding ? [generationArtifact] : [],
				);
				const loadsRepoCode = () =>
					loader
						.getExtensions()
						.extensions.some((extension) => extension.path.endsWith("repo-code.ts"));
				expect(counters[loads]).toBeUndefined();
				expect(loadsRepoCode()).toBe(false);

				piResourceTrusted = true;
				await loader.reload();
				expect(counters[loads]).toBe(1);
				expect(loadsRepoCode()).toBe(true);

				piResourceTrusted = false;
				await loader.reload();
				expect(loadsRepoCode()).toBe(false);
			} finally {
				delete counters[loads];
				restore();
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

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
				piResourceTrusted: true,
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
				piResourceTrusted: true,
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
				piResourceTrusted: false,
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

describe("registry extensions", () => {
	async function visualizeTool(cwd: string, agentDir: string) {
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const loader = await buildResourceLoader(cwd, settingsManager, () => ctx(true));
		const extension = loader
			.getExtensions()
			.extensions.find((candidate) => candidate.tools.has("visualize"));
		if (!extension) throw new Error("visualize is not loaded");
		const tool = extension.tools.get("visualize");
		if (!tool) throw new Error("visualize tool is missing");
		return {
			extension,
			execute: (params: unknown) =>
				tool.definition.execute("call", params, undefined, undefined, undefined as never),
		};
	}

	it("loads visualize as a named inline extension with the strict mermaid validator", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		try {
			const { extension, execute } = await visualizeTool(project, agentDir);
			expect(extension.path).toBe("<inline:visualize>");
			await expect(
				execute({ type: "diagram", mermaid: "flowchart LR\n A --> B" }),
			).resolves.toMatchObject({ details: { type: "diagram" } });
			await expect(execute({ type: "diagram", mermaid: "flowchart LR\n A -->" })).rejects.toThrow(
				/invalid Mermaid syntax in `mermaid`[\s\S]*Parse error/,
			);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("omits a disabled extension from a new loader and re-decides on reload", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-off-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		let disabled = new Set(["visualize"]);
		setDisabledExtensionsResolver(() => disabled);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const paths = () => loader.getExtensions().extensions.map((extension) => extension.path);
			const tools = () =>
				loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
			expect(paths()).not.toContain("<inline:visualize>");
			expect(tools()).not.toContain("visualize");

			disabled = new Set();
			expect(paths()).not.toContain("<inline:visualize>");
			await loader.reload();
			expect(paths()).toContain("<inline:visualize>");
			expect(tools()).toContain("visualize");

			disabled = new Set(["visualize", "retired-extension"]);
			await loader.reload();
			expect(paths()).not.toContain("<inline:visualize>");
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("treats a throwing resolver as nothing disabled", () => {
		setDisabledExtensionsResolver(() => {
			throw new Error("settings unavailable");
		});
		try {
			expect([...disabledExtensions()]).toEqual([]);
		} finally {
			setDisabledExtensionsResolver(() => new Set());
		}
	});

	it("keeps the curated child set and appends registry children", () => {
		const children = childExtensionFactories();
		expect(children).toHaveLength(2 + registryInlineExtensions("childExtensions").length);
		expect(children[0]).toBe(headlessSearchPolicy);
		expect(typeof children[1]).toBe("function");
		const names = (inlines: typeof children) =>
			inlines.map((inline) => (typeof inline === "function" ? "fn" : inline.name));
		expect(names(children.slice(2))).toEqual(names(registryInlineExtensions("childExtensions")));
		expect(names(children.slice(2))).toEqual(["web-access"]);
	});

	it("loads web access with its skill and drops both while the extension is off", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-skills-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		let disabled = new Set<string>();
		setDisabledExtensionsResolver(() => disabled);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const paths = () => loader.getExtensions().extensions.map((extension) => extension.path);
			const tools = () =>
				loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
			const skills = () => loader.getSkills().skills.map((skill) => skill.name);
			expect(paths()).toEqual(expect.arrayContaining(["<inline:web-access>"]));
			expect(tools()).toEqual(
				expect.arrayContaining(["web_search", "fetch_content", "get_search_content"]),
			);
			expect(skills()).toContain("librarian");
			expect(skills()).toContain("spec-graph");
			const commands = async () =>
				(await listSkillCommands(project, ctx(true))).map((command) => command.name);
			const catalog = async () =>
				(await listSkillCatalog(project, ctx(true))).map((entry) => entry.name);
			expect(await commands()).toContain("skill:librarian");
			expect(await catalog()).toContain("librarian");

			disabled = new Set(["web-access"]);
			await loader.reload();
			expect(paths().some((path) => path.startsWith("<inline:web-access"))).toBe(false);
			expect(tools()).not.toContain("web_search");
			expect(skills()).not.toContain("librarian");
			expect(skills()).toContain("spec-graph");
			expect(await commands()).not.toContain("skill:librarian");
			expect(await catalog()).not.toContain("librarian");

			disabled = new Set();
			await loader.reload();
			expect(tools()).toContain("web_search");
			expect(skills()).toContain("librarian");
			expect(await commands()).toContain("skill:librarian");
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("lets a personal skill of the same name through while the extension that shadows it is off", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-shadow-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const personalSkills = join(home, ".claude", "skills");
		writeSkill(personalSkills, "librarian", "my own librarian");
		const restore = stubSkillEnv(home, agentDir);
		let disabled = new Set(["web-access"]);
		setDisabledExtensionsResolver(() => disabled);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const librarian = () =>
				loader.getSkills().skills.find((skill) => skill.name === "librarian")?.filePath;
			const catalogLibrarian = async () =>
				(await listSkillCatalog(project, ctx(true))).find((entry) => entry.name === "librarian")
					?.sourceInfo.path;
			expect(librarian()).toStartWith(personalSkills);
			expect(await catalogLibrarian()).toStartWith(personalSkills);
			expect(await listSkillCommands(project, ctx(true))).toContainEqual(
				expect.objectContaining({ name: "skill:librarian" }),
			);

			disabled = new Set();
			await loader.reload();
			expect(librarian()).toBeDefined();
			expect(librarian()).not.toStartWith(personalSkills);
			expect(await catalogLibrarian()).not.toStartWith(personalSkills);
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a user's own pi-web-access headless while the web-access extension is off", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-user-web-access-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		const extensionEntry = createRequire(import.meta.url).resolve(
			"@thinkrail/ext-web-access/server",
		);
		const packageEntry = createRequire(extensionEntry).resolve("pi-web-access/index.ts");
		writeFileSync(
			join(agentDir, "extensions", "user-web-access.ts"),
			`export { default } from ${JSON.stringify(packageEntry)};\n`,
		);
		const restore = stubSkillEnv(home, agentDir);
		setDisabledExtensionsResolver(() => new Set(["web-access"]));
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const { extensions } = loader.getExtensions();
			expect(extensions.find((extension) => extension.tools.has("web_search"))?.path).toContain(
				"user-web-access",
			);
			const input: Record<string, unknown> = { query: "q" };
			for (const extension of extensions) {
				for (const handler of extension.handlers.get("tool_call") ?? []) {
					await handler(
						{ type: "tool_call", toolName: "web_search", toolCallId: "call", input },
						{} as never,
					);
				}
			}
			expect(input.workflow).toBe("none");
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("guards every child's images from the base set, not the opt-in curated set", () => {
		expect(childBaseExtensionFactories()).toEqual([oversizedImageGuard]);
		expect(childExtensionFactories()).not.toContain(oversizedImageGuard);
	});
});
