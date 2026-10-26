import {
	type AgentToolResult,
	getMarkdownTheme,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	type Focusable,
	Key,
	Markdown,
	matchesKey,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	type AskOutcome,
	type AskRequest,
	type AskUserQuestionArgs,
	type AskUserQuestionItem,
	type AskUserQuestionOption,
	type AskUserQuestionResult,
	CHAT_LABEL,
	DECLINE_MESSAGE,
	isAckDetails,
	OTHER_LABEL,
} from "./core.ts";
import { askWithDialogs } from "./dialogs.ts";
import {
	answerSummary,
	deriveAnswer,
	deriveAnswers,
	emptyQuestionState,
	type QuestionState,
	readRecommendation,
	splitRecommended,
} from "./questionnaire.ts";

type Row =
	| { kind: "option"; index: number }
	| { kind: "other" }
	| { kind: "chat" }
	| { kind: "question"; index: number }
	| { kind: "submit" };

type Mode = { kind: "browse" } | { kind: "other" } | { kind: "note"; label: string };

const WIDE_PREVIEW_MIN_WIDTH = 100;
const MAX_PREVIEW_LINES = 24;
const ROW_INDENT = 5;
const NEEDS_CHOICE = "Choose an option first";
const NEEDS_ANSWER = "Answer at least one question first, or press Esc to skip";

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("accent", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}

function isPrintable(data: string): boolean {
	return [...data].length === 1 && !/[\p{Cc}\s]/u.test(data);
}

function wrapIndented(text: string, width: number, indent: number, firstPrefix = ""): string[] {
	const pad = " ".repeat(indent);
	const lead = firstPrefix || pad;
	const room = Math.max(1, width - Math.max(indent, visibleWidth(lead)));
	return wrapTextWithAnsi(text, room).map((line, i) => `${i === 0 ? lead : pad}${line}`);
}

