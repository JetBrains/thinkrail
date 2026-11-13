import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineServerExtension } from "@thinkrail/extension-api/server";
import { type Static, Type } from "typebox";

const SUGGEST_NEXT_STEPS_TOOL_NAME = "suggest_next_steps";

const SuggestNextStepsSchema = Type.Object({
	suggestions: Type.Array(
		Type.String({
			description:
				"One message the user could send next, written in their voice and language, short enough for a button (about 2–8 words).",
		}),
		{ minItems: 1, description: "The most useful next messages, best first. Usually about 3." },
	),
});

type SuggestNextStepsParams = Static<typeof SuggestNextStepsSchema>;

interface SuggestNextStepsDetails {
	suggestions: string[];
}

const DESCRIPTION =
	"Offer the user one-click next messages after you finish a turn. They appear as buttons above the composer; clicking one sends it as the user's next message. Ends your turn.";

const PROMPT_SNIPPET = "Offer one-click next messages as the last action of a finished turn";

const PROMPT_GUIDELINES = [
	"When a turn's work is finished, write your final message first, then call suggest_next_steps alone as the very last action of the turn: it ends the turn, so never call it before you are done or alongside other tools.",
	'Each suggestion is a message the user would plausibly send next, in their voice and language — e.g. "Run the e2e suite", "Also handle the empty state", "Open a PR". When your final message ends with a question, offer short answers to it, e.g. "Yes, go ahead" or "Use option B".',
	"Offer only genuinely useful next steps, best first, usually about three. Skip the call entirely when nothing meaningful applies, while you are waiting on ask_user_question, or when the turn ended in an error.",
];

function normalizeSuggestions(raw: readonly string[]): string[] {
	const seen = new Set<string>();
	const suggestions: string[] = [];
	for (const item of raw) {
		const text = item.replace(/\s+/g, " ").trim();
		const key = text.toLowerCase();
		if (!text || seen.has(key)) continue;
		seen.add(key);
		suggestions.push(text);
	}
	return suggestions;
}

function createSuggestNextStepsTool(): ToolDefinition<
	typeof SuggestNextStepsSchema,
	SuggestNextStepsDetails
> {
	return {
		name: SUGGEST_NEXT_STEPS_TOOL_NAME,
		label: "Suggest Next Steps",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: SuggestNextStepsSchema,
		async execute(_toolCallId, params: SuggestNextStepsParams) {
			const suggestions = normalizeSuggestions(params.suggestions);
			const text =
				suggestions.length > 0
					? "Shown to the user as one-click next messages. Your turn is over."
					: "No usable suggestions were given. Your turn is over.";
			return { content: [{ type: "text", text }], details: { suggestions }, terminate: true };
		},
	};
}

export default defineServerExtension({
	name: "next-steps",
	title: "Next-step suggestions",
	description:
		"Lets the agent offer one-click next messages above the composer when it finishes a turn.",
	extensions: [(pi: ExtensionAPI) => pi.registerTool(createSuggestNextStepsTool())],
});
