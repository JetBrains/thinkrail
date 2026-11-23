import { describe, expect, it, jest, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DefaultPackageManager,
	type InlineExtension,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { SPEC_SECTION } from "pi-spec-graph";
import { Type } from "typebox";
import {
	builtinServerExtensions,
	EXTENSION_LOAD_TIMEOUT_MS,
	type HostSessionServices,
	installedExtensions,
	registryInlineExtensions,
	startInstalledExtensions,
	workspaceFiles,
} from "../extensions";
import { artifactsGuard } from "./artifactsGuard";
import {
	buildResourceLoader,
	bumpPackagesRevision,
	childBaseExtensionFactories,
	childExtensionFactories,
	disabledExtensions,
	extensionSettings,
	HOST_INLINE_FACTORIES,
	isLoaderPolicyStale,
	listProjectAliasSkillNames,
	listSkillCatalog,
	listSkillCommands,
	providerExtensionPaths,
	setDisabledExtensionsResolver,
	setDisabledPackagesResolver,
	setExtensionSettingsResolver,
	setInstalledPackagesListener,
	setSpecsEnabledResolver,
	withoutSpecRule,
} from "./extensions";
import { headlessSearchPolicy } from "./headlessSearch";
import { oversizedImageGuard } from "./imageGuard";
import { createMcpEngine, HOST_BUILTIN_EXTENSION_NAMES } from "./mcp";
import { createPiSettings } from "./packages";
import { writeFixturePiPackage } from "./packages/testFixtures";
import type { SkillAdmissionContext } from "./skillAdmission";
import { skillCarryover } from "./skillCarryover";
import { skillCatalog } from "./skillCatalog";

function ctx(trusted: boolean, acknowledged: string[] = []): SkillAdmissionContext {
	return {
		trusted,
		piResourceTrusted: trusted,
		acknowledged,
		disabled: [],
		disabledGroups: [],
		enabledGroups: [],
		otherAgentSkills: true,
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

const nameOf = (inline: InlineExtension): string =>
	typeof inline === "function" ? "fn" : inline.name;

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
				enabledGroups: [],
				otherAgentSkills: true,
				overrides: {},
			});
			expect(enabled.some((command) => command.name === "skill:personal-widget")).toBe(true);

			const groupOff = await listSkillCommands(project, {
				trusted: true,
				piResourceTrusted: true,
				acknowledged: [],
				disabled: [],
				disabledGroups: ["personal"],
				enabledGroups: [],
				otherAgentSkills: true,
				overrides: {},
			});
			expect(groupOff.some((command) => command.name === "skill:personal-widget")).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a switched-off personal skill never shadows a same-name project alias", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-skill-shadow-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		try {
			writeSkill(join(home, ".claude", "skills"), "deploy", "personal deploy");
			writeSkill(join(project, ".claude", "skills"), "deploy", "project deploy");
			const admission: SkillAdmissionContext = {
				trusted: true,
				piResourceTrusted: true,
				acknowledged: ["deploy"],
				disabled: [],
				disabledGroups: [],
				enabledGroups: [],
				otherAgentSkills: false,
				overrides: {},
			};
			const commands = await listSkillCommands(project, admission);
			expect(
				commands.filter((command) => command.name === "skill:deploy").map((c) => c.description),
			).toEqual(["project deploy"]);
			const catalog = await listSkillCatalog(project, admission);
			expect(
				catalog
					.filter((entry) => entry.name === "deploy")
					.map((entry) => [entry.group, entry.decision])
					.sort(),
			).toEqual([
				["personal", "disabled"],
				["project", "load"],
			]);
			const overridden = { ...admission, overrides: { lint: "on" as const } };
			expect(
				(await listSkillCommands(project, overridden))
					.filter((command) => command.name === "skill:deploy")
					.map((c) => c.description),
			).toEqual(["project deploy"]);
			expect(
				(await listSkillCatalog(project, overridden))
					.filter((entry) => entry.name === "deploy")
					.map((entry) => [entry.group, entry.decision])
					.sort(),
			).toEqual([
				["personal", "disabled"],
				["project", "load"],
			]);
			const optedIn = await listSkillCommands(project, { ...admission, otherAgentSkills: true });
			expect(
				optedIn.filter((command) => command.name === "skill:deploy").map((c) => c.description),
			).toEqual(["personal deploy"]);
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

	it("projects provider owners the loader loaded: never an excluded generation artifact, never a project owner when untrusted", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-provider-owners-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const generationArtifact = join(agentDir, "extensions", "generation.ts");
		const registering = (provider: string) =>
			`export default function owner(pi) { pi.registerProvider("${provider}", { baseUrl: "http://owner.local", apiKey: "x", api: "owner", models: [], streamSimple: () => { throw new Error("unused"); } }); }\n`;
		mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		mkdirSync(home, { recursive: true });
		writeFileSync(generationArtifact, registering("generation-owned"));
		writeFileSync(join(project, ".pi", "extensions", "repo.ts"), registering("project-owned"));
		const restore = stubSkillEnv(home, agentDir);
		try {
			const load = (excluded: string[]) =>
				buildResourceLoader(
					project,
					SettingsManager.create(project, agentDir, { projectTrusted: true }),
					() => ctx(true),
					excluded,
				);
			const plain = await load([]);
			const excluding = await load([generationArtifact]);
			expect(providerExtensionPaths(plain, "generation-owned", true)).toHaveLength(1);
			expect(providerExtensionPaths(excluding, "generation-owned", true)).toEqual([]);
			for (const loader of [plain, excluding]) {
				expect(providerExtensionPaths(loader, "project-owned", true)).toHaveLength(1);
				expect(providerExtensionPaths(loader, "project-owned", false)).toEqual([]);
			}
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

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
				enabledGroups: [],
				otherAgentSkills: true,
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
				enabledGroups: [],
				otherAgentSkills: true,
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
				enabledGroups: [],
				otherAgentSkills: true,
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

const hostServices: HostSessionServices = {
	expectToolResponse: () => {},
	awaitToolResponse: async () => ({ kind: "deferred" }),
	workspaceFiles,
};

describe("registry extensions", () => {
	async function visualizeTool(cwd: string, agentDir: string) {
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const loader = await buildResourceLoader(
			cwd,
			settingsManager,
			() => ctx(true),
			[],
			[],
			hostServices,
		);
		const extension = loader
			.getExtensions()
			.extensions.find((candidate) => candidate.tools.has("visualize"));
		if (!extension) throw new Error("visualize is not loaded");
		const tool = extension.tools.get("visualize");
		if (!tool) throw new Error("visualize tool is missing");
		return {
			extension,
			execute: (params: unknown) =>
				tool.definition.execute("call", params, undefined, undefined, { cwd } as never),
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
			const drawn = await execute({ type: "diagram", mermaid: "flowchart LR\n A --> B" });
			expect(drawn).toMatchObject({ details: { type: "diagram" } });
			const saved = /Saved to `(\.thinkrail\/context\/visualize\/[^`]+\.md)`/.exec(
				drawn.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
			)?.[1];
			expect(saved).toBeDefined();
			expect(readFileSync(join(project, saved as string), "utf8")).toContain("```mermaid");
			expect(readFileSync(join(project, ".thinkrail", "context", ".gitignore"), "utf8")).toBe(
				"*\n",
			);
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
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[],
				hostServices,
			);
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

	it("rebuilds behind the same loader when an installed extension loads or goes away", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-installed-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const dataDir = join(root, "data");
		for (const dir of [project, home, agentDir, dataDir]) mkdirSync(dir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const stop = startInstalledExtensions({ dataDir, onChange: () => {} });
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[],
				hostServices,
			);
			const paths = () => loader.getExtensions().extensions.map((extension) => extension.path);
			expect(paths()).not.toContain("<inline:ext:loader-installed>");
			const folder = join(root, "ext");
			mkdirSync(join(folder, "server"), { recursive: true });
			writeFileSync(
				join(folder, "package.json"),
				JSON.stringify({
					name: "loader-installed",
					thinkrail: { api: "1.0", server: "server/index.ts" },
				}),
			);
			writeFileSync(
				join(folder, "server", "index.ts"),
				'export default { name: "loader-installed", extensions: [() => {}] };\n',
			);
			const declarations = join(dataDir, "extensions.json");
			writeFileSync(declarations, JSON.stringify({ extensions: [folder] }));
			await installedExtensions()?.reconcile();
			bumpPackagesRevision();
			expect(isLoaderPolicyStale(loader)).toBe(true);
			await loader.reload();
			expect(isLoaderPolicyStale(loader)).toBe(false);
			expect(paths()).toContain("<inline:ext:loader-installed>");
			expect(paths()).toContain("<inline:visualize>");
			writeFileSync(declarations, JSON.stringify({ extensions: [] }));
			await installedExtensions()?.reconcile();
			await loader.reload();
			expect(paths()).not.toContain("<inline:ext:loader-installed>");
		} finally {
			stop();
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("starts a chat past an installed factory that never settles, with that extension's load error", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-hung-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const dataDir = join(root, "data");
		for (const dir of [project, home, agentDir, dataDir]) mkdirSync(dir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const folder = join(root, "ext");
		mkdirSync(join(folder, "server"), { recursive: true });
		writeFileSync(
			join(folder, "package.json"),
			JSON.stringify({
				name: "hung-factory",
				thinkrail: { api: "1.0", server: "server/index.ts" },
			}),
		);
		writeFileSync(
			join(folder, "server", "index.ts"),
			'export default { name: "hung-factory", extensions: [() => new Promise(() => {})] };\n',
		);
		writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: [folder] }));
		const stop = startInstalledExtensions({ dataDir, onChange: () => {} });
		try {
			await installedExtensions()?.reconcile();
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			jest.useFakeTimers();
			let built: Awaited<ReturnType<typeof buildResourceLoader>> | undefined;
			const building = buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[],
				hostServices,
			).then((loader) => {
				built = loader;
			});
			while (!built) {
				await new Promise((resolve) => setImmediate(resolve));
				if (jest.getTimerCount() > 0) jest.advanceTimersByTime(EXTENSION_LOAD_TIMEOUT_MS);
			}
			jest.useRealTimers();
			await building;
			const result = built?.getExtensions();
			expect(result?.extensions.map((extension) => extension.path)).toContain("<inline:visualize>");
			expect(result?.errors).toContainEqual(
				expect.objectContaining({
					error: "hung-factory did not finish loading within 10 s",
				}),
			);
		} finally {
			jest.useRealTimers();
			stop();
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("never lets an installed extension take a host-owned tool, a host command or a pi package's tool", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-shadow-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const dataDir = join(root, "data");
		for (const dir of [project, home, join(agentDir, "extensions"), dataDir])
			mkdirSync(dir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const tool = (name: string) =>
			`pi.registerTool({ name: "${name}", label: "x", description: "x", parameters: Type.Object({}), async execute() { return { content: [], details: {} }; } });`;
		writeFileSync(
			join(agentDir, "extensions", "weather.ts"),
			`import { Type } from "typebox";\nexport default (pi) => { ${tool("weather")} };\n`,
		);
		const names = [
			"ask_user_question",
			"set_title",
			"Agent",
			"tool_search",
			"mcp__docs__search",
			"weather",
			"shadow_own",
		];
		const folder = join(root, "shadow");
		mkdirSync(join(folder, "server"), { recursive: true });
		writeFileSync(
			join(folder, "package.json"),
			JSON.stringify({ name: "shadow", thinkrail: { api: "1.0", server: "server/index.ts" } }),
		);
		writeFileSync(
			join(folder, "server", "index.ts"),
			`import { Type } from "typebox";\nexport default { name: "shadow", extensions: [(pi) => { ${names.map(tool).join(" ")} pi.registerCommand("mcp", { handler: async () => {} }); }] };\n`,
		);
		writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: [folder] }));
		const stop = startInstalledExtensions({
			dataDir,
			onChange: () => {},
			hostToolFactories: HOST_INLINE_FACTORIES,
		});
		const stub = (name: string) => (pi: Parameters<typeof headlessSearchPolicy>[0]) => {
			pi.registerTool({
				name,
				label: "x",
				description: "x",
				parameters: Type.Object({}),
				execute: async () => ({ content: [], details: {} }),
			});
		};
		try {
			await installedExtensions()?.reconcile();
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[
					stub("Agent"),
					stub("mcp__docs__search"),
					...createMcpEngine({ loadConfig: () => ({ servers: [], errors: [] }) }).extensions,
				],
				hostServices,
			);
			const { extensions } = loader.getExtensions();
			const owner = (name: string) =>
				extensions.find((extension) => extension.tools.has(name))?.path;
			const paths = extensions.map((extension) => extension.path);
			expect(paths).toContain("builtin:mcp");
			expect(paths).toContain("builtin:tool-search");
			expect(owner("ask_user_question")).toBe("<inline:ask-user-question>");
			for (const name of ["set_title", "Agent", "mcp__docs__search"]) {
				expect(owner(name)).toMatch(/^<inline:\d+>$/);
			}
			expect(owner("tool_search")).toBe("builtin:tool-search");
			expect(owner("weather")).toBe(join(agentDir, "extensions", "weather.ts"));
			expect(owner("shadow_own")).toBe("<inline:ext:shadow>");
			const commandOwner = extensions.find((extension) => extension.commands.has("mcp"))?.path;
			expect(commandOwner).toBe("builtin:mcp");
			const status = JSON.parse(readFileSync(join(dataDir, "extensions", "status.json"), "utf8"));
			expect(status.extensions[0]).toMatchObject({
				state: "loaded",
				tools: ["Agent", "tool_search", "mcp__docs__search", "weather", "shadow_own"],
				shadowed: ["ask_user_question", "set_title"],
			});
		} finally {
			stop();
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reserves every named inline extension the host composes for itself", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-names-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		for (const dir of [project, home, agentDir]) mkdirSync(dir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				createMcpEngine({ loadConfig: () => ({ servers: [], errors: [] }) }).extensions,
				hostServices,
			);
			const { extensions, errors } = loader.getExtensions();
			const registry = new Set(builtinServerExtensions.map((entry) => entry.extension.name));
			const hostNamed = [
				...extensions.map((extension) => extension.path),
				...errors.map((e) => e.path),
			]
				.map((path) => /^(?:<inline:([^>]+)>|builtin:(.+))$/.exec(path))
				.flatMap((match) => (match ? [(match[1] ?? match[2] ?? "").replace(/#\d+$/, "")] : []))
				.filter((name) => !/^\d+$/.test(name) && !registry.has(name));
			expect(hostNamed.length).toBeGreaterThan(0);
			const children = [...childBaseExtensionFactories(), ...childExtensionFactories("w1")]
				.map((inline) => nameOf(inline).replace(/#\d+$/, ""))
				.filter((name) => name !== "fn" && !registry.has(name));
			for (const name of [...hostNamed, ...children]) {
				expect<readonly string[]>(HOST_BUILTIN_EXTENSION_NAMES).toContain(name);
			}
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("marks a loader stale when an extension setting changes and current again after reload", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-settings-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		let values: Record<string, Record<string, boolean>> = {};
		setExtensionSettingsResolver(() => values);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[],
				hostServices,
			);
			expect(isLoaderPolicyStale(loader)).toBe(false);
			values = { "ask-user-question": { richPreviews: false } };
			expect(isLoaderPolicyStale(loader)).toBe(true);
			await loader.reload();
			expect(isLoaderPolicyStale(loader)).toBe(false);
			values = { "ask-user-question": { richPreviews: false } };
			expect(isLoaderPolicyStale(loader)).toBe(false);
		} finally {
			setExtensionSettingsResolver(null);
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads extensions with the settings snapshot it records, so a change-and-revert mid-reload stays consistent", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-registry-settings-race-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const off = { "ask-user-question": { richPreviews: false } };
		const on = { "ask-user-question": { richPreviews: true } };
		let reads: Record<string, Record<string, boolean>>[] = [];
		let settled = on;
		setExtensionSettingsResolver(() => reads.shift() ?? settled);
		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(
				project,
				settingsManager,
				() => ctx(true),
				[],
				[],
				hostServices,
			);
			const askSchema = () =>
				JSON.stringify(
					loader
						.getExtensions()
						.extensions.flatMap((extension) => [...extension.tools.values()])
						.find((tool) => tool.definition.name === "ask_user_question")?.definition.parameters,
				);
			expect(askSchema()).toContain("previewFile");
			reads = [off, on];
			settled = off;
			await loader.reload();
			reads = [];
			expect(askSchema()).not.toContain("previewFile");
			expect(isLoaderPolicyStale(loader)).toBe(false);
		} finally {
			setExtensionSettingsResolver(null);
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("treats a throwing extension settings resolver as no stored values", () => {
		setExtensionSettingsResolver(() => {
			throw new Error("broken config");
		});
		try {
			expect(extensionSettings()).toEqual({});
		} finally {
			setExtensionSettingsResolver(null);
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
		const children = childExtensionFactories("w1");
		expect(children).toHaveLength(3 + registryInlineExtensions("childExtensions").length);
		expect(children[0]).toBe(headlessSearchPolicy);
		expect(typeof children[1]).toBe("function");
		expect(children[2]).toBe(skillCatalog);
		const names = (inlines: typeof children) =>
			inlines.map((inline) => (typeof inline === "function" ? "fn" : inline.name));
		expect(names(children.slice(3))).toEqual(names(registryInlineExtensions("childExtensions")));
		expect(names(children.slice(3))).toEqual(["web-access"]);
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

	it("leaves a user's install of the vanilla /insights package out while session insights is on", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-superseded-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const extensionEntry = createRequire(import.meta.url).resolve(
			"@thinkrail/ext-session-insights/server",
		);
		const corePackage = join(
			createRequire(extensionEntry).resolve("@thinkrail/pi-session-insights/package.json"),
			"..",
		);
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [corePackage] }));
		const restore = stubSkillEnv(home, agentDir);
		let disabled = new Set<string>();
		setDisabledExtensionsResolver(() => disabled);
		try {
			const settingsManager = createPiSettings(project, agentDir, {
				projectTrusted: true,
				packages: "enabled",
			});
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const commands = () =>
				loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]);
			expect(loader.getExtensions().errors).toEqual([]);
			expect(commands()).not.toContain("insights");
			expect(isLoaderPolicyStale(loader)).toBe(false);

			disabled = new Set(["session-insights"]);
			expect(isLoaderPolicyStale(loader)).toBe(true);
			await loader.reload();
			expect(commands()).toContain("insights");
			expect(isLoaderPolicyStale(loader)).toBe(false);
			disabled = new Set();
			expect(isLoaderPolicyStale(loader)).toBe(true);
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a loader without a superseded package is not stale when a superseding extension flips", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-superseded-none-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		for (const dir of [project, home, agentDir]) mkdirSync(dir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		let disabled = new Set<string>();
		setDisabledExtensionsResolver(() => disabled);
		try {
			const settingsManager = createPiSettings(project, agentDir, {
				projectTrusted: true,
				packages: "enabled",
			});
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			disabled = new Set(["session-insights"]);
			expect(isLoaderPolicyStale(loader)).toBe(false);
		} finally {
			setDisabledExtensionsResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a workspace without specs gets no spec-graph child and no spec rule, the rest unchanged", async () => {
		setSpecsEnabledResolver((workspaceId) => workspaceId !== "chat-1");
		try {
			const withSpecs = childExtensionFactories("w1");
			const withoutSpecs = childExtensionFactories("chat-1");
			const specGraph = withSpecs[1];
			if (!specGraph) throw new Error("the spec-graph child is missing");
			expect(withoutSpecs).toHaveLength(withSpecs.length - 1);
			expect(withoutSpecs[0]).toBe(headlessSearchPolicy);
			expect(childExtensionFactories("w1")).toContain(specGraph);
			expect(withoutSpecs).not.toContain(specGraph);
			const sections = (workspaceId: string) => {
				const handlers: ((event: unknown) => void)[] = [];
				const pi = {
					on: (_name: string, handler: (event: unknown) => void) => handlers.push(handler),
				};
				const factory = withoutSpecRule(workspaceId);
				if (typeof factory !== "function") throw new Error("an inline factory expected");
				void factory(pi as never);
				const sections: Record<string, string> = { [SPEC_SECTION]: "rule", other: "kept" };
				const event = { systemPromptOptions: { sections } };
				for (const handler of handlers) handler(event);
				return event.systemPromptOptions.sections;
			};
			expect(sections("w1")).toEqual({ [SPEC_SECTION]: "rule", other: "kept" });
			expect(sections("chat-1")).toEqual({ other: "kept" });
		} finally {
			setSpecsEnabledResolver(() => true);
		}
	});

	it("guards every child's images, artifacts and compacted skills from the tool-free base set, and offers the skill catalog only to opted-in children", () => {
		expect(childBaseExtensionFactories()).toEqual([
			oversizedImageGuard,
			artifactsGuard,
			skillCarryover,
		]);
		expect(childExtensionFactories("w1")).not.toContain(oversizedImageGuard);
		expect(childExtensionFactories("w1")).not.toContain(skillCarryover);
		expect(childExtensionFactories("w1")).toContain(skillCatalog);
	});
});

describe("pi packages", () => {
	const writePackage = (root: string) =>
		writeFixturePiPackage(join(root, "pkgs", "fixture-tools"), {
			extensions: [{ file: "hello.ts", tool: "fixture_hello" }],
		});

	it("drops a switched-off package's extensions, skills and prompts and re-decides on reload", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-pi-packages-off-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const pkg = writePackage(root);
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		let disabled = new Set<string>();
		setDisabledPackagesResolver(() => disabled);
		try {
			const settingsManager = createPiSettings(project, agentDir, {
				projectTrusted: true,
				packages: "enabled",
			});
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const tools = () =>
				loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
			const skills = () => loader.getSkills().skills.map((skill) => skill.name);
			const prompts = () => loader.getPrompts().prompts.map((prompt) => prompt.name);
			expect(tools()).toContain("fixture_hello");
			expect(skills()).toContain("triage");
			expect(prompts()).toContain("standup");
			expect(isLoaderPolicyStale(loader)).toBe(false);

			disabled = new Set([`local:${pkg}`]);
			expect(isLoaderPolicyStale(loader)).toBe(true);
			await loader.reload();
			expect(isLoaderPolicyStale(loader)).toBe(false);
			expect(tools()).not.toContain("fixture_hello");
			expect(skills()).not.toContain("triage");
			expect(prompts()).not.toContain("standup");
			expect(await listSkillCommands(project, ctx(true))).not.toContainEqual(
				expect.objectContaining({ name: "skill:triage" }),
			);
			expect((await listSkillCatalog(project, ctx(true))).map((entry) => entry.name)).not.toContain(
				"triage",
			);

			disabled = new Set();
			await loader.reload();
			expect(tools()).toContain("fixture_hello");
			expect(skills()).toContain("triage");
			expect((await listSkillCatalog(project, ctx(true))).map((entry) => entry.name)).toContain(
				"triage",
			);

			bumpPackagesRevision();
			expect(isLoaderPolicyStale(loader)).toBe(true);
			await loader.reload();
			expect(isLoaderPolicyStale(loader)).toBe(false);
		} finally {
			setDisabledPackagesResolver(() => new Set());
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("never installs a switched-off package that is missing on disk, and hides it from a child's settings too", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-pi-packages-missing-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const offline = process.env.PI_OFFLINE;
		delete process.env.PI_OFFLINE;
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["npm:@fixture/switched-off@1.0.0"] }),
		);
		setDisabledPackagesResolver(() => new Set(["npm:@fixture/switched-off"]));
		const prototype = DefaultPackageManager.prototype as unknown as {
			installNpm: () => Promise<void>;
		};
		const installNpm = spyOn(prototype, "installNpm").mockResolvedValue();
		try {
			const settingsManager = createPiSettings(project, agentDir, {
				projectTrusted: true,
				packages: "enabled",
			});
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			expect(installNpm).not.toHaveBeenCalled();
			expect(settingsManager.getGlobalSettings().packages).toEqual([]);
			expect(loader.getExtensions().errors).toEqual([]);
		} finally {
			installNpm.mockRestore();
			setDisabledPackagesResolver(() => new Set());
			if (offline === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = offline;
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("tells the packages layer when a chat's load installed a declared package", async () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-pi-packages-installed-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = stubSkillEnv(home, agentDir);
		const pkg = join(root, "pkgs", "late");
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		let installed = 0;
		const previousListener = setInstalledPackagesListener(() => {
			installed += 1;
		});
		const original = DefaultPackageManager.prototype.resolve;
		const resolveSpy = spyOn(DefaultPackageManager.prototype, "resolve").mockImplementation(
			async function (this: DefaultPackageManager, ...args) {
				if (!existsSync(pkg)) {
					mkdirSync(pkg, { recursive: true });
					writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "late", pi: {} }));
				}
				return original.apply(this, args);
			},
		);
		try {
			const settingsManager = createPiSettings(project, agentDir, {
				projectTrusted: true,
				packages: "enabled",
			});
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			expect(installed).toBe(1);
			await loader.reload();
			expect(installed).toBe(1);
		} finally {
			resolveSpy.mockRestore();
			setInstalledPackagesListener(previousListener);
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
