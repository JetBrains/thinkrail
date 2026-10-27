import type { AskUserQuestionGuidance } from "@thinkrail/pi-ask-user-question";
import { MAX_OPTIONS, MIN_OPTIONS } from "@thinkrail/pi-ask-user-question/core";

export const THINKRAIL_GUIDANCE: AskUserQuestionGuidance = {
	description: `Ask the user one or more structured, multiple-choice questions during execution, instead of guessing. Use when:
1. The request is underspecified and you cannot proceed without a concrete decision.
2. You need a user preference, requirement, or a direction/implementation choice.

Calling this tool PAUSES EXECUTION until the user answers: the questions render inline in the chat as an interactive card (tabs when there are several), and the user's answers arrive as this tool's result. Do not continue working on the blocked task or assume an answer while the tool is pending. The user answers or skips through the card, or replies in chat instead — then the card is superseded and their free-form reply arrives as the next user message. Notes:
- Every question also gets an "Other" option with a free-text field, and the user can always Skip the whole questionnaire (you are told they declined) — do NOT author "Other"-style, free-text, or escape options yourself (reserved labels are rejected).
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to one short sentence on why you recommend it over the alternatives (shown inline under the option).
- Use options[].preview (markdown) for concrete artifacts to compare side-by-side (code, ASCII mockups, configs). Single-select only.
- One call = one round: ask every question you can ask now in a single call — never split independent questions across back-to-back calls. A question that depends on another question's answer waits for a later round; ask follow-up rounds until no decision is left assumed.
- Call ask_user_question as the only tool in the assistant response; other tool calls in that response are discarded and can be re-issued after the answer.
- The user may answer only some questions; unanswered ones are reported as declined.`,
	promptGuidelines: [
		`Call ask_user_question whenever the request is ambiguous and a concrete decision is needed — one call is one round holding every question answerable now (dependent questions wait for the next round), with ${MIN_OPTIONS}-${MAX_OPTIONS} options each. The call blocks until its result contains the user's answers.`,
		"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
		'Recommend by putting the option first with "(Recommended)" appended and setting its recommendedReason to one short sentence (shown inline under the option) on why you recommend it over the alternatives; the user can always type a custom answer or skip the questionnaire.',
		"Call ask_user_question as the only tool in the assistant response; continue with other tools after the answer.",
	],
};
