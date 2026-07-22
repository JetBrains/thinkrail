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
import type { SlashCommandInfo } from "@thinkrail/contracts";
import { askUserQuestionExtension } from "./askUserQuestion";
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

/** Keep compatibility aliases' provenance truthful without overwriting an explicit Pi settings source. */
function compatibilitySkillsOverride(sources: CompatibilitySkillSource[]) {
	return (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
		...current,
		skills: current.skills.map((skill) => {
			// Pi-configured/native/shared resources already carry user/project metadata and outrank inferred
			// aliases. Only additional paths get the loader's default temporary scope and need relabeling.
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
		}),
	});
}

function resolveSkillInputs(
	cwd: string,
	trustedProject: boolean,
): {
	additionalSkillPaths: string[];
	skillsOverride: ReturnType<typeof compatibilitySkillsOverride>;
} {
	const discovered = discoverCompatibilitySkillSources(cwd);
	// Personal aliases (`~/.claude` …) are the user's own machine — always safe. Project-scoped aliases (a
	// repo's committed `.claude/skills` etc.) are attacker-controlled for a cloned repo and get injected into
	// the agent's system prompt, so they load only after an explicit project-trust grant. Fail closed: an
	// untrusted (or undecided) project contributes no aliases at all.
	const personal = discovered.filter((source) => source.scope === "user");
	const project = trustedProject ? discovered.filter((source) => source.scope === "project") : [];
	const sources = [...personal, ...project];
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	return {
		// DefaultResourceLoader puts Pi settings/native/shared resources first. We then add ThinkRail's bundled
		// skills, the user's personal aliases, then (only when trusted) the project's aliases — so first-name-wins
		// gives pi-native > bundled > personal > project: a repo can never shadow your own or ThinkRail's skills.
		additionalSkillPaths: [...bundledSkillPaths, ...sources.map((source) => source.path)],
		skillsOverride: compatibilitySkillsOverride(sources),
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
 * default discovery. `trustedProject` gates the project-scoped aliases (personal/bundled always load) —
 * pass the owning project's trust decision; fail closed (`false`) when it is unknown.
 */
export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
	trustedProject: boolean,
): Promise<ResourceLoader> {
	const sharedFactories = [headlessSearchPolicy, askUserQuestionExtension];
	const skillInputs = resolveSkillInputs(cwd, trustedProject);
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

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

/**
 * Skill-only pre-session catalog for New Workspace autocomplete. It shares the real session's Pi settings,
 * package/native discovery, compatibility aliases, and bundled skills, but never loads extension factories
 * or creates a model/session/transcript. `trustedProject` gates the project-scoped aliases, exactly as the
 * live session does. Cached briefly per `(cwd, trust)` so flipping the project picker doesn't re-walk the
 * filesystem each time; because trust is part of the key, a fresh grant misses the stale untrusted entry.
 */
export async function listSkillCommands(
	cwd: string,
	trustedProject: boolean,
): Promise<SlashCommandInfo[]> {
	const cacheKey = `${trustedProject ? "T" : "U"} ${cwd}`;
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...resolveSkillInputs(cwd, trustedProject),
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
