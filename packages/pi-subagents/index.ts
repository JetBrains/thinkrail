import { createSubagentsExtension } from "./src/extension";

export { BUILTIN_AGENTS } from "./src/builtins";
export {
	type AgentDefinition,
	type DiscoverOptions,
	discoverAgentDefinitions,
	parseAgentDefinition,
} from "./src/definitions";
export {
	type CompletionDelivery,
	createSubagents,
	createSubagentsExtension,
	SUBAGENT_COMPLETION_MESSAGE,
	type SubagentCompletionDetails,
	type Subagents,
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
