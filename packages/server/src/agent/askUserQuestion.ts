// The `ask_user_question` capability — a HOST-OWNED pi custom tool, registered via an extension factory
// on every session. It lets the agent put structured, typed clarifying questions to the user instead of
// guessing. Designed **ack + terminate** so a pending questionnaire survives host restarts:
//
//   - `execute` renders nothing and WAITS FOR NOTHING: it validates, then immediately returns an ack
//     ("questions are shown; answers arrive as the next user message") with `terminate: true`, ending the
//     turn with no extra LLM call. The transcript is complete and provider-valid the moment the ack lands,
//     and the session is genuinely idle while the user thinks — for seconds or for weeks, across any
//     number of restarts.
//   - The browser renders the questionnaire INLINE from the tool call's args (see
//     `apps/web/src/chat/tools/AskUserQuestionCard`); the reply arrives over `session.answerQuestion` and
//     is delivered by the session manager as an `ask-user-answers` CUSTOM MESSAGE (correlated by tool
//     call id in its `details`) that starts the next turn — or steers the current one. Answering live and
//     answering after a restart are the same code path.
//   - A free-form user message sent instead of an answer SUPERSEDES the questionnaire (the ack told the
//     model answers arrive as the next user message — whatever the user typed is that reply); the pure
//     `assessAnswerability` below is what makes a late answer to a superseded/answered call fail loud.
//
// The earlier blocking design (execute parks on an in-memory promise until the browser replies) is gone:
// a host restart destroyed the pending promise, left a dangling `toolCall` in the transcript (providers
// reject unpaired tool_use — the chat bricked), and quietly swallowed post-restart answers. The design
// rationale — including why this is host-owned rather than the community rpiv extension — is recorded in
// this module's SPEC.md.

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AskUserAnswersDetails,
	AskUserQuestionAckDetails,
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

// ---- limits (mirrors the rpiv contract so the model behaves the same) ----
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const MAX_RECOMMENDED_REASON_LENGTH = 160;

/**
 * Labels reserved for affordances the card provides itself (the free-text row, the Skip escape, the
 * multi-question Next button) — authoring one as an option is rejected. Kept a superset of the current UI
 * labels so renamed rows never silently unreserve.
 */
export const RESERVED_LABELS = ["Other", "Type something.", "Chat about this", "Next →"] as const;

// ---- TypeBox parameter schema (drives what the model may send) ----
const OptionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
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
			maxLength: MAX_RECOMMENDED_REASON_LENGTH,
			description: `MAX ${MAX_RECOMMENDED_REASON_LENGTH} CHARACTERS. Why you recommend this option — one short sentence, rendered inline as a 'Why:' line under the option. Set only on the option whose label carries '(Recommended)'.`,
		}),
	),
});

const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question, ending with a question mark. E.g. "Which library should we use for date formatting?"',
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
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
		maxItems: MAX_QUESTIONS,
		description: `The questions to ask (1-${MAX_QUESTIONS}).`,
	}),
});

export type AskUserQuestionParams = Static<typeof AskUserQuestionSchema>;

const DESCRIPTION = `Ask the user one or more structured, multiple-choice questions during execution, instead of guessing. Use when:
1. The request is underspecified and you cannot proceed without a concrete decision.
2. You need a user preference, requirement, or a direction/implementation choice.

Calling this tool ENDS YOUR TURN: the questions render inline in the chat as an interactive card (tabs when there are several), and the user's answers arrive as the NEXT USER MESSAGE (a structured "User has answered your questions:" message). Do not continue working on the blocked task after calling it, and do not assume an answer until that message arrives. If the user replies with a free-form message instead of using the card, treat that message as their reply and re-ask only what is still genuinely undecided. Notes:
- Every question also gets an "Other" option with a free-text field, and the user can always Skip the whole questionnaire (you are told they declined) — do NOT author "Other"-style, free-text, or escape options yourself (reserved labels are rejected).
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to one short sentence on why you recommend it over the alternatives (shown inline under the option).
- Use options[].preview (markdown) for concrete artifacts to compare side-by-side (code, ASCII mockups, configs). Single-select only.
- Group all clarifying questions into ONE call — do not chain calls back-to-back.
- The user may answer only some questions; unanswered ones are reported as declined.`;

const PROMPT_GUIDELINES = [
	`Call ask_user_question whenever the request is ambiguous and a concrete decision is needed — up to ${MAX_QUESTIONS} questions per call, ${MIN_OPTIONS}-${MAX_OPTIONS} options each. The call ends your turn; the answers arrive as the next user message.`,
	"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
	'Recommend by putting the option first with "(Recommended)" appended and setting its recommendedReason to one short sentence (shown inline under the option) on why you recommend it over the alternatives; the user can always type a custom answer or skip the questionnaire.',
];

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

/**
 * The ack the model receives the instant the questionnaire is on screen. Paired with `terminate: true`,
 * so the turn ends right here — no "I'll wait" filler completion, no blocked tool.
 */