function padTo(line: string, width: number): string {
	const fitted = truncateToWidth(line, width);
	return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

function headerOf(question: { header?: string | undefined } | undefined, index: number): string {
	return question?.header?.trim() || `Q${index + 1}`;
}

export class QuestionnaireComponent implements Component, Focusable {
	private hasFocus = false;
	private page = 0;
	private readonly cursors: number[];
	private readonly states: QuestionState[];
	private mode: Mode = { kind: "browse" };
	private nudge: string | null = null;
	private readonly editor: Editor;
	private settled = false;
	private cache: { width: number; lines: string[] } | undefined;

	constructor(
		private readonly args: AskUserQuestionArgs,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly finish: (outcome: AskOutcome) => void,
	) {
		this.states = args.questions.map(() => emptyQuestionState());
		this.cursors = [...args.questions.map(() => 0), args.questions.length];
		this.editor = new Editor(tui, editorTheme(theme));
		this.editor.onSubmit = (text) => this.saveEditor(text, true);
	}

	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		if (value === this.hasFocus) return;
		this.hasFocus = value;
		this.cache = undefined;
	}

	private get multiple(): boolean {
		return this.args.questions.length > 1;
	}

	private get onReview(): boolean {
		return this.multiple && this.page === this.args.questions.length;
	}

	private get lastPage(): number {
		return this.multiple ? this.args.questions.length : 0;
	}

	private get cursor(): number {
		return this.cursors[this.page] ?? 0;
	}

	private set cursor(value: number) {
		this.cursors[this.page] = value;
	}

	private question(): AskUserQuestionItem {
		const question = this.args.questions[this.page];
		if (!question) throw new Error(`ask_user_question: no question on page ${this.page}`);
		return question;
	}

	private state(): QuestionState {
		const state = this.states[this.page];
		if (!state) throw new Error(`ask_user_question: no state on page ${this.page}`);
		return state;
	}

	private rows(): Row[] {
		if (this.onReview) {
			return [
				...this.args.questions.map((_, index): Row => ({ kind: "question", index })),
				{ kind: "submit" },
				{ kind: "chat" },
			];
		}
		return [
			...this.question().options.map((_, index): Row => ({ kind: "option", index })),
			{ kind: "other" },
			{ kind: "chat" },
		];
	}

	invalidate(): void {
		this.cache = undefined;
	}

	private refresh(): void {
		this.cache = undefined;
		this.tui.requestRender();
	}

	private settle(outcome: AskOutcome): void {
		if (this.settled) return;
		this.settled = true;
		this.finish(outcome);
	}

	handleInput(data: string): void {
		if (this.settled) return;
		if (this.mode.kind !== "browse") {
			if (matchesKey(data, Key.escape)) this.saveEditor(this.editor.getText(), false);
			else this.editor.handleInput(data);
			this.refresh();
			return;
		}
		this.nudge = null;
		this.browse(data);
		this.refresh();
	}

	private browse(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.settle({ kind: "answered", result: { answers: [], cancelled: true } });
			return;
		}
		if (this.multiple) {
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
				this.goToPage(this.page + 1);
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				this.goToPage(this.page - 1);
				return;
			}
		}
		const rows = this.rows();
		const count = rows.length;
		if (matchesKey(data, Key.up)) this.moveTo((this.cursor - 1 + count) % count);
		else if (matchesKey(data, Key.down)) this.moveTo((this.cursor + 1) % count);
		else if (matchesKey(data, Key.home)) this.moveTo(0);
		else if (matchesKey(data, Key.end)) this.moveTo(count - 1);
		else this.act(rows[this.cursor], data);
	}

	private act(row: Row | undefined, data: string): void {
		if (!row) return;
		if (matchesKey(data, Key.enter)) this.activate(row);
		else if (matchesKey(data, Key.space)) this.toggle(row);
		else if (row.kind === "option" && data === "n") this.openNote(row.index);
		else if (row.kind === "other" && isPrintable(data)) this.openOther(data);
	}

	private moveTo(cursor: number): void {
		this.cursor = cursor;
		const row = this.rows()[cursor];
		if (row?.kind === "option" && !this.onReview && !this.question().multiSelect) {
			this.select(row.index);
		}
	}

	private goToPage(page: number): void {
		this.page = Math.min(Math.max(page, 0), this.lastPage);
	}

	private select(index: number): void {
		const option = this.question().options[index];
		if (!option) return;
		const state = this.state();
		state.option = option.label;
		state.customActive = false;
	}

	private toggle(row: Row): void {
		if (this.onReview || (row.kind !== "option" && row.kind !== "other")) {
			this.activate(row);
			return;
		}
		const question = this.question();
		const state = this.state();
		if (row.kind === "other") {
			if (!state.customText.trim()) {
				this.openOther();
				return;
			}
			if (question.multiSelect) state.customActive = !state.customActive;
			else {
				state.customActive = true;
				state.option = null;
			}
			return;
		}
		const option = question.options[row.index];
		if (!option) return;
		if (!question.multiSelect) {
			this.select(row.index);
			return;
		}
		state.multi = state.multi.includes(option.label)
			? state.multi.filter((label) => label !== option.label)
			: [...state.multi, option.label];
	}

	private activate(row: Row): void {
		switch (row.kind) {
			case "chat":
				this.settle({ kind: "deferred", reason: "chat" });
				return;
			case "question":
				this.goToPage(row.index);
				return;
			case "submit":
				this.submit();
				return;
			case "other":
				this.openOther();
				return;
			case "option":
				if (!this.question().multiSelect) this.select(row.index);
				this.confirm();
				return;
		}
	}

	private confirm(): void {
		if (!deriveAnswer(this.question(), this.page, this.state())) {
			this.nudge = NEEDS_CHOICE;
			return;
		}
		if (this.multiple) this.goToPage(this.page + 1);
		else this.submit();
	}

	private submit(): void {
		const answers = deriveAnswers(this.args.questions, this.states);
		if (answers.length === 0) {
			this.nudge = this.multiple ? NEEDS_ANSWER : NEEDS_CHOICE;
			return;
		}
		this.settle({ kind: "answered", result: { answers, cancelled: false } });
	}

	private openOther(initial = ""): void {
		this.mode = { kind: "other" };
		this.editor.setText(`${this.state().customText}${initial}`);
	}

	private openNote(index: number): void {
		const question = this.question();
		const option = question.options[index];
		if (!option) return;
		const state = this.state();
		if (question.multiSelect) {
			if (!state.multi.includes(option.label)) state.multi = [...state.multi, option.label];
		} else this.select(index);
		this.mode = { kind: "note", label: option.label };
		this.editor.setText(state.notes[option.label] ?? "");
	}

	private saveEditor(text: string, submitted: boolean): void {
		const mode = this.mode;
		const state = this.state();
		this.mode = { kind: "browse" };
		if (mode.kind === "note") {
			state.notes = { ...state.notes, [mode.label]: text.trim() };
			return;
		}
		if (mode.kind !== "other") return;
		state.customText = text.trim();
		state.customActive = state.customText !== "";
		if (state.customActive && !this.question().multiSelect) state.option = null;
		if (submitted && state.customActive) this.confirm();
	}

	render(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const theme = this.theme;
		const rule = theme.fg("accent", "─".repeat(Math.max(1, width)));
		const lines = [rule];
		if (this.multiple) lines.push(...this.renderTabs(width), "");
		lines.push(...(this.onReview ? this.renderReview(width) : this.renderQuestion(width)));
		if (this.nudge)
			lines.push("", ...wrapIndented(theme.fg("warning", `⚠ ${this.nudge}`), width, 1));
		lines.push("", ...wrapIndented(theme.fg("dim", this.hint()), width, 1), rule);
		const fitted = lines.map((line) => truncateToWidth(line, width));
		this.cache = { width, lines: fitted };
		return fitted;
	}

	private renderTabs(width: number): string[] {
		const theme = this.theme;
		const tabs = this.args.questions.map((question, index) => {
			const answered = !!deriveAnswer(question, index, this.states[index] ?? emptyQuestionState());
			const label = ` ${headerOf(question, index)}${answered ? " ✓" : ""} `;
			if (index === this.page) return theme.bg("selectedBg", theme.fg("text", label));
			return theme.fg(answered ? "success" : "muted", label);
		});
		const review = " Review & submit ";
		tabs.push(
			this.onReview ? theme.bg("selectedBg", theme.fg("text", review)) : theme.fg("muted", review),
		);
		return wrapIndented(tabs.join(theme.fg("dim", "│")), width, 1);
	}

	private renderQuestion(width: number): string[] {
		const question = this.question();
		const preview = this.previewSource(question);
		const head = (room: number) => [
			...wrapIndented(this.theme.bold(question.question), room, 1),
			"",
			...this.renderRows(question, room),
		];
		if (!preview) return head(width);
		if (width >= WIDE_PREVIEW_MIN_WIDTH) {
			const left = Math.floor((width - 3) / 2);
			const right = width - left - 3;
			const leftLines = head(left);
			const rightLines = this.renderPreview(preview, right);
			const height = Math.max(leftLines.length, rightLines.length);
			const divider = this.theme.fg("borderMuted", " │ ");
			return Array.from(
				{ length: height },
				(_, i) => `${padTo(leftLines[i] ?? "", left)}${divider}${rightLines[i] ?? ""}`,
			);
		}
		return [
			...head(width),
			"",
			...this.renderPreview(preview, Math.max(1, width - 3)).map((line) => `   ${line}`),
		];
	}

	private previewSource(question: AskUserQuestionItem): AskUserQuestionOption | undefined {
		if (question.multiSelect) return undefined;
		const state = this.state();
		return (
			question.options.find((option) => option.label === state.option && option.preview) ??
			question.options.find((option) => option.preview)
		);
	}

	private renderPreview(option: AskUserQuestionOption, width: number): string[] {
		const title = this.theme.fg("muted", `Preview · ${splitRecommended(option.label).text}`);
		const body = new Markdown(option.preview ?? "", 0, 0, getMarkdownTheme()).render(width);
		const shown = body.slice(0, MAX_PREVIEW_LINES);
		if (body.length > shown.length)
			shown.push(this.theme.fg("dim", `… ${body.length - shown.length} more lines`));
		return [title, ...shown];
	}

	private renderEditor(width: number): string[] {
		this.editor.focused = this.focused;
		const pad = " ".repeat(ROW_INDENT);
		return this.editor.render(Math.max(1, width - ROW_INDENT)).map((line) => `${pad}${line}`);
	}

	private pointer(index: number): string {
		return index === this.cursor ? this.theme.fg("accent", "›") : " ";
	}

	private renderRows(question: AskUserQuestionItem, width: number): string[] {
		const theme = this.theme;
		const state = this.state();
		const lines: string[] = [];
		const multi = !!question.multiSelect;
		const mark = (on: boolean) =>
			on ? theme.fg("accent", multi ? "☑" : "●") : theme.fg("muted", multi ? "☐" : "○");
		for (const [index, row] of this.rows().entries()) {
			const focused = index === this.cursor;
			if (row.kind === "option") {
				const option = question.options[row.index];
				if (!option) continue;
				const { text, recommended, reason } = readRecommendation(option);
				const on = multi
					? state.multi.includes(option.label)
					: state.option === option.label && !state.customActive;
				const label = focused ? theme.fg("accent", theme.bold(text)) : theme.fg("text", text);
				const badge = recommended ? `  ${theme.fg("success", "Recommended")}` : "";
				lines.push(
					...wrapIndented(
						`${label}${badge}`,
						width,
						ROW_INDENT,
						` ${this.pointer(index)} ${mark(on)} `,
					),
				);
				if (option.description.trim())
					lines.push(...wrapIndented(theme.fg("muted", option.description), width, ROW_INDENT));
				if (reason)
					lines.push(...wrapIndented(theme.fg("dim", `Why: ${reason}`), width, ROW_INDENT));
				const note = state.notes[option.label]?.trim();
				const editing = this.mode.kind === "note" && this.mode.label === option.label;
				if (note && !editing)
					lines.push(...wrapIndented(theme.fg("muted", `Note: ${note}`), width, ROW_INDENT));
				if (editing) {
					lines.push(...wrapIndented(theme.fg("muted", `Note for ${text}:`), width, ROW_INDENT));
					lines.push(...this.renderEditor(width));
				}
				continue;
			}
			if (row.kind === "other") {
				const own = state.customText.trim();
				const on = state.customActive && own !== "";
				const label = own
					? theme.fg(focused ? "accent" : "text", `${OTHER_LABEL}: ${own.split("\n")[0]}`)
					: theme.fg(focused ? "accent" : "dim", `${OTHER_LABEL}: type your own answer…`);
				lines.push(
					...wrapIndented(label, width, ROW_INDENT, ` ${this.pointer(index)} ${mark(on)} `),
				);
				if (this.mode.kind === "other") lines.push(...this.renderEditor(width));
				continue;
			}
			lines.push(
				...wrapIndented(
					theme.fg(focused ? "accent" : "muted", CHAT_LABEL),
					width,
					ROW_INDENT,
					` ${this.pointer(index)}   `,
				),
			);
		}
		return lines;
	}

	private renderReview(width: number): string[] {
		const theme = this.theme;
		const lines = [...wrapIndented(theme.bold("Review your answers"), width, 1), ""];
		const unanswered: string[] = [];
		for (const [index, question] of this.args.questions.entries()) {
			const answer = deriveAnswer(question, index, this.states[index] ?? emptyQuestionState());
			const header = headerOf(question, index);
			lines.push(
				...wrapIndented(
					`${theme.fg("muted", header)}  ${theme.fg(index === this.cursor ? "accent" : "text", question.question)}`,
					width,
					ROW_INDENT,
					` ${this.pointer(index)}   `,
				),
			);
			if (!answer) {
				unanswered.push(header);
				lines.push(...wrapIndented(theme.fg("dim", "Not answered"), width, ROW_INDENT));
				continue;
			}
			lines.push(
				...wrapIndented(`${theme.fg("success", "✓")} ${answerSummary(answer)}`, width, ROW_INDENT),
			);
			for (const note of answer.notes?.split("\n") ?? []) {
				lines.push(...wrapIndented(theme.fg("muted", `Note: ${note}`), width, ROW_INDENT));
			}
		}
		const submitIndex = this.args.questions.length;
		const submitLabel = theme.bold("Submit answers");
		lines.push(
			"",
			...wrapIndented(
				submitIndex === this.cursor ? theme.fg("accent", submitLabel) : submitLabel,
				width,
				ROW_INDENT,
				` ${this.pointer(submitIndex)}   `,
			),
			...wrapIndented(
				theme.fg(submitIndex + 1 === this.cursor ? "accent" : "muted", CHAT_LABEL),
				width,
				ROW_INDENT,
				` ${this.pointer(submitIndex + 1)}   `,
			),
		);
		if (unanswered.length > 0)
			lines.push(
				"",
				...wrapIndented(theme.fg("warning", `⚠ Unanswered: ${unanswered.join(", ")}`), width, 1),
			);
		return lines;
	}

	private hint(): string {
		if (this.mode.kind === "note") return "Enter save note · Shift+Enter new line · Esc back";
		if (this.mode.kind === "other") return "Enter save · Shift+Enter new line · Esc back";
		const pages = this.multiple ? " · ←→/Tab questions" : "";
		if (this.onReview) return `↑↓ move · Enter open or submit${pages} · Esc skip`;
		const choose = this.question().multiSelect
			? "↑↓ move · Space toggle"
			: "↑↓ move & select · Space select";
		return `${choose} · Enter confirm · n note${pages} · Esc skip`;
	}
}

