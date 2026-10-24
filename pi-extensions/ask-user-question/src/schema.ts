import { type Static, Type } from "typebox";
import {
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_RECOMMENDED_REASON_LENGTH,
	MIN_OPTIONS,
} from "./core.ts";

const OptionSchema = Type.Object({
	label: Type.String({
		description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS. The concise (1-5 word) text the user sees and selects.`,
	}),
	description: Type.String({
		description: "What this option means or what happens if chosen — the trade-off/implication.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional markdown preview shown beside this option (mockups, code snippets, diagrams, configs). Single-select only.",
		}),
	),
	recommendedReason: Type.Optional(
		Type.String({
			description: `MAX ${MAX_RECOMMENDED_REASON_LENGTH} CHARACTERS. Why you recommend this option — one short sentence, rendered as a 'Why:' line under the option. Set only on the option whose label carries '(Recommended)'.`,
		}),
	),
});

const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question, ending with a question mark. E.g. "Which library should we use for date formatting?"',
	}),
	header: Type.String({
		description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS. Very short chip/tag next to the question, e.g. "Auth method".`,
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"2-4 distinct choices. An 'Other' free-text option and a Skip escape are added automatically — do NOT author 'Other'-style options.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				'Allow multiple selections. The "Other" free-text option stays available; its text arrives as an additional answer alongside the checked options.',
		}),
	),
});

export const AskUserQuestionSchema = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		description: "One or more questions to ask.",
	}),
});

export type AskUserQuestionParams = Static<typeof AskUserQuestionSchema>;
