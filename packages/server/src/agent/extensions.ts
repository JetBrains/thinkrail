// `pi-spec-graph` (spec_* tools + the spec-graph skill), `pi-thinkrail-workflow` (the workflow-router
// rule + workflow skills), and `pi-todos` (todo_* tools + the todos skill) extensions and recognized
// portable cross-agent skill aliases into a session's resource loader, so they are present without a
// separate install/import. Two bundled-resource modes:
// - Run-from-source: explicit `additionalExtensionPaths` (all five ship raw `.ts`; pi's loader jiti-loads
//   TS, keeping their source out of our typecheck graph — `pi-spec-graph`'s exports map keeps `./index.ts`
//   reachable alongside the `./core` subpath the `spec/` module value-imports). Paths resolve lazily on
//   first use — resolution needs `node_modules`, which a compiled binary lacks. `pi-spec-graph`,
//   `pi-thinkrail-workflow`, and `pi-todos` are workspace packages (not pi-installed), so pi's package
//   manager won't auto-discover their `pi.skills` manifests — we point `additionalSkillPaths` at their
//   `skills/` dirs, before the personal/project aliases so bundled skills outrank them (precedence in
//   `resolveSkillInputs`).
// - Compiled binary: the launcher injects the same five extensions as value-imported factories + a staged
//   on-disk skills dir via `setBundledExtensions` (pi gives `extensionFactories` full API parity with
//   path loading; pi reads skills via plain fs, so they must live on the real filesystem).

import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import {
	createSyntheticSourceInfo,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	type ResourceDiagnostic,
	type ResourceLoader,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { SkillCatalogEntry, SlashCommandInfo } from "@thinkrail/contracts";
import { askUserQuestionExtension } from "./askUserQuestion";
import { decideSkill, type SkillAdmissionContext } from "./skillAdmission";
import { type CompatibilitySkillSource, discoverCompatibilitySkillSources } from "./skillSources";

/** A bundled extension entry's default export — the pi factory shape the loader invokes. */
export type BundledExtensionFactory = ExtensionFactory;

export interface BundledExtensions {
	/** The bundled extension entries' default-export factories, in load order. */
	factories: BundledExtensionFactory[];
	/** A real on-disk dir of staged skill roots (each `<name>/SKILL.md`) for `additionalSkillPaths`. */
	skillsDir: string;
}

let bundled: BundledExtensions | undefined;

/**
 * Compiled-binary seam: inject the bundled extensions as value-imported factories (+ a staged skills
 * dir) where path-loading is impossible — a `bun build --compile` binary has no `node_modules` to
 * resolve the extension entries or their deps from. Call before the first session is created.
 */
export function setBundledExtensions(extensions: BundledExtensions): void {
	bundled = extensions;
}

/**
 * The run-from-source wiring: the four extension entries + the workspace packages' skills dirs, resolved
 * out of `node_modules` on first use (memoized — module-load resolution would crash a compiled binary).
 */
let devPaths: { extensionPaths: string[]; skillPaths: string[] } | undefined;
function resolveDevPaths(): { extensionPaths: string[]; skillPaths: string[] } {
	if (devPaths) return devPaths;
	const require = createRequire(import.meta.url);
	const webAccessPath = require.resolve("pi-web-access/index.ts");
	const visualizePath = require.resolve("pi-visualize/index.ts");
	const specGraphPath = require.resolve("pi-spec-graph/index.ts");
	const workflowPath = require.resolve("pi-thinkrail-workflow/index.ts");
	const todosPath = require.resolve("pi-todos/index.ts");
	devPaths = {
		extensionPaths: [webAccessPath, visualizePath, specGraphPath, workflowPath, todosPath],
		skillPaths: [
			join(dirname(specGraphPath), "skills"),
			join(dirname(workflowPath), "skills"),
			join(dirname(todosPath), "skills"),
		],
	};
	return devPaths;
}

/**
 * `pi-web-access`'s `web_search` opens an interactive **browser curator** whenever the UI is dialog-capable
 * (our `rpc` host reports `hasUI: true` but has no browser to render it), which would hang the tool. Default
 * `workflow` to `"none"` before it runs so search returns results directly. A caller that sets `workflow`
 * explicitly still wins.
 */
const headlessSearchPolicy: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "web_search") return;
		const input = event.input as Record<string, unknown>;
		if (input.workflow == null) input.workflow = "none";
	});
};

