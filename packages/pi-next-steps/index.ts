import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { presentOffer, presentOfferDetached } from "./src/native.ts";
import { fallbackText, type NextStepsDetails, normalizeItems } from "./src/normalize.ts";
import { MAX_ITEMS, NextStepsSchema, TOOL_NAME } from "./src/schema.ts";

const COMMAND_NAME = "next-steps";

const DESCRIPTION =
	`Offer the user up to ${MAX_ITEMS} optional ways to continue. Each item is a short action label plus the ` +
	"complete message sent verbatim as the user's next turn if they pick that item. Call this only as the " +
	"very last action of a turn, after your complete answer, and only when there are concrete continuations " +
	"worth offering — when there are none, omit the call entirely. This is not a way to ask a question: if " +
	"you need information before you can proceed, use ask_user_question instead. The call ends the turn — " +
	"write no further assistant response after it.";

const PROMPT_SNIPPET = `Offer up to ${MAX_ITEMS} optional next steps as a turn's final action — never to ask for information you need.`;

const PROMPT_GUIDELINES = [
	`Call ${TOOL_NAME} only as the final action of a turn, after a complete answer, and emit no further assistant response after it.`,
	`Omit ${TOOL_NAME} entirely when no concrete optional continuation adds value — zero suggestions means no call at all.`,
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
