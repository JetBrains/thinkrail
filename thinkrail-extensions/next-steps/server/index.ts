import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createNextStepsExtension, DEFAULT_PROMPT_GUIDELINES } from "@thinkrail/pi-next-steps";

export const QUESTIONS_GO_TO_ASK =
	"When the user must choose between options or make a decision before you can go on, ask it with the ask_user_question tool when it is available rather than as a question answered by chips; short chip answers suit a simple yes/no about a step you propose.";

export default defineServerExtension({
	name: "next-steps",
	title: "Next-step suggestions",
	description:
		"Lets the agent offer one-click next messages above the composer when it finishes a turn.",
	extensions: [
		createNextStepsExtension({
			guidance: { promptGuidelines: [...DEFAULT_PROMPT_GUIDELINES, QUESTIONS_GO_TO_ASK] },
		}),
	],
});
