import { defineWebExtension } from "@thinkrail/extension-api/web";
import { AskUserQuestionCard } from "./AskUserQuestionCard";

export default defineWebExtension({
	name: "ask-user-question",
	toolRenderers: {
		ask_user_question: {
			renderer: AskUserQuestionCard,
			options: { chrome: "bare", interactive: true },
		},
	},
});
