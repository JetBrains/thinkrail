// Bundles the `pi-web-access` (web_search + fetch_content), `pi-visualize` (the `visualize` tool),
// `pi-spec-graph` (spec_* tools + the spec-graph skill), and `pi-thinkrail-workflow` (the brainstorming
// skill) extensions into a session's resource loader, so the tools are present out of the box without a
// separate install. Two loading modes:
// - Run-from-source: explicit `additionalExtensionPaths` (all four ship raw `.ts`; pi's loader jiti-loads
//   TS, keeping their source out of our typecheck graph — `pi-spec-graph`'s exports map keeps `./index.ts`
//   reachable alongside the `./core` subpath the `spec/` module value-imports). Paths resolve lazily on
//   first use — resolution needs `node_modules`, which a compiled binary lacks. `pi-spec-graph` and
//   `pi-thinkrail-workflow` are workspace packages (not pi-installed), so pi's package manager won't
//   auto-discover their `pi.skills` manifests — we point `additionalSkillPaths` at their `skills/` dirs.
// - Compiled binary: the launcher injects the same four extensions as value-imported factories + a staged
//   on-disk skills dir via `setBundledExtensions` (pi gives `extensionFactories` full API parity with
//   path loading; pi reads skills via plain fs, so they must live on the real filesystem).

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	type ResourceLoader,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { askUserQuestionExtension } from "./askUserQuestion";

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
	devPaths = {
		extensionPaths: [webAccessPath, visualizePath, specGraphPath, workflowPath],
		skillPaths: [join(dirname(specGraphPath), "skills"), join(dirname(workflowPath), "skills")],
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

/**
 * A resource loader with `pi-web-access` + `pi-visualize` + `pi-spec-graph` (and its skill) +
 * `pi-thinkrail-workflow` (and its skill) (+ the headless-search policy) and our host-owned
 * `ask_user_question` tool layered onto pi's default discovery.
 */
export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
): Promise<ResourceLoader> {
	const sharedFactories = [headlessSearchPolicy, askUserQuestionExtension];
	const loader = new DefaultResourceLoader(
		bundled
			? {
					cwd,
					agentDir: getAgentDir(),
					settingsManager,
					additionalSkillPaths: [bundled.skillsDir],
					extensionFactories: [...bundled.factories, ...sharedFactories],
				}
			: (() => {
					const paths = resolveDevPaths();
					return {
						cwd,
						agentDir: getAgentDir(),
						settingsManager,
						additionalExtensionPaths: paths.extensionPaths,
						additionalSkillPaths: paths.skillPaths,
						extensionFactories: sharedFactories,
					};
				})(),
	);
	await loader.reload();
	return loader;
}