function isUnderPath(path: string, root: string): boolean {
	const normalizedPath = resolve(path);
	const normalizedRoot = resolve(root);
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

/** Relabel one skill's default `temporary` scope to its true provider/scope; leave configured ones alone. */
function relabelAliasProvenance(skill: Skill, sources: CompatibilitySkillSource[]): Skill {
	// Pi-configured/native/shared resources already carry user/project metadata and outrank inferred aliases;
	// only the loader's default `temporary` scope (an additional path) needs relabeling.
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

/**
 * The combined skills override: relabel compatibility aliases' provenance AND apply the admission decision,
 * so a session only ever loads skills that resolve to `load` — untrusted / unacknowledged / disabled ones
 * never reach the system prompt or the `/skill:` list. `sources` identifies which loaded skills are
 * project-scoped aliases (by file path); `ctx` carries trust + acknowledged + disables + workspace overrides.
 */
function skillsGate(sources: CompatibilitySkillSource[], ctx: SkillAdmissionContext) {
	const projectAliasPaths = sources.filter((s) => s.scope === "project").map((s) => s.path);
	const isProjectAlias = (filePath: string) =>
		projectAliasPaths.some((path) => isUnderPath(filePath, path));
	return (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
		...current,
		skills: current.skills
			.map((skill) => relabelAliasProvenance(skill, sources))
			.filter(
				(skill) =>
					decideSkill({ name: skill.name, isProjectAlias: isProjectAlias(skill.filePath) }, ctx) ===
					"load",
			),
	});
}

function resolveSkillInputs(
	cwd: string,
	ctx: SkillAdmissionContext,
): {
	additionalSkillPaths: string[];
	skillsOverride: ReturnType<typeof skillsGate>;
} {
	const discovered = discoverCompatibilitySkillSources(cwd);
	const personal = discovered.filter((source) => source.scope === "user");
	const project = discovered.filter((source) => source.scope === "project");
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	return {
		// All alias dirs are made discoverable so the catalog can enumerate them; the per-skill admission gate
		// (`skillsGate`) is what actually withholds untrusted/unacknowledged/disabled ones. Path order sets the
		// first-name-wins precedence pi-native > bundled > personal > project.
		additionalSkillPaths: [
			...bundledSkillPaths,
			...personal.map((source) => source.path),
			...project.map((source) => source.path),
		],
		skillsOverride: skillsGate(discovered, ctx),
	};
}

/** Map Pi's canonical skill records onto the existing slash-command wire shape. */
export function toSkillCommands(skills: readonly Skill[]): SlashCommandInfo[] {
	return skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		sourceInfo: skill.sourceInfo,
	}));
}

/**
 * A resource loader with `pi-web-access` + `pi-visualize` + `pi-spec-graph` (and its skill) +
 * `pi-thinkrail-workflow` (and its skills) + `pi-todos` (and its skill) (+ the headless-search policy),
 * our host-owned `ask_user_question` tool, and portable cross-agent skill aliases layered onto Pi's
 * default discovery. `admission` gates the skills (project-scoped aliases behind trust + acknowledgment,
 * plus the per-skill enable/disable layer) — pass the owning workspace's resolved context; fail closed
 * when it is unknown.
 */
export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
	admission: SkillAdmissionContext,
): Promise<ResourceLoader> {
	const sharedFactories = [headlessSearchPolicy, askUserQuestionExtension];
	const skillInputs = resolveSkillInputs(cwd, admission);
	const common = {
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...skillInputs,
	};
	const loader = new DefaultResourceLoader(
		bundled
			? {
					...common,
					extensionFactories: [...bundled.factories, ...sharedFactories],
				}
			: {
					...common,
					additionalExtensionPaths: resolveDevPaths().extensionPaths,
					extensionFactories: sharedFactories,
				},
	);
	await loader.reload();
	return loader;
}

/** A stable cache key for a `(cwd, admission)` pair — sorted so equal contexts collide, distinct ones don't. */
function admissionCacheKey(cwd: string, ctx: SkillAdmissionContext): string {
	return JSON.stringify([
		cwd,
		ctx.trusted,
		[...ctx.acknowledged].sort(),
		[...ctx.disabled].sort(),
		Object.entries(ctx.overrides).sort(([a], [b]) => a.localeCompare(b)),
	]);
}

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

/**
 * Skill-only pre-session catalog for New Workspace autocomplete. It shares the real session's Pi settings,
 * package/native discovery, compatibility aliases, and bundled skills, but never loads extension factories
 * or creates a model/session/transcript. `admission` gates the skills exactly as the live session does.
 * Cached briefly per `(cwd, admission)` so flipping the project picker doesn't re-walk the filesystem; a
 * fresh grant changes the key, so it never returns a stale untrusted list.
 */
export async function listSkillCommands(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SlashCommandInfo[]> {
	const cacheKey = admissionCacheKey(cwd, admission);
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...resolveSkillInputs(cwd, admission),
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

/**
 * The project-scoped alias skill names present in a checkout right now — what granting trust acknowledges,
 * and the count the New Workspace / Welcome trust notice shows. A skills-only loader restricted to the
 * project alias dirs (no admission filter), so it enumerates them regardless of the current trust state.
 */
export async function listProjectAliasSkillNames(cwd: string): Promise<string[]> {
	const projectPaths = discoverCompatibilitySkillSources(cwd)
		.filter((source) => source.scope === "project")
		.map((source) => source.path);
	if (projectPaths.length === 0) return [];
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
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

/**
 * The full skill catalog for a workspace's Skills manager: every discovered skill (bundled + personal +
 * project + pi-native) with its admission verdict, so hidden skills show a reason instead of vanishing.
 * Unlike `listSkillCommands` this does NOT filter — it relabels provenance only and attaches each skill's
 * `decision`, letting the UI render untrusted / pending-ack / disabled entries with the right affordance.
 */
export async function listSkillCatalog(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SkillCatalogEntry[]> {
	const discovered = discoverCompatibilitySkillSources(cwd);
	const personal = discovered.filter((s) => s.scope === "user");
	const project = discovered.filter((s) => s.scope === "project");
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: [
			...bundledSkillPaths,
			...personal.map((s) => s.path),
			...project.map((s) => s.path),
		],
		// Relabel only (no admission filter) so the manager sees every discovered skill + its verdict.
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
		return {
			name: skill.name,
			description: skill.description,
			sourceInfo: skill.sourceInfo,
			gated,
			...(source?.plugin ? { plugin: source.plugin } : {}),
			decision: decideSkill({ name: skill.name, isProjectAlias: gated }, admission),
		};
	});
}