export const ASK_ACK_TEXT =
	"The questions are now shown to the user. This turn ends here; the user's answers (or their own free-form reply) will arrive as the next user message. Do not assume an answer until it arrives.";

export interface ValidationResult {
	ok: boolean;
	message: string;
}

/**
 * Pure runtime validator for the questionnaire args (everything except the `no_ui` guard, which depends
 * on `ctx.hasUI` and stays at the call site). `reserved_label` short-circuits before duplicate checks.
 */
export function validateQuestionnaire(args: AskUserQuestionArgs): ValidationResult {
	const questions = args.questions ?? [];
	if (questions.length === 0)
		return { ok: false, message: "Error: At least one question is required" };
	if (questions.length > MAX_QUESTIONS)
		return { ok: false, message: `Error: At most ${MAX_QUESTIONS} questions are allowed per call` };

	const seenQuestions = new Set<string>();
	const reserved = new Set<string>(RESERVED_LABELS);
	for (const q of questions) {
		if (seenQuestions.has(q.question))
			return { ok: false, message: "Error: Question text must be unique within a call" };
		seenQuestions.add(q.question);

		if (!q.options || q.options.length < MIN_OPTIONS)
			return {
				ok: false,
				message: `Error: Each question requires at least ${MIN_OPTIONS} options`,
			};

		const seenLabels = new Set<string>();
		for (const o of q.options) {
			if (reserved.has(o.label))
				return {
					ok: false,
					message: `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`,
				};
			if (seenLabels.has(o.label))
				return { ok: false, message: "Error: Option labels must be unique within a question" };
			seenLabels.add(o.label);
		}
	}
	return { ok: true, message: "" };
}

/** The canonical "didn't answer" signal — also composed into the restart-repair decline (sessionRepair). */
export const DECLINE_MESSAGE = "User declined to answer questions";
const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

/** The tool `execute` return shape (an `AgentToolResult<…>`). */
interface ToolResult<D> {
	content: { type: "text"; text: string }[];
	details: D;
	/** pi's early-termination hint: every result in the batch setting it ends the turn after the batch. */
	terminate?: boolean;
}

function toolResult(
	text: string,
	details: AskUserQuestionResult,
): ToolResult<AskUserQuestionResult> {
	return { content: [{ type: "text", text }], details };
}

/**
 * Human-readable one-liner for a single answer (pinned shape:
 * `"Q"="A". user's own answer: "…". selected preview: … . user notes: …`). A multi answer's `answer`
 * is the free text typed in addition to the checked options — marked as the user's own words so the
 * model can tell it apart from authored option labels.
 */
function answerSegment(a: AskUserQuestionAnswer): string {
	const scalar = a.kind === "multi" ? (a.selected ?? []).join(", ") : (a.answer ?? "(no answer)");
	const parts = [`"${a.question}"="${scalar}"`];
	if (a.kind === "multi" && a.answer) parts.push(`user's own answer: "${a.answer}"`);
	if (a.preview) parts.push(`selected preview: ${a.preview}`);
	if (a.notes) parts.push(`user notes: ${a.notes}`);
	return `${parts.join(". ")}.`;
}

/**
 * Map an `AskUserQuestionResult` to the LLM-facing envelope. Cancelled / no-answers both fall to the
 * single canonical `DECLINE_MESSAGE` so the model sees one "didn't answer" signal regardless of why. A
 * partial submission lists its unanswered questions explicitly as declined — silence would read as "all
 * answered" and send the model guessing on the very questions it asked. Pure. (Under ack + terminate the
 * envelope travels as the `ask-user-answers` custom message's text, not as a tool result — same wording,
 * so the model reads answers exactly as it did under the blocking design.)
 */
export function buildQuestionnaireResponse(
	result: AskUserQuestionResult,
	args: AskUserQuestionArgs,
): ToolResult<AskUserQuestionResult> {
	if (result.cancelled)
		return toolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	const segments: string[] = [];
	const declined: string[] = [];
	for (let i = 0; i < args.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(answerSegment(a));
		else declined.push(`"${args.questions[i]?.question}"`);
	}
	if (segments.length === 0)
		return toolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	const declinedNote =
		declined.length > 0 ? ` The user declined to answer: ${declined.join(", ")}.` : "";
	return toolResult(
		`${ENVELOPE_PREFIX} ${segments.join(" ")}${declinedNote} ${ENVELOPE_SUFFIX}`,
		result,
	);
}

// ---- the answer path: pure transcript assessment + the custom-message payload ----

/** Minimal structural views of the transcript messages the assessors walk (subset of `AgentMessage`). */
interface ToolCallView {
	type: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}
interface MessageView {
	role?: string;
	content?: unknown;
	customType?: string;
	details?: unknown;
	toolCallId?: string;
}

function toolCallsOf(message: MessageView): ToolCallView[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return (message.content as ToolCallView[]).filter((b) => b?.type === "toolCall");
}