export async function askInTerminal(request: AskRequest): Promise<AskOutcome> {
	const { args, signal, ctx } = request;
	if (signal?.aborted) return { kind: "abandoned" };
	const outcome: AskOutcome | null | undefined = await ctx.ui.custom<AskOutcome | null>(
		(tui, theme, _keybindings, done) => {
			let settled = false;
			const onAbort = () => settle(null);
			const settle = (value: AskOutcome | null) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				done(value);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			return new QuestionnaireComponent(args, tui, theme, settle);
		},
	);
	if (outcome === null) return { kind: "abandoned" };
	if (outcome === undefined) return askWithDialogs(request);
	return outcome;
}

function partialQuestions(args: unknown): Partial<AskUserQuestionItem>[] {
	const questions = (args as { questions?: unknown } | undefined)?.questions;
	return Array.isArray(questions)
		? questions.filter((q): q is Partial<AskUserQuestionItem> => !!q && typeof q === "object")
		: [];
}

export function renderAskCall(args: unknown, theme: Theme): Component {
	const questions = partialQuestions(args);
	const headers = questions
		.map((question) => question.header?.trim())
		.filter((header): header is string => !!header)
		.join(", ");
	const count = `${questions.length} question${questions.length === 1 ? "" : "s"}`;
	return new Text(
		`${theme.fg("toolTitle", theme.bold("ask_user_question "))}${theme.fg("muted", count)}${
			headers ? theme.fg("dim", ` (${headers})`) : ""
		}`,
		0,
		0,
	);
}

