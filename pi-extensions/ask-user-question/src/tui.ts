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
	CHAT_LABEL,
	DECLINE_MESSAGE,
	isAckDetails,
	isAskUserQuestionResult,
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
	selectSingleOption,
	splitRecommended,
} from "./questionnaire.ts";

type Row =
	| { kind: "discussion" }
	| { kind: "option"; index: number }
	| { kind: "note"; index: number }
	| { kind: "other" }
	| { kind: "next" }
	| { kind: "submit" }
	| { kind: "chat" };

const rowKey = (row: Row): string => ("index" in row ? `${row.kind}:${row.index}` : row.kind);

type Mode =
	| { kind: "browse" }
	| { kind: "other" }
	| { kind: "note"; label: string }
	| { kind: "discuss" };

const WIDE_PREVIEW_MIN_WIDTH = 100;
const MAX_PREVIEW_LINES = 24;
const ROW_INDENT = 5;
const NEEDS_ANSWER = "Answer at least one question first, or press Esc to skip";
const SUBMIT_LABEL = "Submit answers";
const NEXT_LABEL = "Next →";
const NO_PREVIEW = "No preview for this option";
const DISCUSS_MARK = "Discuss first";

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

function hasPreview(option: AskUserQuestionOption): boolean {
	return !!option.preview || !!option.previewFile;
}

function filePreviewLine(
	target: { previewFile?: string | undefined; previewBefore?: string | undefined },
	theme: Theme,
): string {
	const path = target.previewBefore
		? `${target.previewBefore} → ${target.previewFile}`
		: (target.previewFile ?? "");
	return `${theme.fg("muted", "preview:")} ${path}`;
}

function headerOf(question: { header?: string | undefined } | undefined, index: number): string {
	return question?.header?.trim() || `Q${index + 1}`;
}

export class QuestionnaireComponent implements Component, Focusable {
	private hasFocus = false;
	private page = 0;
	private readonly cursors: string[];
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
		this.cursors = args.questions.map(() => "option:0");
		this.editor = new Editor(tui, editorTheme(theme));
		this.editor.onSubmit = (text) => this.saveEditor(text);
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

	private get lastPage(): number {
		return this.args.questions.length - 1;
	}

	private get cursor(): number {
		const rows = this.rows();
		const key = this.cursors[this.page] ?? "option:0";
		const found = rows.findIndex((row) => rowKey(row) === key);
		if (found >= 0) return found;
		const owner = key.startsWith("note:") ? `option:${key.slice(5)}` : "option:0";
		return Math.max(
			0,
			rows.findIndex((row) => rowKey(row) === owner),
		);
	}

