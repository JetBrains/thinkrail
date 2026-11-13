import { createNextStepsExtension } from "./src/extension.ts";

export type { NextStepsArgs, NextStepsDetails } from "./src/core.ts";
export {
	isNextStepsDetails,
	MAX_SHORTCUTS,
	NEXT_STEPS_TOOL_NAME,
	normalizeSuggestions,
	suggestionsAtLeaf,
} from "./src/core.ts";
export {
	createNextStepsExtension,
	createSuggestNextStepsTool,
	DEFAULT_DESCRIPTION,
	DEFAULT_PROMPT_GUIDELINES,
	DEFAULT_PROMPT_SNIPPET,
	type NextStepsParams,
	NextStepsSchema,
} from "./src/extension.ts";

export default createNextStepsExtension();
