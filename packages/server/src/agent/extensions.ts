import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createSyntheticSourceInfo,
	DefaultPackageManager,
	DefaultResourceLoader,
	type ExtensionFactory,
	getAgentDir,
	type InlineExtension,
	type LoadExtensionsResult,
	type PathMetadata,
	type ResourceDiagnostic,
	type ResourceLoader,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { SkillCatalogEntry, SlashCommandInfo } from "@thinkrail/contracts";
import specGraphExtension from "pi-spec-graph";
import {
	type ExtensionSessionServices,
	extensionSkillRoots,
	omitDisabledRegistryExtensions,
	preferRegistryTools,
	registryInlineExtensions,
	STAGED_HOST_SKILLS_ROUTE,
	serverExtensions,
} from "../extensions";
import { type BundledTrashHelpers, setBundledTrashHelpers } from "../trash";
import { oversizedImageGuard } from "./imageGuard";
import { requestReviewExtension } from "./requestReviewTool";
import { reviewToolExtension } from "./reviewTool";
import { decideSkill, type SkillAdmissionContext } from "./skillAdmission";
import {
	type CompatibilitySkillSource,
	candidateCompatibilitySkillRoots,
	discoverCompatibilitySkillSources,
} from "./skillSources";
import { setTitleExtension } from "./titleTool";

export type BundledExtensionFactory = ExtensionFactory;

export interface BundledExtensions {
	factories: BundledExtensionFactory[];
	skillsDir: string;
	trashHelpers: BundledTrashHelpers;
}

let bundled: BundledExtensions | undefined;

export async function registerBundledRuntime(extensions: BundledExtensions): Promise<void> {
	bundled = extensions;
	setBundledTrashHelpers(extensions.trashHelpers);
	const [{ registerBunOAuthFlows }, { bedrockProviderModule }, { setBedrockProviderModule }] =
		await Promise.all([
			import("@earendil-works/pi-ai/bun-oauth"),
			import("@earendil-works/pi-ai/bedrock-provider"),
			import("@earendil-works/pi-ai/compat"),
		]);
	registerBunOAuthFlows();
	setBedrockProviderModule(bedrockProviderModule);
}

let devPaths: { extensionPaths: string[]; hostSkillPaths: string[] } | undefined;
function resolveDevPaths(): { extensionPaths: string[]; hostSkillPaths: string[] } {
	if (devPaths) return devPaths;
	const require = createRequire(import.meta.url);
	const specGraphPath = require.resolve("pi-spec-graph/index.ts");
	const workflowPath = require.resolve("pi-thinkrail-workflow/index.ts");
	const todosPath = require.resolve("pi-todos/index.ts");
	devPaths = {
		extensionPaths: [specGraphPath, workflowPath, todosPath],
		hostSkillPaths: [
			join(dirname(specGraphPath), "skills"),
			join(dirname(workflowPath), "skills"),
			join(dirname(todosPath), "skills"),
			fileURLToPath(new URL("../../skills", import.meta.url)),
		],
	};
	return devPaths;
}

