import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	ASK_UNAVAILABLE_TEXT,
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionArgs,
	type AskUserQuestionAsker,
	executableAskCallIds,
	isolateAskUserQuestionBatch,
	outcomeResult,
	previewFileSources,
	textResult,
	validateQuestionnaire,
} from "./core.ts";
import { askWithDialogs } from "./dialogs.ts";
import { createAskUserQuestionSchema } from "./schema.ts";
import { askInTerminal, renderAskCall, renderAskResult } from "./tui.ts";

export interface AskUserQuestionGuidance {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
}

export type AskUserQuestionFileChecker = (path: string, cwd: string) => void | Promise<void>;

export interface AskUserQuestionExtensionOptions {
	ask?: AskUserQuestionAsker;
	announce?: (toolCallId: string) => void;
	guidance?: AskUserQuestionGuidance;
	filePreviews?: boolean;
	checkFile?: AskUserQuestionFileChecker;
}

const FILE_PREVIEW_NOTE =
	"- Set previewFile (+ previewBefore for a before → after diff) to show an existing file as the preview: write HTML mockups in a scratch location outside version control (inline CSS and data: images only) instead of pasting HTML or ASCII art.";

export function defaultDescription(filePreviews = false): string {
	return `Ask the user one or more structured, multiple-choice questions during execution, instead of guessing. Use when:
1. The request is underspecified and you cannot proceed without a concrete decision.
2. You need a user preference, requirement, or a direction/implementation choice.

Calling this tool PAUSES EXECUTION until the user answers: the questions are shown as an interactive questionnaire (one page per question when there are several), and the user's answers arrive as this tool's result. Do not continue working on the blocked task or assume an answer while the tool is pending. The user may instead choose to discuss the questions in chat — then this turn ends and their free-form reply arrives as the next user message. Notes:
- Every question also gets an "Other" option with a free-text field and a way to mark it "discuss first", and the user can always Skip the whole questionnaire (you are told they declined) — do NOT author "Other"-, "None of these"-, "ask me differently"-style or escape options yourself (reserved labels are rejected).
- A question the user marks "discuss first" comes back with an optional reason and text: do not guess its answer; explain it in plain words (what is being decided and why it matters) and ask it again in a later round.
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to one short sentence on why you recommend it over the alternatives (shown under the option).
- Use questions[].preview (markdown) for what the question is about — the design being approved, the text to confirm, the current state. Use options[].preview for concrete alternatives to compare (code, mockups, Mermaid diagrams, configs); single-select only; an option may honestly have none.
${filePreviews ? `${FILE_PREVIEW_NOTE}\n` : ""}- Give each question 2-4 options. A single option is only for confirming an inference: the inferred statement is the question and the option is "Looks right"; corrections arrive through Other, disagreement through "discuss first".
- One call = one round: ask every question you can ask now in a single call — never split independent questions across back-to-back calls. A question that depends on another question's answer waits for a later round; ask follow-up rounds until no decision is left assumed.
- Call ask_user_question as the only tool in the assistant response; other tool calls in that response are discarded and can be re-issued after the answer.
- The user may answer only some questions; unanswered ones are reported as declined.`;
}

export const DEFAULT_DESCRIPTION = defaultDescription();

export const DEFAULT_PROMPT_GUIDELINES: readonly string[] = [
	"Call ask_user_question whenever the request is ambiguous and a concrete decision is needed — one call is one round holding every question answerable now (dependent questions wait for the next round), with 2-4 options each (a single 'Looks right' option only to confirm an inference). The call blocks until its result contains the user's answers.",
	"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
	'Recommend by putting the option first with "(Recommended)" appended and setting its recommendedReason to one short sentence (shown under the option) on why you recommend it over the alternatives; the user can always type a custom answer, mark a question to discuss first, or skip the questionnaire.',
	"Call ask_user_question as the only tool in the assistant response; continue with other tools after the answer.",
];

const askWithBuiltInUi: AskUserQuestionAsker = (request) =>
	request.ctx.mode === "tui" ? askInTerminal(request) : askWithDialogs(request);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function previewFileProblem(
	check: AskUserQuestionFileChecker,
	args: AskUserQuestionArgs,
	cwd: string,
): Promise<string | null> {
	for (const { location, path } of previewFileSources(args)) {
		try {
			await check(path, cwd);
		} catch (error) {
			return `Error: cannot show ${location} (${path}): ${errorMessage(error)}. Write the file first, then ask again.`;
		}
	}
	return null;
}

export function createAskUserQuestionExtension(
	options: AskUserQuestionExtensionOptions = {},
): ExtensionFactory {
	const ask = options.ask ?? askWithBuiltInUi;
	const guidance = options.guidance ?? {};
	const filePreviews = options.filePreviews === true;
	return (pi: ExtensionAPI): void => {
		pi.on("message_end", (event) => {
			const message = isolateAskUserQuestionBatch(event.message);
			if (options.announce) {
				for (const toolCallId of executableAskCallIds(message ?? event.message))
					options.announce(toolCallId);
			}
			return message ? { message } : undefined;
		});
		pi.registerTool({
			name: ASK_USER_QUESTION_TOOL_NAME,
			label: "Ask User Question",
			description: guidance.description ?? defaultDescription(filePreviews),
			...(guidance.promptSnippet ? { promptSnippet: guidance.promptSnippet } : {}),
			promptGuidelines: [...(guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES)],
			parameters: createAskUserQuestionSchema({ filePreviews }),
			executionMode: "sequential",
			exposure: "model-only",
			async execute(toolCallId, params, signal, _onUpdate, ctx) {
				const args: AskUserQuestionArgs = params;
				if (!options.ask && !ctx.hasUI)
					return textResult(ASK_UNAVAILABLE_TEXT, { answers: [], cancelled: true });
				const validation = validateQuestionnaire(args, { filePreviews });
				if (!validation.ok) return textResult(validation.message, { answers: [], cancelled: true });
				if (filePreviews && options.checkFile) {
					const problem = await previewFileProblem(options.checkFile, args, ctx.cwd);
					if (problem) return textResult(problem, { answers: [], cancelled: true });
				}
				const outcome = await ask({ toolCallId, args, signal, ctx });
				return outcomeResult(outcome, args);
			},
			renderCall: renderAskCall,
			renderResult: renderAskResult,
		});
	};
}