function isAnswersFor(message: MessageView, toolCallId: string): boolean {
	return (
		message.role === "custom" &&
		message.customType === ASK_USER_ANSWERS_CUSTOM_TYPE &&
		!!message.details &&
		(message.details as AskUserAnswersDetails).toolCallId === toolCallId
	);
}

/** Whether a tool result's `details` is the ack marker (vs a legacy blocking-era final result). */
export function isAckDetails(details: unknown): details is AskUserQuestionAckDetails {
	return !!details && (details as AskUserQuestionAckDetails).kind === "ack";
}

export type Answerability =
	| { ok: true; args: AskUserQuestionArgs }
	| { ok: false; reason: "unknown_call" | "already_answered" | "not_awaiting" | "superseded" };

/**
 * Can this `ask_user_question` call still take an answer? Pure, derived ENTIRELY from the transcript —
 * the same verdict falls out live, after a reconnect, or after a host restart:
 * - `unknown_call` — no such ask tool call in the transcript;
 * - `already_answered` — an `ask-user-answers` message for it already exists (double-submit, second client);
 * - `not_awaiting` — its tool result is a final result, not the ack (legacy blocking-era transcript, a
 *   validation error, or a restart-repaired decline — all already resolved);
 * - `superseded` — the user sent a free-form message after the questionnaire instead of answering it; the
 *   conversation has moved on, and the model was told to treat that message as the reply.
 */
export function assessAnswerability(
	messages: readonly AgentMessage[],
	toolCallId: string,
): Answerability {
	const views = messages as readonly MessageView[];
	let callIndex = -1;
	let args: AskUserQuestionArgs | null = null;
	for (let i = 0; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		for (const block of toolCallsOf(view)) {
			if (block.id === toolCallId && block.name === ASK_USER_QUESTION_TOOL_NAME) {
				callIndex = i;
				args = (block.arguments ?? { questions: [] }) as AskUserQuestionArgs;
			}
		}
	}
	if (callIndex < 0 || !args) return { ok: false, reason: "unknown_call" };

	for (let i = callIndex + 1; i < views.length; i++) {
		const view = views[i];
		if (!view) continue;
		if (isAnswersFor(view, toolCallId)) return { ok: false, reason: "already_answered" };
		if (view.role === "toolResult" && view.toolCallId === toolCallId && !isAckDetails(view.details))
			return { ok: false, reason: "not_awaiting" };
		if (view.role === "user") return { ok: false, reason: "superseded" };
	}
	return { ok: true, args };
}

/** The message a rejected answer surfaces to the client, per verdict. */
export const ANSWERABILITY_ERRORS: Record<Extract<Answerability, { ok: false }>["reason"], string> =
	{
		unknown_call: "Unknown ask_user_question tool call",
		already_answered: "This questionnaire was already answered",
		not_awaiting: "This questionnaire is not awaiting an answer",
		superseded: "This questionnaire was superseded by a later message",
	};

/**
 * The `ask-user-answers` custom message for one reply — the payload `AgentSession.sendCustomMessage`
 * delivers (starting a turn when idle, steering when streaming). `content` is the same LLM envelope the
 * blocking tool used to return; `details` carries the structured result the questionnaire card renders,
 * correlated by tool call id. `display: true` so a pi TUI opening the same transcript shows the reply.
 */
export function buildAnswersMessage(
	toolCallId: string,
	args: AskUserQuestionArgs,
	result: AskUserQuestionResult,
): {
	customType: string;
	content: string;
	display: boolean;
	details: AskUserAnswersDetails;
} {
	const envelope = buildQuestionnaireResponse(result, args);
	return {
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: envelope.content.map((c) => c.text).join(""),
		display: true,
		details: { toolCallId, result },
	};
}

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

/**
 * Build the `ask_user_question` tool definition. Stateless and instantaneous: validate, then ack +
 * `terminate` (the turn ends at the tool batch, with no further LLM call). Only the no-UI guard and
 * validation failures return a plain (non-terminating) result — the model should correct and continue.
 */
export function createAskUserQuestionTool(): ToolDefinition<
	typeof AskUserQuestionSchema,
	AskUserQuestionAckDetails | AskUserQuestionResult
> {
	return {
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User Question",
		description: DESCRIPTION,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: AskUserQuestionSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const args = params as AskUserQuestionArgs;
			if (!ctx.hasUI) return toolResult(ERROR_NO_UI, { answers: [], cancelled: true });

			const validation = validateQuestionnaire(args);
			if (!validation.ok) return toolResult(validation.message, { answers: [], cancelled: true });

			return {
				content: [{ type: "text", text: ASK_ACK_TEXT }],
				details: { kind: "ack" } satisfies AskUserQuestionAckDetails,
				terminate: true,
			};
		},
	};
}

/** Extension factory (mirrors `extensions`' pattern): registers the tool on each session's `pi`. */
export function askUserQuestionExtension(pi: ExtensionAPI): void {
	pi.registerTool(createAskUserQuestionTool());
}