	private set cursor(value: number) {
		const row = this.rows()[value];
		if (row) this.cursors[this.page] = rowKey(row);
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
		const state = this.state();
		return [
			...(state.discuss ? [{ kind: "discussion" } as const] : []),
			...this.question().options.flatMap((option, index): Row[] =>
				state.notes[option.label]?.trim()
					? [
							{ kind: "option", index },
							{ kind: "note", index },
						]
					: [{ kind: "option", index }],
			),
			{ kind: "other" },
			this.page < this.lastPage ? { kind: "next" } : { kind: "submit" },
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
			if (matchesKey(data, Key.escape)) this.saveEditor(this.editor.getText());
			else if (matchesKey(data, Key.ctrl("enter"))) {
				this.saveEditor(this.editor.getText());
				this.submit();
			} else this.editor.handleInput(data);
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
		if (matchesKey(data, Key.ctrl("enter"))) {
			this.submit();
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
		else if (matchesKey(data, Key.space)) {
			if (row.kind === "option") this.openNote(row.index);
			else this.activate(row);
		} else if (row.kind === "option" && data === "d") this.openDiscuss();
		else if (row.kind === "other" && isPrintable(data)) this.openOther(data);
	}

	private moveTo(cursor: number): void {
		this.cursor = cursor;
	}

	private goToPage(page: number): void {
		this.page = Math.min(Math.max(page, 0), this.lastPage);
	}

	private select(index: number): void {
		const option = this.question().options[index];
		if (!option) return;
		this.states[this.page] = selectSingleOption(this.state(), option.label);
	}

	private toggle(index: number): void {
		const option = this.question().options[index];
		if (!option) return;
		const state = this.state();
		state.discuss = null;
		state.multi = state.multi.includes(option.label)
			? state.multi.filter((label) => label !== option.label)
			: [...state.multi, option.label];
	}

	private activate(row: Row): void {
		switch (row.kind) {
			case "chat":
				this.settle({ kind: "deferred", reason: "chat" });
				return;
			case "submit":
				this.submit();
				return;
			case "next":
				this.goToPage(this.page + 1);
				return;
			case "other":
				this.openOther();
				return;
			case "note":
				this.openNote(row.index);
				return;
			case "discussion":
				this.openDiscuss();
				return;
			case "option":
				if (this.question().multiSelect) this.toggle(row.index);
				else this.select(row.index);
				return;
		}
	}

	private submit(): void {
		const answers = deriveAnswers(this.args.questions, this.states);
		if (answers.length === 0) {
			this.nudge = NEEDS_ANSWER;
			return;
		}
		this.settle({ kind: "answered", result: { answers, cancelled: false } });
	}

	private openOther(initial = ""): void {
		this.mode = { kind: "other" };
		this.editor.setText(`${this.state().customText}${initial}`);
	}

	private openDiscuss(): void {
		const state = this.state();
		if (!state.discuss) state.discuss = { text: "" };
		this.mode = { kind: "discuss" };
		this.editor.setText(state.discuss.text);
	}

	private openNote(index: number): void {
		const question = this.question();
		const option = question.options[index];
		if (!option) return;
		const state = this.state();
		if (question.multiSelect) {
			if (!state.multi.includes(option.label)) state.multi = [...state.multi, option.label];
			state.discuss = null;
		} else this.select(index);
		this.mode = { kind: "note", label: option.label };
		this.editor.setText(this.state().notes[option.label] ?? "");
	}

	private park(key: string): void {
		this.cursors[this.page] = key;
	}

	private saveEditor(text: string): void {
		const mode = this.mode;
		const state = this.state();
		this.mode = { kind: "browse" };
		if (mode.kind === "note") {
			state.notes = { ...state.notes, [mode.label]: text.trim() };
			const index = this.question().options.findIndex((option) => option.label === mode.label);
			this.park(state.notes[mode.label] ? `note:${index}` : `option:${index}`);
			return;
		}
		if (mode.kind === "discuss") {
			state.discuss = { ...(state.discuss ?? {}), text: text.trim() };
			this.park("discussion");
			return;
		}
		if (mode.kind !== "other") return;
		state.customText = text.trim();
		state.customActive = state.customText !== "";
		if (state.customActive) state.discuss = null;
		if (state.customActive && !this.question().multiSelect) state.option = null;
		this.park("other");
	}

	render(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const theme = this.theme;
		const rule = theme.fg("accent", "─".repeat(Math.max(1, width)));
		const lines = [rule];
		if (this.multiple) lines.push(...this.renderTabs(width), "");
		lines.push(...this.renderQuestion(width));
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
			const state = this.states[index] ?? emptyQuestionState();
			const answered = !!deriveAnswer(question, index, state);
			const mark = state.discuss ? " ?" : answered ? " ✓" : "";
			const label = ` ${headerOf(question, index)}${mark} `;
			if (index === this.page) return theme.bg("selectedBg", theme.fg("text", label));
			return theme.fg(answered ? "success" : "muted", label);
		});
		return wrapIndented(tabs.join(theme.fg("dim", "│")), width, 1);
	}

