// The `ask_user_question` capability — a HOST-OWNED pi custom tool, registered via an extension factory
// on every session. It lets the agent put structured, typed clarifying questions to the user instead of
// guessing. The tool renders nothing itself: it validates, blocks, and awaits a structured
// `AskUserQuestionResult` pushed back by the browser (`session.answerQuestion`, correlated by the tool
// call id). The chat renders the questionnaire INLINE as a tool card (see
// `apps/web/src/chat/tools/AskUserQuestionCard`): tabs per question, single/multi-select, per-option
// markdown previews, a free-text row, Skip. The design rationale (why host-owned rather than a bundled
// community extension) is recorded in this module's SPEC.md.

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail-pi/contracts";
import { type Static, Type } from "typebox";

// ---- limits (mirrors the rpiv contract so the model behaves the same) ----
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

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

The questions render inline in the chat as an interactive card (tabs when there are several). Notes:
- Every question also gets an "Other" option with a free-text field, and the user can always Skip the whole questionnaire (you are told they declined) — do NOT author "Other"-style, free-text, or escape options yourself (reserved labels are rejected).
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST and append "(Recommended)" to its label.
- Use options[].preview (markdown) for concrete artifacts to compare side-by-side (code, ASCII mockups, configs). Single-select only.
- Group all clarifying questions into ONE call — do not chain calls back-to-back.
- The user may answer only some questions; unanswered ones are reported as declined.`;

const PROMPT_GUIDELINES = [
	`Call ask_user_question whenever the request is ambiguous and a concrete decision is needed — up to ${MAX_QUESTIONS} questions per call, ${MIN_OPTIONS}-${MAX_OPTIONS} options each.`,
	"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
	'Recommend by putting the option first with "(Recommended)" appended; the user can always type a custom answer or skip the questionnaire.',
];

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

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

const DECLINE_MESSAGE = "User declined to answer questions";
const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

/** The tool `execute` return shape (an `AgentToolResult<AskUserQuestionResult>`). */
interface ToolResult {
	content: { type: "text"; text: string }[];
	details: AskUserQuestionResult;
}

function toolResult(text: string, details: AskUserQuestionResult): ToolResult {
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
 * Map an `AskUserQuestionResult` to the LLM-facing tool envelope. Cancelled / no-answers both fall to the
 * single canonical `DECLINE_MESSAGE` so the model sees one "didn't answer" signal regardless of why. A
 * partial submission lists its unanswered questions explicitly as declined — silence would read as "all
 * answered" and send the model guessing on the very questions it asked. Pure.
 */
export function buildQuestionnaireResponse(
	result: AskUserQuestionResult,
	args: AskUserQuestionArgs,
): ToolResult {
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

// ---- the reply bridge: a blocked tool `execute` awaits the browser's answer, keyed by toolCallId ----
interface PendingQuestion {
	sessionId: string;
	finish: (result: AskUserQuestionResult) => void;
}
const pending = new Map<string, PendingQuestion>();

/**
 * Answers that arrived while no tool call was awaiting them. The legitimate producer is the streaming
 * window: the inline card is interactive as soon as the tool call's arguments stream in, but `execute`
 * (which registers the `pending` entry) only runs once the assistant message completes — a fast submit
 * beats the registration and must be held until `awaitAnswer` consumes it. Answers that never get
 * consumed (a second client re-answering a settled call, a submit after abort, junk tool call ids) are
 * bounded: at most `MAX_HELD_PER_SESSION` per session, oldest evicted first, and a session's holds are
 * dropped when it is disposed.
 */
interface EarlyAnswer {
	sessionId: string;
	result: AskUserQuestionResult;
}
const early = new Map<string, EarlyAnswer>();
const MAX_HELD_PER_SESSION = 8;

/**
 * Resolve the blocked `ask_user_question` tool call with the browser's answer, or hold the answer until
 * the tool call registers (see `early`). The WS handler has already vetted that the session is live.
 */
export function answerQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): void {
	const entry = pending.get(toolCallId);
	if (entry) {
		entry.finish(result);
		return;
	}
	early.set(toolCallId, { sessionId, result });
	const mine = [...early.entries()].filter(([, held]) => held.sessionId === sessionId);
	for (let i = 0; i < mine.length - MAX_HELD_PER_SESSION; i++) {
		const oldest = mine[i];
		if (oldest) early.delete(oldest[0]);
	}
}

/** Settle every question awaiting on a session as cancelled — used when the session is disposed. */
export function cancelQuestionsForSession(sessionId: string): void {
	for (const entry of [...pending.values()]) {
		if (entry.sessionId === sessionId) entry.finish({ answers: [], cancelled: true });
	}
	for (const [toolCallId, held] of [...early.entries()]) {
		if (held.sessionId === sessionId) early.delete(toolCallId);
	}
}

/** Await the browser's answer for one tool call; cancels on the agent abort signal so it never hangs. */
function awaitAnswer(
	toolCallId: string,
	sessionId: string,
	signal: AbortSignal | undefined,
): Promise<AskUserQuestionResult> {
	return new Promise((resolve) => {
		const held = early.get(toolCallId);
		if (held) {
			early.delete(toolCallId);
			// A hold whose session doesn't match this execution is bogus (stale or spoofed) — drop, don't deliver.
			if (held.sessionId === sessionId) {
				resolve(held.result);
				return;
			}
		}
		let settled = false;
		const finish = (result: AskUserQuestionResult): void => {
			if (settled) return;
			settled = true;
			pending.delete(toolCallId);
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const onAbort = (): void => finish({ answers: [], cancelled: true });
		pending.set(toolCallId, { sessionId, finish });
		if (signal) {
			if (signal.aborted) return finish({ answers: [], cancelled: true });
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

/** Build the `ask_user_question` tool definition. Stateless: correlation is by the (unique) tool call id. */
export function createAskUserQuestionTool(): ToolDefinition<
	typeof AskUserQuestionSchema,
	AskUserQuestionResult
> {
	return {
		name: "ask_user_question",
		label: "Ask User Question",
		description: DESCRIPTION,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: AskUserQuestionSchema,
		async execute(toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			const args = params as AskUserQuestionArgs;
			if (!ctx.hasUI) return toolResult(ERROR_NO_UI, { answers: [], cancelled: true });

			const validation = validateQuestionnaire(args);
			if (!validation.ok) return toolResult(validation.message, { answers: [], cancelled: true });

			// `ctx.sessionManager.getSessionId()` === the `AgentSession.sessionId` we key everything on
			// (the session's `sessionId` getter delegates to this same manager), so per-session cancellation
			// on dispose lines up exactly with our manager's key.
			const sessionId = ctx.sessionManager.getSessionId();
			const result = await awaitAnswer(toolCallId, sessionId, signal);
			return buildQuestionnaireResponse(result, args);
		},
	};
}

/** Extension factory (mirrors `extensions`' pattern): registers the tool on each session's `pi`. */
export function askUserQuestionExtension(pi: ExtensionAPI): void {
	pi.registerTool(createAskUserQuestionTool());
}
