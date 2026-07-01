// Bundles the `pi-web-access` (web_search + fetch_content) and `pi-visualize` (the `visualize` tool)
// extensions into a session's resource loader, so the tools are present out of the box without a separate
// install. Loaded by pi's own loader via explicit paths (`additionalExtensionPaths`) rather than
// value-imports, because these extensions ship raw `.ts` with no `exports` — pi's loader jiti-loads TS,
// keeping their source out of our typecheck.

import { createRequire } from "node:module";
import {
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	type ResourceLoader,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
/** The installed `pi-web-access` extension entry (raw `.ts`; pi's loader handles it). */
const webAccessPath = require.resolve("pi-web-access/index.ts");
/** Our `pi-visualize` extension entry (the `visualize` tool; raw `.ts`, loaded by path like pi-web-access). */
const visualizePath = require.resolve("pi-visualize/index.ts");

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

/** A resource loader with `pi-web-access` (+ the headless-search policy) layered onto pi's default discovery. */
export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
): Promise<ResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalExtensionPaths: [webAccessPath, visualizePath],
		extensionFactories: [headlessSearchPolicy],
	});
	await loader.reload();
	return loader;
}