function isUnderPath(path: string, root: string): boolean {
	const normalizedPath = resolve(path);
	const normalizedRoot = resolve(root);
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function relabelAliasProvenance(skill: Skill, sources: CompatibilitySkillSource[]): Skill {
	if (skill.sourceInfo.scope !== "temporary") return skill;
	const source = sources.find((candidate) => isUnderPath(skill.filePath, candidate.path));
	if (!source) return skill;
	return {
		...skill,
		sourceInfo: createSyntheticSourceInfo(skill.filePath, {
			source: source.provider,
			scope: source.scope,
			origin: "top-level",
			baseDir: source.path,
		}),
	};
}

let devExtensionSkillRoots: ReadonlyMap<string, readonly string[]> | undefined;
function extensionSkillRootsByName(): ReadonlyMap<string, readonly string[]> {
	const skillsDir = bundled?.skillsDir;
	if (skillsDir !== undefined) {
		return new Map(
			serverExtensions.map((entry) => [
				entry.extension.name,
				extensionSkillRoots(entry, skillsDir),
			]),
		);
	}
	devExtensionSkillRoots ??= new Map(
		serverExtensions.map((entry) => [entry.extension.name, extensionSkillRoots(entry)]),
	);
	return devExtensionSkillRoots;
}

function extensionSkillPaths(include: (name: string) => boolean): string[] {
	return [...extensionSkillRootsByName()].flatMap(([name, roots]) => (include(name) ? roots : []));
}

function bundledSkillPaths(disabled: ReadonlySet<string> = new Set()): string[] {
	const host = bundled
		? [join(bundled.skillsDir, STAGED_HOST_SKILLS_ROUTE)]
		: resolveDevPaths().hostSkillPaths;
	return [...host, ...extensionSkillPaths((name) => !disabled.has(name))];
}

export function loadsDisabledExtensionSkills(skills: readonly Skill[]): boolean {
	const disabled = disabledExtensions();
	const roots = extensionSkillPaths((name) => disabled.has(name));
	return skills.some((skill) => roots.some((root) => isUnderPath(skill.filePath, root)));
}

function skillGroup(
	filePath: string,
	sources: CompatibilitySkillSource[],
	bundledPaths: string[],
): { group: string; isPlugin: boolean } {
	const source = sources.find((candidate) => isUnderPath(filePath, candidate.path));
	if (source?.plugin) return { group: source.plugin, isPlugin: true };
	if (source?.scope === "project") return { group: "project", isPlugin: false };
	if (source?.scope === "user") return { group: "personal", isPlugin: false };
	if (bundledPaths.some((path) => isUnderPath(filePath, path))) {
		return { group: "bundled", isPlugin: false };
	}
	return { group: "pi", isPlugin: false };
}

function skillsGate(cwd: string, bundledPaths: string[], getCtx: () => SkillAdmissionContext) {
	return (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		const ctx = getCtx();
		const sources = discoverCompatibilitySkillSources(cwd);
		const projectAliasPaths = sources.filter((s) => s.scope === "project").map((s) => s.path);
		const isProjectAlias = (filePath: string) =>
			projectAliasPaths.some((path) => isUnderPath(filePath, path));
		return {
			...current,
			skills: current.skills
				.map((skill) => relabelAliasProvenance(skill, sources))
				.filter((skill) => {
					const { group, isPlugin } = skillGroup(skill.filePath, sources, bundledPaths);
					return (
						decideSkill(
							{ name: skill.name, isProjectAlias: isProjectAlias(skill.filePath), group, isPlugin },
							ctx,
						) === "load"
					);
				}),
		};
	};
}

function resolveSkillInputs(
	cwd: string,
	getCtx: () => SkillAdmissionContext,
	disabled: ReadonlySet<string>,
): {
	additionalSkillPaths: string[];
	skillsOverride: ReturnType<typeof skillsGate>;
	refreshSkillPaths: (disabled: ReadonlySet<string>) => void;
} {
	const candidates = candidateCompatibilitySkillRoots(cwd);
	const compatibilityPaths = [
		...candidates.filter((source) => source.scope === "user"),
		...candidates.filter((source) => source.scope === "project"),
	].map((source) => source.path);
	const additionalSkillPaths: string[] = [];
	const refreshSkillPaths = (current: ReadonlySet<string>): void => {
		additionalSkillPaths.splice(
			0,
			additionalSkillPaths.length,
			...bundledSkillPaths(current),
			...compatibilityPaths,
		);
	};
	refreshSkillPaths(disabled);
	return {
		additionalSkillPaths,
		skillsOverride: skillsGate(cwd, bundledSkillPaths(), getCtx),
		refreshSkillPaths,
	};
}

export function toSkillCommands(skills: readonly Skill[]): SlashCommandInfo[] {
	return skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		sourceInfo: skill.sourceInfo,
	}));
}

let disabledExtensionsResolver: () => ReadonlySet<string> = () => new Set();
export function setDisabledExtensionsResolver(resolver: () => ReadonlySet<string>): void {
	disabledExtensionsResolver = resolver;
}

