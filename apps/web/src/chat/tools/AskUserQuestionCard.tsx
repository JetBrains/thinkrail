import type {
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import {
	Check,
	CircleDot,
	ListChecks,
	MessageCircleQuestion,
	Pencil,
	SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib";
import { useChatActions } from "../ChatActions";
import { Markdown } from "../Markdown";
import type { ToolRenderProps } from "../toolRegistry";
import { resultText } from "./toolHelpers";

// The inline `ask_user_question` questionnaire — the browser side of the host-owned tool. Rendered as a
// "bare" tool card (see the tool registry `chrome`), so it's a full-width, always-open panel rather than a
// folded card. Styled after the app's inline prompt-card spec: the question IS the card header, options are
// radio/checkbox rows (the recommended one badged) closed by a mandatory native "Other" row (same
// radio/checkbox indicator, inline free-text field), a footer with a mode hint + Skip/Submit, and compact,
// borderless "record" states once resolved. Presentational: reads the questions
// from the tool-call `args`, replies through the `ChatActions` context (provided by `ChatView`) — never the
// store/transport directly, so it stays reusable.

// ---- pure helpers (exported for unit tests) ----

/** Read the `ask_user_question` args off a tool call defensively (bad shapes → no questions). */
export function parseQuestions(args: Record<string, unknown>): AskUserQuestionItem[] {
	const qs = (args as Partial<AskUserQuestionArgs>).questions;
	return Array.isArray(qs) ? qs.filter((q) => q && Array.isArray(q.options)) : [];
}

/** Split a trailing "(Recommended)" marker off an option label (the agent appends it to its pick). */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
	const m = /\s*\(recommended\)\s*$/i.exec(label);
	return m
		? { text: label.slice(0, m.index).trim(), recommended: true }
		: { text: label, recommended: false };
}

/** Per-question local UI state. */
interface QState {
	/** Selected single-select option label. */
	option: string | null;
	/** Free-text ("Type your own answer") value + whether it's the active answer. */
	customText: string;
	customActive: boolean;
	/** Selected labels for a multi-select question. */
	multi: string[];
	/** Per-option free-text notes. */
	notes: Record<string, string>;
	/** Which option's note editor is open, if any. */
	noteFor: string | null;
}

const emptyQState = (): QState => ({
	option: null,
	customText: "",
	customActive: false,
	multi: [],
	notes: {},
	noteFor: null,
});

/** Derive the answer for one question from its UI state, or `null` when it's still unanswered. Pure. */
export function deriveAnswer(
	question: AskUserQuestionItem,
	index: number,
	state: QState,
): AskUserQuestionAnswer | null {
	const base = { questionIndex: index, question: question.question };
	if (question.multiSelect) {
		// Same stale-label rule as single-select below: a label checked while the args were still streaming
		// may not exist in the final options — it must not ride along in the answer.
		const valid = state.multi.filter((label) => question.options.some((o) => o.label === label));
		// Multi-select free text is ADDITIVE (issue #50): a checked "Other" row's non-empty text is one
		// more answer alongside the checked options — and text alone (nothing else checked) is a valid
		// answer too. Typing checks the row; an explicitly unchecked row keeps its text out.
		const custom = state.customActive ? state.customText.trim() : "";
		if (valid.length === 0 && !custom) return null;
		return { ...base, kind: "multi", answer: custom || null, selected: valid };
	}
	if (state.customActive && state.customText.trim()) {
		return { ...base, kind: "custom", answer: state.customText.trim() };
	}
	if (state.option != null) {
		const opt = question.options.find((o) => o.label === state.option);
		// The selected label must exist in the (final) options — a label clicked while the args were still
		// streaming can be truncated/renamed by the time they complete, and must not count as an answer.
		if (!opt) return null;
		const note = state.notes[state.option]?.trim();
		return {
			...base,
			kind: "option",
			answer: state.option,
			...(opt.preview ? { preview: opt.preview } : {}),
			...(note ? { notes: note } : {}),
		};
	}
	return null;
}

/** Extract the structured result from a finished tool call (`{ content, details }` or the result itself). */
export function readAskResult(raw: unknown): AskUserQuestionResult | null {
	const isResult = (v: unknown): v is AskUserQuestionResult =>
		!!v &&
		typeof v === "object" &&
		Array.isArray((v as AskUserQuestionResult).answers) &&
		typeof (v as AskUserQuestionResult).cancelled === "boolean";
	if (raw && typeof raw === "object" && isResult((raw as { details?: unknown }).details)) {
		return (raw as { details: AskUserQuestionResult }).details;
	}
	return isResult(raw) ? raw : null;
}

// ---- the card ----

/**
 * Per-tool-call UI state that survives unmount: react-virtuoso unmounts rows that scroll out of view, and
 * an in-progress questionnaire must not lose its selections when the user scrolls away and back. Entries
 * are dropped as soon as the call resolves.
 */
interface CachedCardState {
	states: Record<number, QState>;
	tab: number;
	submitted: boolean;
}
const cardStateCache = new Map<string, CachedCardState>();

export function AskUserQuestionCard({
	toolCallId,
	args,
	result,
	status,
	streaming,
}: ToolRenderProps) {
	const actions = useChatActions();
	const questions = useMemo(() => parseQuestions(args), [args]);
	// Keyed by question index rather than a positional array: the card can first mount while the tool
	// call's `arguments` are still streaming in (0 questions), so an array sized at init would stay empty
	// after the questions arrive. A sparse map defaults each question to a fresh state on demand instead.
	const [states, setStates] = useState<Record<number, QState>>(
		() => cardStateCache.get(toolCallId)?.states ?? {},
	);
	const [tab, setTab] = useState(() => cardStateCache.get(toolCallId)?.tab ?? 0);
	const [submitted, setSubmitted] = useState(
		() => cardStateCache.get(toolCallId)?.submitted ?? false,
	);

	useEffect(() => {
		if (status === "running") cardStateCache.set(toolCallId, { states, tab, submitted });
		else cardStateCache.delete(toolCallId);
	}, [toolCallId, status, states, tab, submitted]);

	const stateFor = (qi: number): QState => states[qi] ?? emptyQState();
	const patch = (qi: number, next: Partial<QState>) =>
		setStates((prev) => ({ ...prev, [qi]: { ...(prev[qi] ?? emptyQState()), ...next } }));

	const answers = questions
		.map((q, i) => deriveAnswer(q, i, stateFor(i)))
		.filter((a): a is AskUserQuestionAnswer => a != null);
	const answeredIndices = new Set(answers.map((a) => a.questionIndex));

	const reply = (r: AskUserQuestionResult) => {
		if (!actions) return;
		setSubmitted(true);
		// Un-latch on a failed send (host rejected the session / transport down) so the user can retry.
		actions.answerQuestion(toolCallId, r).catch(() => setSubmitted(false));
	};

	// Resolved (or resolved on another client) → a compact, read-only record.
	if (status !== "running") {
		return (
			<ResolvedRecord
				questions={questions}
				result={readAskResult(result)}
				rawText={resultText(result)}
			/>
		);
	}
	// Controls never stream: while the args arrive the card is a stable placeholder (a form whose labels
	// mutate under the cursor reads as broken); the complete questionnaire reveals atomically at message end.
	if (streaming || questions.length === 0) return <ComposingCard count={questions.length} />;
	// Answer sent, awaiting the tool to finalize (status flips to resolved shortly).
	if (submitted) {
		return (
			<WaitingCard>
				<span data-testid="ask-sent">Answer sent — continuing…</span>
			</WaitingCard>
		);
	}

	const multi = questions.length > 1;
	const reviewTab = questions.length; // synthetic "Review & submit" tab index
	const onReview = tab >= reviewTab;
	const idx = Math.min(tab, questions.length - 1);
	const q = questions[idx];
	const state = stateFor(idx);
	if (!q) return <WaitingCard>Preparing questions…</WaitingCard>;

	const onLastQuestion = idx === questions.length - 1;
	const showContinue = multi && !onReview && !onLastQuestion;
	const canSubmit =
		!!actions && (onReview || !multi ? answers.length > 0 : answeredIndices.has(idx));

	return (
		<div className="flex flex-col gap-xs motion-safe:animate-reveal">
			<WaitingLine />
			<div
				data-testid="ask-user-question"
				data-tone="active"
				className="overflow-hidden rounded-[var(--radius-lg)] border border-border2 bg-elevated"
			>
				{multi ? (
					<div className="flex items-center gap-xs overflow-x-auto border-border2 border-b px-md py-sm">
						{questions.map((question, i) => (
							<TabChip
								key={question.question}
								label={question.header || `Q${i + 1}`}
								active={tab === i}
								answered={answeredIndices.has(i)}
								onClick={() => setTab(i)}
							/>
						))}
						<TabChip
							label="Review & submit"
							active={onReview}
							answered={false}
							onClick={() => setTab(reviewTab)}
						/>
					</div>
				) : null}

				<div className="flex flex-col gap-md p-md">
					{onReview ? (
						<ReviewView questions={questions} answers={answers} onJump={setTab} />
					) : (
						<QuestionBody
							question={q}
							state={state}
							// Picking an authored option deactivates "Other" but keeps its text (cheap to re-activate).
							onSelect={(label) => patch(tab, { option: label, customActive: false })}
							onToggleMulti={(label) =>
								patch(tab, {
									multi: state.multi.includes(label)
										? state.multi.filter((l) => l !== label)
										: [...state.multi, label],
								})
							}
							onCustomText={(text) =>
								patch(tab, { customText: text, customActive: true, option: null })
							}
							onCustomActivate={() => patch(tab, { customActive: true, option: null })}
							onToggleCustom={() => patch(tab, { customActive: !state.customActive })}
							onToggleNote={(label) =>
								patch(tab, { noteFor: state.noteFor === label ? null : label })
							}
							onNote={(label, text) => patch(tab, { notes: { ...state.notes, [label]: text } })}
						/>
					)}

					<div className="flex items-center justify-between gap-sm">
						<ModeHint question={onReview ? undefined : q} review={onReview} />
						<div className="flex items-center gap-md">
							<button
								type="button"
								data-testid="ask-skip"
								onClick={() => reply({ answers: [], cancelled: true })}
								disabled={!actions}
								className="text-muted text-sm hover:text-text disabled:opacity-50"
							>
								Skip
							</button>
							{showContinue ? (
								<button
									type="button"
									data-testid="ask-continue"
									onClick={() => setTab(tab + 1)}
									className="rounded-[var(--radius-md)] bg-primary px-md py-1.5 font-medium text-on-accent text-sm hover:opacity-90"
								>
									Next →
								</button>
							) : (
								<button
									type="button"
									data-testid="ask-submit"
									onClick={() => reply({ answers, cancelled: false })}
									disabled={!canSubmit}
									className="rounded-[var(--radius-md)] bg-primary px-md py-1.5 font-medium text-on-accent text-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
								>
									Submit
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/** "Agent is waiting for your input" — the small status line above the active card. */
function WaitingLine() {
	return <div className="text-muted text-xs">Agent is waiting for your input</div>;
}

/** The card frame used for the transient "answer sent" state (no interactive body). */
function WaitingCard({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-xs">
			<WaitingLine />
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="flex items-center gap-xs rounded-[var(--radius-lg)] border border-border2 bg-elevated px-md py-sm text-muted text-xs"
			>
				<MessageCircleQuestion className="size-3.5 shrink-0" />
				{children}
			</div>
		</div>
	);
}

/**
 * The stable placeholder shown while the tool call's args stream: a header with a live ready-count and
 * fixed skeleton rows — never live controls (a form whose labels mutate under the cursor reads as broken).
 * The complete questionnaire replaces it in one shot at message end.
 */
function ComposingCard({ count }: { count: number }) {
	return (
		<div className="flex flex-col gap-xs">
			<div className="text-muted text-xs">Agent is preparing questions…</div>
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-border2 bg-elevated px-md py-sm"
			>
				<div className="flex items-center gap-xs text-muted text-xs">
					<MessageCircleQuestion className="size-3.5 shrink-0" />
					Preparing questions…{count > 0 ? ` (${count} ready)` : ""}
				</div>
				<div className="flex animate-pulse flex-col gap-xs" aria-hidden="true">
					<div className="h-8 rounded-[var(--radius-md)] bg-hover" />
					<div className="h-8 rounded-[var(--radius-md)] bg-hover" />
				</div>
			</div>
		</div>
	);
}

function TabChip({
	label,
	active,
	answered,
	onClick,
}: {
	label: string;
	active: boolean;
	answered: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="ask-tab"
			data-active={active}
			data-answered={answered}
			onClick={onClick}
			className={cn(
				"flex shrink-0 items-center gap-xs whitespace-nowrap rounded-full px-sm py-0.5 text-xs",
				active ? "bg-primary/15 text-primary" : "text-muted hover:bg-hover",
			)}
		>
			<span
				className={cn(
					"flex size-3.5 items-center justify-center rounded-full border",
					answered ? "border-primary text-primary" : "border-border2",
				)}
			>
				{answered ? <Check className="size-2.5" /> : null}
			</span>
			{label}
		</button>
	);
}

/** Footer mode hint — reflects how many choices the current question takes. */
function ModeHint({
	question,
	review,
}: {
	question: AskUserQuestionItem | undefined;
	review: boolean;
}) {
	if (review) {
		return (
			<span className="flex items-center gap-xs text-hint text-xs">
				<ListChecks className="size-3.5 shrink-0" /> Review your answers
			</span>
		);
	}
	const multi = !!question?.multiSelect;
	return (
		<span className="flex items-center gap-xs text-hint text-xs">
			{multi ? (
				<ListChecks className="size-3.5 shrink-0" />
			) : (
				<CircleDot className="size-3.5 shrink-0" />
			)}
			{multi ? "Select one or more" : "Select one"}
		</span>
	);
}

function QuestionBody({
	question,
	state,
	onSelect,
	onToggleMulti,
	onCustomText,
	onCustomActivate,
	onToggleCustom,
	onToggleNote,
	onNote,
}: {
	question: AskUserQuestionItem;
	state: QState;
	onSelect: (label: string) => void;
	onToggleMulti: (label: string) => void;
	onCustomText: (text: string) => void;
	onCustomActivate: () => void;
	onToggleCustom: () => void;
	onToggleNote: (label: string) => void;
	onNote: (label: string, text: string) => void;
}) {
	// Previews are a single-select affordance (the pane follows `state.option`); a multi-select question
	// authored with previews anyway renders without the pane rather than with one that never updates.
	const anyPreview = !question.multiSelect && question.options.some((o) => o.preview);
	// Side-by-side preview shows the selected option's preview, else the first option that carries one.
	const previewSource =
		question.options.find((o) => o.label === state.option && o.preview) ??
		question.options.find((o) => o.preview);

	return (
		<div className="flex flex-col gap-md">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted" />
				<p className="font-semibold text-md text-text">{question.question}</p>
			</div>
			<div className={cn("grid gap-sm", anyPreview && "md:grid-cols-2")}>
				<div className="flex flex-col gap-sm">
					{question.options.map((opt) => {
						const selected = question.multiSelect
							? state.multi.includes(opt.label)
							: state.option === opt.label;
						return (
							<div key={opt.label} className="flex flex-col gap-xs">
								<OptionRow
									label={opt.label}
									description={opt.description}
									selected={selected}
									multi={!!question.multiSelect}
									onClick={() =>
										question.multiSelect ? onToggleMulti(opt.label) : onSelect(opt.label)
									}
								/>
								{selected && !question.multiSelect ? (
									<div className="pl-[calc(1.125rem+var(--spacing-sm))]">
										{state.noteFor === opt.label ? (
											<FocusTextarea
												data-testid="ask-note"
												rows={2}
												value={state.notes[opt.label] ?? ""}
												placeholder="Add a note for the model…"
												onChange={(e) => onNote(opt.label, e.target.value)}
												className="w-full resize-none rounded-[var(--radius-sm)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-text text-xs outline-none focus:border-primary"
											/>
										) : (
											<button
												type="button"
												data-testid="ask-note-toggle"
												onClick={() => onToggleNote(opt.label)}
												className="flex items-center gap-xs text-hint text-xs hover:text-muted"
											>
												<Pencil className="size-3" />
												{state.notes[opt.label]?.trim() ? "Edit note" : "Add note"}
											</button>
										)}
									</div>
								) : null}
							</div>
						);
					})}

					{/* The "Other" option is MANDATORY — offered on every question (issue #50) — and looks native:
					    one more option row (radio on single-select, checkbox on multi-select) with the free-text
					    field inline. Single-select: exclusive with the authored options; multi-select: additive. */}
					<OtherOptionRow
						multi={!!question.multiSelect}
						active={state.customActive}
						text={state.customText}
						onActivate={onCustomActivate}
						onToggle={onToggleCustom}
						onText={onCustomText}
					/>
				</div>

				{anyPreview && previewSource?.preview ? (
					<div
						data-testid="ask-preview"
						className="min-w-0 overflow-auto rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-xs"
					>
						<div className="mb-xs text-hint text-xs">Preview · {previewSource.label}</div>
						<Markdown text={previewSource.preview} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function OptionRow({
	label,
	description,
	selected,
	multi,
	onClick,
}: {
	label: string;
	description: string;
	selected: boolean;
	multi: boolean;
	onClick: () => void;
}) {
	const { text, recommended } = splitRecommended(label);
	return (
		<button
			type="button"
			data-testid="ask-option"
			data-selected={selected}
			onClick={onClick}
			className={cn(
				"flex items-start gap-sm rounded-[var(--radius-md)] border px-md py-sm text-left transition-colors",
				selected ? "border-primary bg-primary/10" : "border-border2 hover:bg-hover",
			)}
		>
			<Indicator selected={selected} multi={multi} />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="flex items-center gap-xs">
					<span className="font-medium text-sm text-text">{text}</span>
					{recommended ? <RecommendedBadge /> : null}
				</span>
				{description ? <span className="text-muted text-xs">{description}</span> : null}
			</span>
		</button>
	);
}

/**
 * The mandatory "Other" choice, styled as one more option row so it reads native: the same indicator as
 * its siblings (radio on single-select, checkbox on multi-select) plus an inline free-text field. The
 * row is a <label>, so clicking anywhere focuses the input; focusing/typing activates it (on
 * single-select that clears the radio pick — exclusive; on multi-select the checked options stay —
 * additive). On multi-select the checkbox itself is a separate toggle, so the typed text can be
 * excluded without deleting it.
 */
function OtherOptionRow({
	multi,
	active,
	text,
	onActivate,
	onToggle,
	onText,
}: {
	multi: boolean;
	active: boolean;
	text: string;
	onActivate: () => void;
	onToggle: () => void;
	onText: (text: string) => void;
}) {
	return (
		<label
			data-testid="ask-custom-row"
			data-selected={active}
			className={cn(
				"flex cursor-text items-center gap-sm rounded-[var(--radius-md)] border px-md py-sm transition-colors",
				active ? "border-primary bg-primary/10" : "border-border2 hover:bg-hover",
			)}
		>
			{multi ? (
				<button
					type="button"
					data-testid="ask-custom-toggle"
					aria-label={active ? "Exclude your own answer" : "Include your own answer"}
					onClick={(e) => {
						// The checkbox purely toggles — never let the label's default (focus the input) re-activate.
						e.preventDefault();
						onToggle();
					}}
					className="flex items-center"
				>
					<Indicator selected={active} multi className="mt-0" />
				</button>
			) : (
				<Indicator selected={active} multi={false} className="mt-0" />
			)}
			<span className="font-medium text-sm text-text">Other</span>
			<input
				data-testid="ask-custom"
				value={text}
				placeholder="type your own answer…"
				onFocus={onActivate}
				onChange={(e) => onText(e.target.value)}
				className="min-w-0 flex-1 border-none bg-transparent text-sm text-text outline-none placeholder:text-hint"
			/>
		</label>
	);
}

/** The "Recommended" pill next to an agent-recommended option. */
function RecommendedBadge() {
	return (
		<span className="inline-flex items-center rounded-full bg-primary/15 px-xs py-0 font-medium text-[11px] text-primary">
			Recommended
		</span>
	);
}

/** A radio (single) or checkbox (multi) marker: an accent ring/box, filled when selected. */
function Indicator({
	selected,
	multi,
	className,
}: {
	selected: boolean;
	multi: boolean;
	className?: string;
}) {
	if (multi) {
		return (
			<span
				className={cn(
					"mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
					selected ? "border-primary bg-primary text-on-accent" : "border-border2",
					className,
				)}
			>
				{selected ? <Check className="size-3" /> : null}
			</span>
		);
	}
	return (
		<span
			className={cn(
				"mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
				selected ? "border-primary" : "border-border2",
				className,
			)}
		>
			{selected ? <span className="size-2 rounded-full bg-primary" /> : null}
		</span>
	);
}

/**
 * Inputs that focus themselves once on mount — the note editor is revealed only when the user clicks "Add
 * note", so focusing is expected, not a surprise steal. Done with a mount effect rather than the
 * `autoFocus` attribute (an a11y smell outside a modal — biome `noAutofocus`).
 */
function FocusTextarea(props: React.ComponentProps<"textarea">) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => ref.current?.focus(), []);
	return <textarea ref={ref} {...props} />;
}

function ReviewView({
	questions,
	answers,
	onJump,
}: {
	questions: AskUserQuestionItem[];
	answers: AskUserQuestionAnswer[];
	onJump: (index: number) => void;
}) {
	const byIndex = new Map(answers.map((a) => [a.questionIndex, a]));
	const unanswered = questions.map((q, i) => ({ q, i })).filter(({ i }) => !byIndex.has(i));
	return (
		<div className="flex flex-col gap-sm">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted" />
				<p className="font-semibold text-md text-text">Review your answers</p>
			</div>
			<ul className="flex flex-col gap-sm">
				{questions.map((q, i) => {
					const a = byIndex.get(i);
					return (
						<li key={q.question} className="flex flex-col">
							<span className="text-hint text-xs">{q.header || `Q${i + 1}`}</span>
							<span className="text-sm text-text">
								{a ? summarizeAnswer(a) : <span className="text-hint italic">Not answered</span>}
							</span>
						</li>
					);
				})}
			</ul>
			{unanswered.length > 0 ? (
				<button
					type="button"
					data-testid="ask-unanswered"
					onClick={() => onJump(unanswered[0]?.i ?? 0)}
					className="self-start text-gold text-xs hover:underline"
				>
					⚠ Unanswered: {unanswered.map(({ q, i }) => q.header || `Q${i + 1}`).join(", ")}
				</button>
			) : null}
		</div>
	);
}

/** The compact, borderless record shown once the questionnaire is resolved (answered / skipped). */
function ResolvedRecord({
	questions,
	result,
	rawText,
}: {
	questions: AskUserQuestionItem[];
	result: AskUserQuestionResult | null;
	rawText: string;
}) {
	// No structured result (e.g. an old transcript without details) → fall back to the plain envelope text.
	if (!result) {
		return (
			<div data-testid="ask-user-question" data-tone="pending" className="text-muted text-xs">
				{rawText || "Question closed."}
			</div>
		);
	}
	const byIndex = new Map(result.answers.map((a) => [a.questionIndex, a]));
	return (
		<div
			data-testid="ask-user-question"
			data-tone={result.cancelled ? "skipped" : "answered"}
			className="flex flex-col gap-md"
		>
			{questions.map((q, i) => (
				<RecordRow key={q.question} question={q} answer={byIndex.get(i)} />
			))}
			{questions.length === 0 ? (
				<div className="text-muted text-xs">{rawText || "Answered."}</div>
			) : null}
		</div>
	);
}

function RecordRow({
	question,
	answer,
}: {
	question: AskUserQuestionItem;
	answer: AskUserQuestionAnswer | undefined;
}) {
	const selected = new Set(
		answer?.kind === "multi" ? (answer.selected ?? []) : answer?.answer ? [answer.answer] : [],
	);
	return (
		<div className="flex flex-col gap-xs">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-hint" />
				<p className="text-muted text-sm">{question.question}</p>
			</div>
			{!answer ? (
				<div className="flex items-center gap-xs pl-[calc(0.875rem+var(--spacing-sm))] text-hint text-xs italic">
					<SkipForward className="size-3 shrink-0" /> No answer (skipped).
				</div>
			) : answer.kind === "custom" ? (
				<div className="flex items-center gap-xs border-border2 border-l-2 pl-sm">
					<Check className="size-3.5 shrink-0 text-green" />
					<span className="text-sm text-text">“{answer.answer}”</span>
				</div>
			) : (
				<ul className="flex flex-col gap-0.5 pl-[calc(0.875rem+var(--spacing-sm))]">
					{question.options.map((opt) => {
						const isSel = selected.has(opt.label);
						return (
							<li
								key={opt.label}
								data-testid="ask-record-option"
								data-selected={isSel}
								className={cn(
									"flex items-center gap-xs text-sm",
									isSel ? "text-text" : "text-hint",
								)}
							>
								{isSel ? (
									<Check className="size-3.5 shrink-0 text-green" />
								) : (
									<span className="size-3 shrink-0 rounded-full border border-border2" />
								)}
								{splitRecommended(opt.label).text}
							</li>
						);
					})}
					{/* A multi answer's free text (typed in addition to the checks) is the list's final row —
						    inside the <ul> so it aligns exactly with the option rows above it. */}
					{answer.kind === "multi" && answer.answer ? (
						<li
							data-testid="ask-record-custom"
							className="flex items-center gap-xs text-sm text-text"
						>
							<Check className="size-3.5 shrink-0 text-green" />“{answer.answer}”
						</li>
					) : null}
				</ul>
			)}
			{answer?.notes ? (
				<div className="pl-[calc(0.875rem+var(--spacing-sm))] text-hint text-xs">
					Note: {answer.notes}
				</div>
			) : null}
		</div>
	);
}

/** One answer as a short human string for the review panel (a multi answer's free text is quoted). */
function summarizeAnswer(a: AskUserQuestionAnswer): string {
	const value =
		a.kind === "multi"
			? [...(a.selected ?? []), ...(a.answer ? [`“${a.answer}”`] : [])].join(", ")
			: (a.answer ?? "(no answer)");
	return a.notes ? `${value} — ${a.notes}` : value;
}
