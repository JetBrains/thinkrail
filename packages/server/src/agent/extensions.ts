// Bundles the `pi-web-access` (web_search + fetch_content), `pi-visualize` (the `visualize` tool), and
// `pi-spec-graph` (spec_* tools + the spec-graph skill) extensions into a session's resource loader, so
// the tools are present out of the box without a separate install. Extensions load via explicit
// `additionalExtensionPaths` (all ship raw `.ts`; pi's loader jiti-loads TS, keeping their source out of
// our typecheck graph — `pi-spec-graph`'s exports map keeps `./index.ts` reachable alongside the `./core`
// subpath the `spec/` module value-imports). `pi-spec-graph` is a workspace package (not pi-installed), so
// pi's package manager won't auto-discover its `pi.skills` manifest — we point `additionalSkillPaths` at
// its `skills/` dir explicitly.

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

const require = createRequire(import.meta.url);
/** The installed `pi-web-access` extension entry (raw `.ts`; pi's loader handles it). */
const webAccessPath = require.resolve("pi-web-access/index.ts");
/** Our `pi-visualize` extension entry (the `visualize` tool; raw `.ts`, loaded by path like pi-web-access). */
const visualizePath = require.resolve("pi-visualize/index.ts");
/** The `pi-spec-graph` extension entry (workspace package, raw `.ts`; pi's loader handles it). */
const specGraphPath = require.resolve("pi-spec-graph/index.ts");
/** `pi-spec-graph`'s bundled skills dir (`skills/spec-graph/SKILL.md`), wired explicitly (see header). */
const specGraphSkillsDir = join(dirname(specGraphPath), "skills");

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
 * A resource loader with `pi-web-access` + `pi-visualize` + `pi-spec-graph` (and its skill) (+ the
 * headless-search policy) and our host-owned `ask_user_question` tool layered onto pi's default discovery.
 */
export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
): Promise<ResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalExtensionPaths: [webAccessPath, visualizePath, specGraphPath],
		additionalSkillPaths: [specGraphSkillsDir],
		extensionFactories: [headlessSearchPolicy, askUserQuestionExtension],
	});
	await loader.reload();
	return loader;
}
