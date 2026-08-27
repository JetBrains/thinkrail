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
	"When the user explicitly asks you to suggest follow-up actions, what to do next, or ways to explore " +
	`or continue, first write any requested answer and then you MUST call ${TOOL_NAME} with those ` +
	"suggestions as the final action of the SAME assistant response. Do not stop after the answer text, and " +
	`do not list the suggestions in prose. On ordinary turns, use this only when up to ${MAX_ITEMS} concrete ` +
	"optional continuations add value; when there are none, omit it. Each item is a short action label plus " +
	"the complete message sent verbatim as the user's next turn if they pick it.";

const PROMPT_SNIPPET = `REQUIRED: if the user asks you to suggest follow-up actions, what to do next, or ways to explore or continue, use ${TOOL_NAME} instead of prose suggestions. When an answer is also requested, output the answer and then this tool call in the SAME assistant response; never stop between them. Otherwise offer up to ${MAX_ITEMS} optional next steps only when useful.`;

const PROMPT_GUIDELINES = [
	`When the user explicitly asks you to suggest follow-up actions, ways to explore or continue after the answer, or what to do next, and concrete options exist, you MUST call ${TOOL_NAME} for those options instead of listing or duplicating them in prose.`,
	`Required response shape: after a complete substantive answer, include the ${TOOL_NAME} call as the final action of the SAME assistant response; never stop after the answer text, and emit nothing after the tool call.`,
	`Example: "Explain mutexes, then suggest two ways to explore further" requires explanation text followed by an ${TOOL_NAME} call with two items.`,
	`Omit ${TOOL_NAME} entirely on ordinary turns when no concrete optional continuation adds value — zero suggestions means no call at all.`,
	`Never use ${TOOL_NAME} in place of ask_user_question: information you need to proceed is a question, optional ways to continue are next steps.`,
	`Each ${TOOL_NAME} prompt is the whole message that will be sent, self-contained enough to read without its label.`,
];

const FOLLOW_UP_REMINDER =
	`Before ending this turn, re-check the user's request: if they explicitly asked for follow-up actions ` +
	`or ways to explore or continue, you MUST include an ${TOOL_NAME} call after any answer instead of ` +
	"stopping or listing suggestions in prose; otherwise do not force a call.";

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

	pi.on("context", (event) => {
		const last = event.messages.at(-1);
		if (last?.role !== "toolResult" || last.toolName === TOOL_NAME) return;
		return {
			messages: [
				...event.messages,
				{
					role: "custom",
					customType: "offer-next-steps-reminder",
					content: FOLLOW_UP_REMINDER,
					display: false,
					timestamp: Date.now(),
				},
			],
		};
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
