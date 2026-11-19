import { defineWebExtension } from "@thinkrail/extension-api/web";
import { SuggestionsList } from "./SuggestionsList";
import { readSuggestions } from "./suggestions";

export default defineWebExtension({
	name: "next-steps",
	toolRenderers: {
		suggest_next_steps: {
			renderer: SuggestionsList,
			options: {
				summary: ({ args, result }, translate) =>
					translate("nextSteps.summary", { count: readSuggestions(args, result).length }),
				composerSuggestions: readSuggestions,
			},
		},
	},
});