export function disabledExtensions(): ReadonlySet<string> {
	try {
		return disabledExtensionsResolver();
	} catch {
		return new Set();
	}
}

const isExtensionDisabled = (name: string): boolean => disabledExtensions().has(name);

export function childBaseExtensionFactories(): InlineExtension[] {
	return [oversizedImageGuard];
}

export function childExtensionFactories(): InlineExtension[] {
	return [specGraphExtension, ...registryInlineExtensions("childExtensions", isExtensionDisabled)];
}

export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
	getAdmission: () => SkillAdmissionContext,
	excludedExtensionPaths: readonly string[] = [],
	extraFactories: InlineExtension[] = [],
	session?: ExtensionSessionServices,
): Promise<ResourceLoader> {
	let disabledAtReload = disabledExtensions();
	const isDisabledAtReload = (name: string): boolean => disabledAtReload.has(name);
	const sharedFactories: InlineExtension[] = [
		...registryInlineExtensions("extensions", isDisabledAtReload, serverExtensions, session),
		reviewToolExtension,
		requestReviewExtension,
		setTitleExtension,
		oversizedImageGuard,
		...extraFactories,
	];
	const extensionFactories = bundled ? [...bundled.factories, ...sharedFactories] : sharedFactories;
	const { refreshSkillPaths, ...skillInputs } = resolveSkillInputs(
		cwd,
		getAdmission,
		disabledAtReload,
	);
	const agentDir = getAgentDir();
	const common = {
		cwd,
		agentDir,
		settingsManager,
		...skillInputs,
		extensionFactories,
		extensionsOverride: (result: LoadExtensionsResult) =>
			preferRegistryTools(omitDisabledRegistryExtensions(result, isDisabledAtReload)),
	};
	const devExtensionPaths = bundled ? [] : resolveDevPaths().extensionPaths;
	const applyCurrentPolicy = (): void => {
		settingsManager.setProjectTrusted(getAdmission().piResourceTrusted);
		disabledAtReload = disabledExtensions();
		refreshSkillPaths(disabledAtReload);
	};

	const excluded = new Set(excludedExtensionPaths.map((path) => resolve(path)));
	if (excluded.size === 0) {
		const loader = new DefaultResourceLoader({
			...common,
			additionalExtensionPaths: devExtensionPaths,
		});
		const reloadTrusted = loader.reload.bind(loader);
		loader.reload = async (options) => {
			applyCurrentPolicy();
			await reloadTrusted(options);
		};
		await loader.reload();
		return loader;
	}

	// pi keeps a reference to this array and reads it on every reload, so it is rebuilt in place.
	const additionalExtensionPaths: string[] = [...devExtensionPaths];
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
		builtinExtensions: builtinExtensionNames(extensionFactories),
	});
	let discoveredMetadata = new Map<string, PathMetadata>();
	const resolveExclusionPaths = async (): Promise<void> => {
		await settingsManager.reload();
		const resolvedResources = await packageManager.resolve();
		const next: string[] = [];
		const metadata = new Map<string, PathMetadata>();
		for (const resource of resolvedResources.extensions) {
			if (!resource.enabled) continue;
			if (resource.path.startsWith(BUILTIN_EXTENSION_PREFIX)) {
				next.push(resource.path);
				continue;
			}
			if (excluded.has(resolve(resource.path))) continue;
			next.push(resource.path);
			metadata.set(resolve(resource.path), resource.metadata);
		}
		additionalExtensionPaths.splice(
			0,
			additionalExtensionPaths.length,
			...devExtensionPaths,
			...next,
		);
		discoveredMetadata = metadata;
	};
	const loader = new DefaultResourceLoader({
		...common,
		noExtensions: true,
		additionalExtensionPaths,
	});
	const reloadResolved = loader.reload.bind(loader);
	loader.reload = async (options) => {
		applyCurrentPolicy();
		await resolveExclusionPaths();
		await reloadResolved(options);
		relabelDiscoveredExtensions(loader, discoveredMetadata);
	};
	await loader.reload();
	return loader;
}

