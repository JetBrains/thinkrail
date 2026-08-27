import { type Static, Type } from "typebox";

export const TOOL_NAME = "offer_next_steps";

export const MAX_ITEMS = 3;
export const MAX_LABEL_LENGTH = 60;
export const MAX_PROMPT_LENGTH = 500;

const NextStepItemSchema = Type.Object({
	label: Type.String({
		description: `Button-length action label for the chooser, at most ${MAX_LABEL_LENGTH} characters. Imperative and specific ("Run the e2e suite"), never a bare "Continue".`,
	}),
	prompt: Type.String({
		description: `The complete message sent verbatim as the user's next turn if this item is chosen, at most ${MAX_PROMPT_LENGTH} characters. Self-contained: it is read without the label.`,
	}),
});

export const NextStepsSchema = Type.Object({
	items: Type.Array(NextStepItemSchema, {
		minItems: 1,
		maxItems: MAX_ITEMS,
		description: `One to ${MAX_ITEMS} distinct continuations, most useful first. Labels and prompts must not repeat.`,
	}),
});

export type NextStepsParams = Static<typeof NextStepsSchema>;
export type NextStepItem = Static<typeof NextStepItemSchema>;
