// The pi-subagents barrel — the package's ONLY public surface. The default export is the zero-config
// pure-pi extension entry (loaded via the `pi` manifest); embedders construct
// `createSubagentsExtension({ service, ... })` with their bound delegation service instead.

import { createSubagentsExtension } from "./src/extension";

export { BUILTIN_AGENTS } from "./src/builtins";
export {
	type AgentDefinition,
	type DiscoverOptions,
	discoverAgentDefinitions,
	parseAgentDefinition,
} from "./src/definitions";
export {
	createSubagentsExtension,
	SUBAGENT_COMPLETION_MESSAGE,
	type SubagentsExtensionOptions,
} from "./src/extension";
export {
	buildChildSystemPrompt,
	RECURSION_GUARD_TOOLS,
	resolveModelRef,
	type SpawnMapping,
	toSpawnMapping,
} from "./src/mapping";

export default createSubagentsExtension();
