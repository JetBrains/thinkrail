import { defineWebExtension } from "@thinkrail/extension-api/web";
import { SuggestionsList } from "./SuggestionsList";
import { isRefused, readSuggestions } from "./suggestions";

export default defineWebExtension({
	name: "next-steps",
	toolRenderers: {
		suggest_next_steps: {
			renderer: SuggestionsList,
			options: {
				summary: ({ args, result }, translate) =>
					isRefused(result)
						? translate("nextSteps.refused.summary")
						: translate("nextSteps.summary", { count: readSuggestions(args, result).length }),
				composerSuggestions: readSuggestions,
			},
		},
	},
});
