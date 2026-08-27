import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AskUserAnswersMessage, AskUserQuestionResult } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

export const OFFER_NEXT_STEPS_TOOL_NAME = "offer_next_steps";

export const OfferNextStepsSchema = Type.Object({
	projectName: Type.String({
		description: "The project's display name, used to phrase the two next-step cards.",
	}),
});

export type OfferNextStepsParams = Static<typeof OfferNextStepsSchema>;

const DESCRIPTION = `Offer the user the two ways to continue right after a brand-new project is created: start a separate isolated workspace for one task, or keep building in the Default workspace. Renders two action cards in the chat and ENDS YOUR TURN — the user's choice arrives as the next message. Call this once, immediately after the "your project is ready" confirmation of a create-from-scratch project. Do not call it anywhere else.`;

const ACK_TEXT =
	"The next-step choice is now shown to the user. This turn ends here; their choice arrives as the next message.";

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

export function createOfferNextStepsTool(): ToolDefinition<typeof OfferNextStepsSchema> {
	return {
		name: OFFER_NEXT_STEPS_TOOL_NAME,
		label: "Offer Next Steps",
		description: DESCRIPTION,
		parameters: OfferNextStepsSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
			if (!ctx.hasUI) {
				return { content: [{ type: "text", text: ERROR_NO_UI }], details: { kind: "ack" } };
			}
			return {
				content: [{ type: "text", text: ACK_TEXT }],
				details: { kind: "ack" },
				terminate: true,
			};
		},
	};
}

export function offerNextStepsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createOfferNextStepsTool());
}

function chosenText(result: AskUserQuestionResult): string {
	if (result.cancelled) return "The user dismissed the next-step choice without picking one.";
	const answer = result.answers[0];
	const choice = answer?.answer?.trim();
	if (!choice) return "The user dismissed the next-step choice without picking one.";
	return `The user chose how to continue: "${choice}". Continue accordingly, in the way this session's setup skill describes; do not start implementation on your own.`;
}

export function buildNextStepsMessage(
	toolCallId: string,
	result: AskUserQuestionResult,
): Pick<AskUserAnswersMessage, "customType" | "content" | "display" | "details"> {
	return {
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: chosenText(result),
		display: true,
		details: { toolCallId, result },
	};
}
