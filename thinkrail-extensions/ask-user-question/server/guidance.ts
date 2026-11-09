import type { AskUserQuestionGuidance } from "@thinkrail/pi-ask-user-question";

const FILE_PREVIEWS = (scratchDir: string) =>
	`- To show how something would look, write a self-contained HTML mockup under \`${scratchDir}\` (inline CSS and data: images only — scripts, form controls and external resources are stripped) and reference it with previewFile instead of pasting HTML or ASCII art; add previewBefore (a mockup of the current state) for a before → after diff. Any workspace file works too (SVG, image, markdown, code). Write the file before asking.`;

export function thinkrailGuidance(
	filePreviews: boolean,
	scratchDir: string,
): AskUserQuestionGuidance {
	return {
		description: `Ask the user one or more structured, multiple-choice questions during execution, instead of guessing. Use when:
1. The request is underspecified and you cannot proceed without a concrete decision.
2. You need a user preference, requirement, or a direction/implementation choice.

Calling this tool PAUSES EXECUTION until the user answers: the questions render inline in the chat as an interactive card (tabs when there are several), and the user's answers arrive as this tool's result. Do not continue working on the blocked task or assume an answer while the tool is pending. The user answers or skips through the card, or replies in chat instead — then the card is superseded and their free-form reply arrives as the next user message. Notes:
- Every question also gets an "Other" option with a free-text field and a Discuss button the user presses when a question is unclear, not relevant or needs more context; the user can always Skip the whole questionnaire (you are told they declined). Do NOT author "Other"-, "None of these"-, "ask me differently"-style or escape options yourself (reserved labels are rejected).
- A question the user marks for discussion comes back with an optional reason and text instead of an answer: do not guess it — explain the question in plain words (what is being decided and why it matters; reconsider whether it is needed at all when the reason is "not relevant") and ask it again in a later round.
- Give each question 2-4 options. A single option is only for confirming an inference: the inferred statement is the question and the option is "Looks right"; corrections arrive through Other, disagreement through Discuss.
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to one short sentence on why you recommend it over the alternatives (shown inline under the option).
- Use questions[].preview (markdown) for what the question is about — the design being approved, the text to confirm, the current state; it is shown above the options. Use options[].preview for the alternatives you compare (code, mockups, Mermaid diagrams, configs); single-select only; an option may honestly have none.
${filePreviews ? `${FILE_PREVIEWS(scratchDir)}\n` : ""}- One call = one round: ask every question you can ask now in a single call — never split independent questions across back-to-back calls. A question that depends on another question's answer waits for a later round; ask follow-up rounds until no decision is left assumed.
- Call ask_user_question as the only tool in the assistant response; other tool calls in that response are discarded and can be re-issued after the answer.
- The user may answer only some questions; unanswered ones are reported as declined.`,
		promptGuidelines: [
			"Call ask_user_question whenever the request is ambiguous and a concrete decision is needed — one call is one round holding every question answerable now (dependent questions wait for the next round), with 2-4 options each (a single 'Looks right' option only to confirm an inference). The call blocks until its result contains the user's answers.",
			"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
			'Recommend by putting the option first with "(Recommended)" appended and setting its recommendedReason to one short sentence (shown inline under the option) on why you recommend it over the alternatives; the user can always type a custom answer, press Discuss on a question, or skip the questionnaire.',
			"Call ask_user_question as the only tool in the assistant response; continue with other tools after the answer.",
		],
	};
}
