import { defineWebExtension } from "@thinkrail/extension-api/web";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { CARD_COMMANDS, CARD_SHORTCUTS } from "./keys";

export default defineWebExtension({
	name: "ask-user-question",
	title: "tools.ask.extensionTitle",
	toolRenderers: {
		ask_user_question: {
			renderer: AskUserQuestionCard,
			options: { chrome: "bare", interactive: true, dock: true },
		},
	},
	commands: CARD_COMMANDS,
	shortcuts: CARD_SHORTCUTS,
});