	private renderQuestion(width: number): string[] {
		const question = this.question();
		const preview = this.previewSource(question);
		const head = (room: number) => [
			...wrapIndented(this.theme.bold(question.question), room, 1),
			...this.renderQuestionPreview(question, room),
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

	private previewSource(
		question: AskUserQuestionItem,
	): { option: AskUserQuestionOption | null } | undefined {
		if (question.multiSelect) return undefined;
		if (!question.options.some(hasPreview)) return undefined;
		const row = this.rows()[this.cursor];
		if (row?.kind === "option" || row?.kind === "note")
			return { option: question.options[row.index] ?? null };
		const state = this.state();
		if (state.customActive) return { option: null };
		return { option: question.options.find((option) => option.label === state.option) ?? null };
	}

	private markdownLines(markdown: string, width: number): string[] {
		const body = new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width);
		const shown = body.slice(0, MAX_PREVIEW_LINES);
		if (body.length > shown.length)
			shown.push(this.theme.fg("dim", `… ${body.length - shown.length} more lines`));
		return shown;
	}

	private renderPreview(source: { option: AskUserQuestionOption | null }, width: number): string[] {
		const { option } = source;
		if (!option) return [this.theme.fg("muted", "Preview"), this.theme.fg("dim", NO_PREVIEW)];
		const title = this.theme.fg("muted", `Preview · ${splitRecommended(option.label).text}`);
		if (option.previewFile) return [title, filePreviewLine(option, this.theme)];
		if (!option.preview) return [title, this.theme.fg("dim", NO_PREVIEW)];
		return [title, ...this.markdownLines(option.preview, width)];
	}

	private renderQuestionPreview(question: AskUserQuestionItem, width: number): string[] {
		if (question.previewFile)
			return ["", ...wrapIndented(filePreviewLine(question, this.theme), width, 3)];
		if (!question.preview) return [];
		const room = Math.max(1, width - 3);
		return ["", ...this.markdownLines(question.preview, room).map((line) => `   ${line}`)];
	}

	private renderDiscussion(width: number, focused: boolean, index: number): string[] {
		const discuss = this.state().discuss;
		if (!discuss) return [];
		const label = this.theme.fg("accent", focused ? this.theme.bold(DISCUSS_MARK) : DISCUSS_MARK);
		const lines = wrapIndented(label, width, ROW_INDENT, ` ${this.pointer(index)} ? `);
		if (this.mode.kind === "discuss") {
			lines.push(
				...wrapIndented(
					this.theme.fg("muted", "What should the agent explain?"),
					width,
					ROW_INDENT,
				),
				...this.renderEditor(width),
			);
		} else if (discuss.text)
			lines.push(...wrapIndented(this.theme.fg("muted", discuss.text), width, ROW_INDENT));
		return [...lines, ""];
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
			if (row.kind === "discussion") {
				lines.push(...this.renderDiscussion(width, focused, index));
				continue;
			}
			if (row.kind === "note") {
				const option = question.options[row.index];
				const note = option ? state.notes[option.label]?.trim() : undefined;
				const editing = this.mode.kind === "note" && this.mode.label === option?.label;
				if (!note || editing) continue;
				lines.push(
					...wrapIndented(
						theme.fg(focused ? "accent" : "muted", `✎ ${note}`),
						width,
						ROW_INDENT,
						` ${this.pointer(index)}   `,
					),
				);
				continue;
			}
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
				const editing = this.mode.kind === "note" && this.mode.label === option.label;
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
			if (row.kind === "submit" || row.kind === "next") {
				const label = theme.bold(row.kind === "submit" ? SUBMIT_LABEL : NEXT_LABEL);
				lines.push(
					"",
					...wrapIndented(
						focused ? theme.fg("accent", label) : label,
						width,
						ROW_INDENT,
						` ${this.pointer(index)}   `,
					),
				);
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

	private hint(): string {
		if (this.mode.kind === "note") return "Enter save note · Shift+Enter new line · Esc back";
		if (this.mode.kind === "other") return "Enter save · Shift+Enter new line · Esc back";
		if (this.mode.kind === "discuss")
			return "Enter save · Shift+Enter new line · Esc back · choose an option to cancel";
		const pages = this.multiple ? " · ←→/Tab questions" : "";
		const pick = this.question().multiSelect ? "Enter toggle" : "Enter select";
		return `↑↓ move · ${pick} · Space note · d discuss · Ctrl+Enter submit${pages} · Esc skip`;
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
	if (context.isError || (!isAckDetails(details) && !isAskUserQuestionResult(details)))
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
		const mark = answer.kind === "discuss" ? theme.fg("warning", "?") : theme.fg("success", "✓");
		lines.push(`${mark} ${header}: ${answerSummary(answer)}`);
		for (const note of answer.notes?.split("\n") ?? [])
			lines.push(`    ${theme.fg("muted", note)}`);
	}
	return new Text(lines.join("\n"), 0, 0);
}
