import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const MAX_RECOMMENDED_REASON_LENGTH = 160;

export const OTHER_LABEL = "Other";
export const CHAT_LABEL = "Chat about this";
export const RESERVED_LABELS = [OTHER_LABEL, "Type something.", CHAT_LABEL, "Next →"] as const;

export interface AskUserQuestionOption {
	label: string;
	description: string;
	preview?: string;
	recommendedReason?: string;
}

export interface AskUserQuestionItem {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect?: boolean;
}

export interface AskUserQuestionArgs {
	questions: AskUserQuestionItem[];
}

export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}

export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}

export interface AskUserQuestionAckDetails {
	kind: "ack";
}

export type AskUserQuestionDetails = AskUserQuestionResult | AskUserQuestionAckDetails;

export type AskOutcome =
	| { kind: "answered"; result: AskUserQuestionResult }
	| { kind: "deferred"; reason?: "chat" }
	| { kind: "abandoned" };

export interface AskRequest {
	toolCallId: string;
	args: AskUserQuestionArgs;
	signal: AbortSignal | undefined;
	ctx: ExtensionContext;
}

export type AskUserQuestionAsker = (request: AskRequest) => Promise<AskOutcome>;

export interface AskToolResult<D> {
	content: { type: "text"; text: string }[];
	details: D;
	terminate?: boolean;
}

export const ASK_ACK_TEXT =
	"The questions are now shown to the user. This turn ends here; the user's answers (or their own free-form reply) will arrive as the next user message. Do not assume an answer until it arrives.";
export const ASK_CHAT_TEXT =
	"The user chose to discuss these questions in chat instead of answering them here. This turn ends here; their reply will arrive as the next user message. Do not assume an answer until it arrives.";
export const ASK_STOPPED_ERROR = "Question cancelled because the run was stopped";
export const ASK_UNAVAILABLE_TEXT = "Error: UI not available (running in non-interactive mode)";
export const DECLINE_MESSAGE = "User declined to answer questions";

const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

export interface ValidationResult {
	ok: boolean;
	message: string;
}

export function validateQuestionnaire(args: AskUserQuestionArgs): ValidationResult {
	const questions = args.questions ?? [];
	if (questions.length === 0)
		return { ok: false, message: "Error: At least one question is required" };

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

export function textResult<D>(text: string, details: D): AskToolResult<D> {
	return { content: [{ type: "text", text }], details };
}

function answerSegment(a: AskUserQuestionAnswer): string {
	const scalar = a.kind === "multi" ? (a.selected ?? []).join(", ") : (a.answer ?? "(no answer)");
	const parts = [`"${a.question}"="${scalar}"`];
	if (a.kind === "multi" && a.answer) parts.push(`user's own answer: "${a.answer}"`);
	if (a.preview) parts.push(`selected preview: ${a.preview}`);
	if (a.notes) parts.push(`user notes: ${a.notes}`);
	return `${parts.join(". ")}.`;
}

export function buildQuestionnaireResponse(
	result: AskUserQuestionResult,
	args: AskUserQuestionArgs,
): AskToolResult<AskUserQuestionResult> {
	if (result.cancelled)
		return textResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	const segments: string[] = [];
	const declined: string[] = [];
	for (let i = 0; i < args.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(answerSegment(a));
		else declined.push(`"${args.questions[i]?.question}"`);
	}
	if (segments.length === 0)
		return textResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	const declinedNote =
		declined.length > 0 ? ` The user declined to answer: ${declined.join(", ")}.` : "";
	return textResult(
		`${ENVELOPE_PREFIX} ${segments.join(" ")}${declinedNote} ${ENVELOPE_SUFFIX}`,
		result,
	);
}

export function outcomeResult(
	outcome: AskOutcome,
	args: AskUserQuestionArgs,
): AskToolResult<AskUserQuestionDetails> {
	switch (outcome.kind) {
		case "answered":
			return buildQuestionnaireResponse(outcome.result, args);
		case "deferred":
			return {
				...textResult<AskUserQuestionDetails>(
					outcome.reason === "chat" ? ASK_CHAT_TEXT : ASK_ACK_TEXT,
					{ kind: "ack" },
				),
				terminate: true,
			};
		case "abandoned":
			return {
				...textResult<AskUserQuestionDetails>(ASK_STOPPED_ERROR, { answers: [], cancelled: true }),
				terminate: true,
			};
	}
}

export function isAskUserQuestionResult(value: unknown): value is AskUserQuestionResult {
	return (
		!!value &&
		typeof value === "object" &&
		Array.isArray((value as AskUserQuestionResult).answers) &&
		typeof (value as AskUserQuestionResult).cancelled === "boolean"
	);
}

export function isAckDetails(details: unknown): details is AskUserQuestionAckDetails {
	return !!details && (details as AskUserQuestionAckDetails).kind === "ack";
}

interface ContentBlockView {
	type?: unknown;
	name?: unknown;
	id?: unknown;
}

const NON_EXECUTABLE_STOP_REASONS: ReadonlySet<unknown> = new Set(["error", "aborted", "length"]);

export function executableAskCallIds(message: { role: string }): string[] {
	const { content, stopReason } = message as { content?: unknown; stopReason?: unknown };
	if (message.role !== "assistant" || !Array.isArray(content)) return [];
	if (NON_EXECUTABLE_STOP_REASONS.has(stopReason)) return [];
	return (content as ContentBlockView[]).flatMap((block) =>
		block?.type === "toolCall" &&
		block.name === ASK_USER_QUESTION_TOOL_NAME &&
		typeof block.id === "string"
			? [block.id]
			: [],
	);
}

export function isolateAskUserQuestionBatch<M extends { role: string }>(message: M): M | undefined {
	const content = (message as { content?: unknown }).content;
	if (message.role !== "assistant" || !Array.isArray(content)) return undefined;
	const blocks = content as ContentBlockView[];
	const askIndex = blocks.findIndex(
		(block) => block?.type === "toolCall" && block.name === ASK_USER_QUESTION_TOOL_NAME,
	);
	if (askIndex < 0) return undefined;
	const kept = blocks.filter((block, index) => block?.type !== "toolCall" || index === askIndex);
	return kept.length === blocks.length ? undefined : { ...message, content: kept };
}
