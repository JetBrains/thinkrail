import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import {
	ASK_STOPPED_ERROR,
	type AskOutcome,
	type AskRequest,
	type AskUserQuestionAnswer,
	type AskUserQuestionItem,
	type AskUserQuestionOption,
	CHAT_LABEL,
	OTHER_LABEL,
} from "./core.ts";

const MAX_PREVIEW_CHARS = 600;
const OTHER_CHOICE = `${OTHER_LABEL}…`;
const OTHER_PLACEHOLDER = "type your own answer…";
const MULTI_PLACEHOLDER = "1,3; your own answer";
const MULTI_INSTRUCTIONS =
	'Type the numbers of every option that applies, comma-separated (e.g. "1,3"). Add "; your own answer" to include your own text, or type only your own text. Leave it empty to skip this question.';

type DialogUi = Pick<ExtensionUIContext, "select" | "input">;

type Step =
	| { kind: "answer"; answer: AskUserQuestionAnswer | null }
	| { kind: "declined" }
	| { kind: "chat" };

function dialogOptions(signal: AbortSignal | undefined): ExtensionUIDialogOptions | undefined {
	return signal ? { signal } : undefined;
}

function stopped(): Error {
	return new Error(ASK_STOPPED_ERROR);
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function optionLine(option: AskUserQuestionOption): string {
	const reason = option.recommendedReason?.trim();
	return [option.label, option.description.trim(), reason ? `Why: ${reason}` : ""]
		.filter((part) => part !== "")
		.join(" — ");
}

function dialogTitle(question: AskUserQuestionItem, index: number, total: number): string {
	const head = total > 1 ? `${question.header} (${index + 1}/${total})` : question.header;
	const parts = [`${head}: ${question.question}`];
	for (const option of question.options) {
		if (option.preview)
			parts.push(`Preview · ${option.label}:\n${truncate(option.preview, MAX_PREVIEW_CHARS)}`);
	}
	return parts.join("\n\n");
}

function dismissed(signal: AbortSignal | undefined): Step {
	if (signal?.aborted) throw stopped();
	return { kind: "declined" };
}

async function askSingleSelect(
	ui: DialogUi,
	question: AskUserQuestionItem,
	index: number,
	total: number,
	signal: AbortSignal | undefined,
): Promise<Step> {
	const title = dialogTitle(question, index, total);
	const lines = question.options.map(optionLine);
	const choices = [...lines, OTHER_CHOICE, CHAT_LABEL];
	for (;;) {
		const choice = await ui.select(title, choices, dialogOptions(signal));
		if (choice === undefined) return dismissed(signal);
		if (choice === CHAT_LABEL) return { kind: "chat" };
		if (choice === OTHER_CHOICE) {
			const text = await ui.input(question.question, OTHER_PLACEHOLDER, dialogOptions(signal));
			if (text === undefined && signal?.aborted) throw stopped();
			const own = text?.trim();
			if (!own) continue;
			return {
				kind: "answer",
				answer: { questionIndex: index, question: question.question, kind: "custom", answer: own },
			};
		}
		const option = question.options[lines.indexOf(choice)];
		if (!option) continue;
		return {
			kind: "answer",
			answer: {
				questionIndex: index,
				question: question.question,
				kind: "option",
				answer: option.label,
				...(option.preview ? { preview: option.preview } : {}),
			},
		};
	}
}

export function parseMultiAnswer(
	text: string,
	question: AskUserQuestionItem,
	index: number,
): AskUserQuestionAnswer | null {
	const trimmed = text.trim();
	if (trimmed === "") return null;
	const semicolon = trimmed.indexOf(";");
	const head = semicolon < 0 ? trimmed : trimmed.slice(0, semicolon);
	const numbered = /^[\d\s,]+$/.test(head);
	const own = numbered ? (semicolon < 0 ? "" : trimmed.slice(semicolon + 1).trim()) : trimmed;
	const selected: string[] = [];
	if (numbered) {
		for (const part of head.split(",")) {
			const option = question.options[Number(part.trim()) - 1];
			if (option && !selected.includes(option.label)) selected.push(option.label);
		}
	}
	if (selected.length === 0 && own === "") return null;
	return {
		questionIndex: index,
		question: question.question,
		kind: "multi",
		answer: own || null,
		selected,
	};
}

async function askMultiSelect(
	ui: DialogUi,
	question: AskUserQuestionItem,
	index: number,
	total: number,
	signal: AbortSignal | undefined,
): Promise<Step> {
	const numbered = question.options.map((option, i) => `${i + 1}. ${optionLine(option)}`);
	const title = [dialogTitle(question, index, total), numbered.join("\n"), MULTI_INSTRUCTIONS].join(
		"\n\n",
	);
	const text = await ui.input(title, MULTI_PLACEHOLDER, dialogOptions(signal));
	if (text === undefined) return dismissed(signal);
	return { kind: "answer", answer: parseMultiAnswer(text, question, index) };
}

export async function askWithDialogs({ args, signal, ctx }: AskRequest): Promise<AskOutcome> {
	const total = args.questions.length;
	const answers: AskUserQuestionAnswer[] = [];
	for (const [index, question] of args.questions.entries()) {
		if (signal?.aborted) throw stopped();
		const step = question.multiSelect
			? await askMultiSelect(ctx.ui, question, index, total, signal)
			: await askSingleSelect(ctx.ui, question, index, total, signal);
		if (step.kind === "declined")
			return { kind: "answered", result: { answers: [], cancelled: true } };
		if (step.kind === "chat") return { kind: "deferred", reason: "chat" };
		if (step.answer) answers.push(step.answer);
	}
	return { kind: "answered", result: { answers, cancelled: false } };
}
