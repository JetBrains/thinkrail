import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	fallbackText,
	MAX_ITEMS,
	type NextStepsDetails,
	NextStepsSchema,
	normalizeItems,
	presentOffer,
	presentOfferDetached,
	TOOL_NAME,
} from "./src/index.ts";

const COMMAND_NAME = "next-steps";

const DESCRIPTION =
	`Offer the user up to ${MAX_ITEMS} optional ways to continue. Each item is a short action label plus the ` +
	"complete message sent verbatim as the user's next turn if they pick that item. If the user explicitly " +
	"asks for follow-up actions, ways to continue after the answer, or what to do next, and concrete options " +
	`exist, you MUST use ${TOOL_NAME} for those options instead of listing them in prose. First complete any ` +
	"substantive answer, then call this as the very last action of the turn. Otherwise call it only when " +
	"concrete continuations add value — when there are none, omit the call entirely. This is not a way to " +
	"ask a question: if you need information before you can proceed, use ask_user_question instead. The " +
	"call ends the turn — write no further assistant response after it.";

const PROMPT_SNIPPET = `When the user explicitly asks for follow-up actions or ways to continue, you MUST use ${TOOL_NAME} instead of a prose list; otherwise offer up to ${MAX_ITEMS} optional next steps only when useful. Call it as the turn's final action, never to ask for information you need.`;

const PROMPT_GUIDELINES = [
	`When the user explicitly asks for follow-up actions, ways to continue after the answer, or what to do next, and concrete options exist, you MUST call ${TOOL_NAME} for those options instead of listing or duplicating them in prose.`,
	`Call ${TOOL_NAME} only as the final action of a turn, after a complete answer, and emit no further assistant response after it.`,
	`Omit ${TOOL_NAME} entirely on ordinary turns when no concrete optional continuation adds value — zero suggestions means no call at all.`,
	`Never use ${TOOL_NAME} in place of ask_user_question: information you need to proceed is a question, optional ways to continue are next steps.`,
	`Each ${TOOL_NAME} prompt is the whole message that will be sent, self-contained enough to read without its label.`,
];

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Next steps",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: NextStepsSchema,
		async execute(_toolCallId, params) {
			const items = normalizeItems(params.items);
			return {
				content: [{ type: "text", text: fallbackText(items) }],
				details: { items } satisfies NextStepsDetails,
				terminate: true,
			};
		},
	});

	pi.on("agent_settled", (_event, ctx) => {
		presentOfferDetached(pi, ctx);
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Reopen the agent's current next-step suggestions",
		handler: async (_args, ctx) => {
			const outcome = await presentOffer(pi, ctx);
			if (outcome === "unsupported") {
				ctx.ui.notify(`/${COMMAND_NAME} needs pi's interactive mode.`, "warning");
			} else if (outcome === "none") {
				ctx.ui.notify("No next steps on offer right now.", "info");
			}
		},
	});
};

export default factory;