const BUILTIN_EXTENSION_PREFIX = "builtin:";

export async function isBuiltinExtensionEnabled(
	cwd: string,
	projectTrusted: boolean,
	name: string,
): Promise<boolean> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
		builtinExtensions: [name],
	});
	const { extensions } = await packageManager.resolve(async () => "skip");
	const path = `${BUILTIN_EXTENSION_PREFIX}${name}`;
	return extensions.some((resource) => resource.path === path && resource.enabled);
}

function builtinExtensionNames(factories: readonly InlineExtension[]): string[] {
	return factories.flatMap((entry) =>
		typeof entry !== "function" && entry.builtin ? [entry.name] : [],
	);
}

function relabelDiscoveredExtensions(
	loader: DefaultResourceLoader,
	discoveredMetadata: ReadonlyMap<string, PathMetadata>,
): void {
	for (const extension of loader.getExtensions().extensions) {
		const metadata = discoveredMetadata.get(resolve(extension.resolvedPath));
		if (!metadata) continue;
		extension.sourceInfo = createSyntheticSourceInfo(extension.path, metadata);
		for (const command of extension.commands.values()) command.sourceInfo = extension.sourceInfo;
		for (const tool of extension.tools.values()) tool.sourceInfo = extension.sourceInfo;
	}
}

function admissionCacheKey(cwd: string, ctx: SkillAdmissionContext): string {
	return JSON.stringify([
		cwd,
		ctx.trusted,
		ctx.piResourceTrusted,
		[...ctx.acknowledged].sort(),
		[...ctx.disabled].sort(),
		[...ctx.disabledGroups].sort(),
		Object.entries(ctx.overrides).sort(([a], [b]) => a.localeCompare(b)),
		[...disabledExtensions()].sort(),
	]);
}

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

export async function listSkillCommands(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SlashCommandInfo[]> {
	const cacheKey = admissionCacheKey(cwd, admission);
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), {
		projectTrusted: admission.piResourceTrusted,
	});
	const { additionalSkillPaths, skillsOverride } = resolveSkillInputs(
		cwd,
		() => admission,
		disabledExtensions(),
	);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths,
		skillsOverride,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const value = toSkillCommands(loader.getSkills().skills);
	skillListCache.set(cacheKey, { at: Date.now(), value });
	return value;
}

export async function listProjectAliasSkillNames(cwd: string): Promise<string[]> {
	const projectPaths = discoverCompatibilitySkillSources(cwd)
		.filter((source) => source.scope === "project")
		.map((source) => source.path);
	if (projectPaths.length === 0) return [];
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: projectPaths,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader
		.getSkills()
		.skills.filter((skill) => projectPaths.some((path) => isUnderPath(skill.filePath, path)))
		.map((skill) => skill.name);
}

export async function listSkillCatalog(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SkillCatalogEntry[]> {
	const discovered = discoverCompatibilitySkillSources(cwd);
	const personal = discovered.filter((s) => s.scope === "user");
	const project = discovered.filter((s) => s.scope === "project");
	const allBundledSkillPaths = bundledSkillPaths();
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), {
		projectTrusted: admission.piResourceTrusted,
	});
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: [
			...bundledSkillPaths(disabledExtensions()),
			...personal.map((s) => s.path),
			...project.map((s) => s.path),
		],
		skillsOverride: (current) => ({
			...current,
			skills: current.skills.map((skill) => relabelAliasProvenance(skill, discovered)),
		}),
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader.getSkills().skills.map((skill) => {
		const source = discovered.find((candidate) => isUnderPath(skill.filePath, candidate.path));
		const gated = source?.scope === "project";
		const { group, isPlugin } = skillGroup(skill.filePath, discovered, allBundledSkillPaths);
		return {
			name: skill.name,
			description: skill.description,
			sourceInfo: skill.sourceInfo,
			gated,
			group,
			...(source?.plugin ? { plugin: source.plugin } : {}),
			decision: decideSkill(
				{ name: skill.name, isProjectAlias: gated, group, isPlugin },
				admission,
			),
		};
	});
}