function isResult(details: unknown): details is AskUserQuestionResult {
	return (
		!!details &&
		typeof details === "object" &&
		Array.isArray((details as AskUserQuestionResult).answers) &&
		typeof (details as AskUserQuestionResult).cancelled === "boolean"
	);
}

function resultText(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

export function renderAskResult(
	result: AgentToolResult<unknown>,
	_options: ToolRenderResultOptions,
	theme: Theme,
	context: { args?: unknown; isError?: boolean },
): Component {
	const { details } = result;
	if (context.isError || (!isAckDetails(details) && !isResult(details)))
		return new Text(theme.fg(context.isError ? "error" : "text", resultText(result)), 0, 0);
	if (isAckDetails(details)) return new Text(theme.fg("muted", "Continuing in chat"), 0, 0);
	if (details.cancelled && details.answers.length === 0) {
		const text = resultText(result);
		return new Text(theme.fg("warning", text === DECLINE_MESSAGE ? "Skipped" : text), 0, 0);
	}
	const questions = partialQuestions(context.args);
	const count = Math.max(questions.length, ...details.answers.map((a) => a.questionIndex + 1));
	const lines: string[] = [];
	for (let index = 0; index < count; index++) {
		const header = theme.fg("accent", headerOf(questions[index], index));
		const answer = details.answers.find((a) => a.questionIndex === index);
		if (!answer) {
			lines.push(`${theme.fg("dim", "–")} ${header}: ${theme.fg("dim", "not answered")}`);
			continue;
		}
		lines.push(`${theme.fg("success", "✓")} ${header}: ${answerSummary(answer)}`);
		for (const note of answer.notes?.split("\n") ?? [])
			lines.push(`    ${theme.fg("muted", note)}`);
	}
	return new Text(lines.join("\n"), 0, 0);
}
