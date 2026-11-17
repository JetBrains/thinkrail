import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createNextStepsExtension, DEFAULT_PROMPT_GUIDELINES } from "@thinkrail/pi-next-steps";

export const QUESTIONS_GO_TO_ASK =
	'A chip may answer only a simple yes/no question about a step you propose ("Shall I open a PR?" → "Yes, open it"). A decision you need from the user, or a choice between options, is not a chip: ask it with the ask_user_question tool when it is available, instead of ending your final message with that question.';

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
