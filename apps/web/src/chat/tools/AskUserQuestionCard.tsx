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
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib";
import { useAskFocusScope, useAskState } from "../askState";
import { useChatActions } from "../ChatActions";
import { Markdown } from "../Markdown";
import type { ToolRenderProps } from "../toolRegistry";
import { resultText } from "./toolHelpers";

export function parseQuestions(args: Record<string, unknown>): AskUserQuestionItem[] {
	const qs = (args as Partial<AskUserQuestionArgs>).questions;
	return Array.isArray(qs) ? qs.filter((q) => q && Array.isArray(q.options)) : [];
}

export function splitRecommended(label: string): { text: string; recommended: boolean } {
	const m = /\s*\(recommended\)\s*$/i.exec(label);
	return m
		? { text: label.slice(0, m.index).trim(), recommended: true }
		: { text: label, recommended: false };
}

export function readRecommendation(option: {
	label: string;
	recommendedReason?: string | undefined;
}): {
	text: string;
	recommended: boolean;
	reason?: string | undefined;
} {
	const { text, recommended } = splitRecommended(option.label);
	const reason = option.recommendedReason?.trim() || undefined;
	return { text, recommended: recommended || !!reason, reason };
}

export interface QState {
	option: string | null;
	customText: string;
	customActive: boolean;
	multi: string[];
	cursor: number;
	notes: Record<string, string>;
	noteFor: string | null;
}

const emptyQState = (): QState => ({
	option: null,
	customText: "",
	customActive: false,
	multi: [],
	cursor: 0,
	notes: {},
	noteFor: null,
});

export function deriveAnswer(
	question: AskUserQuestionItem,
	index: number,
	state: QState,
): AskUserQuestionAnswer | null {
	const base = { questionIndex: index, question: question.question };
	if (question.multiSelect) {
		const valid = state.multi.filter((label) => question.options.some((o) => o.label === label));
		const custom = state.customActive ? state.customText.trim() : "";
		if (valid.length === 0 && !custom) return null;
		return { ...base, kind: "multi", answer: custom || null, selected: valid };
	}
	if (state.customActive && state.customText.trim()) {
		return { ...base, kind: "custom", answer: state.customText.trim() };
	}
	if (state.option != null) {
		const opt = question.options.find((o) => o.label === state.option);
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

export function deriveAnswers(
	questions: AskUserQuestionItem[],
	states: Record<number, QState>,
): AskUserQuestionAnswer[] {
	return questions
		.map((question, index) => deriveAnswer(question, index, states[index] ?? emptyQState()))
		.filter((answer): answer is AskUserQuestionAnswer => answer != null);
}

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

interface RecapState {
	selectedLabels: string[];
	customAnswer: string | null;
	showOptions: boolean;
}

export function deriveRecapState(
	answer: AskUserQuestionAnswer | undefined,
	variant: "review" | "resolved",
): RecapState {
	const selectedLabels =
		answer?.kind === "multi"
			? (answer.selected ?? [])
			: answer?.kind === "option" && answer.answer
				? [answer.answer]
				: [];
	const customAnswer =
		answer && (answer.kind === "custom" || answer.kind === "multi") ? answer.answer : null;
	return {
		selectedLabels,
		customAnswer,
		showOptions: variant === "review" || (!!answer && answer.kind !== "custom"),
	};
}

export type ChoiceKeyAction =
	| { type: "move"; index: number }
	| { type: "select" }
	| { type: "confirm" }
	| { type: "none" };

export function choiceKeyAction(key: string, index: number, count: number): ChoiceKeyAction {
	if (count <= 0) return { type: "none" };
	if (key === "ArrowDown") return { type: "move", index: (index + 1) % count };
	if (key === "ArrowUp") return { type: "move", index: (index - 1 + count) % count };
	if (key === "Home") return { type: "move", index: 0 };
	if (key === "End") return { type: "move", index: count - 1 };
	if (key === " " || key === "Spacebar") return { type: "select" };
	if (key === "Enter") return { type: "confirm" };
	return { type: "none" };
}

export function customTextPatch(text: string): Partial<QState> {
	return text.trim()
		? { customText: text, customActive: true, option: null }
		: { customText: text, customActive: false };
}

export type ConfirmSource = { kind: "choice"; label: string; cursor: number } | { kind: "custom" };

export function confirmStateFor(
	state: QState,
	multiSelect: boolean,
	source: ConfirmSource,
): QState {
	if (source.kind === "custom") return state;
	return multiSelect
		? { ...state, cursor: source.cursor }
		: { ...state, cursor: source.cursor, option: source.label, customActive: false };
}

export function noteKeyAction(
	key: string,
	shiftKey: boolean,
	isComposing: boolean,
): "finish" | "consume" | "none" {
	if (key === "Escape") return isComposing ? "consume" : "finish";
	if (isComposing) return "none";
	if (key === "Enter" && !shiftKey) return "finish";
	return "none";
}

export interface ChoiceNudge {
	question: number;
	seq: number;
}

export function nudgeShowsOnPage(
	nudge: ChoiceNudge | null,
	page: number,
	onReview: boolean,
	answered: boolean,
): boolean {
	return !!nudge && !onReview && nudge.question === page && !answered;
}

export function questionPageForKey(key: string, current: number, last: number): number | null {
	if (key === "ArrowLeft") return Math.max(0, current - 1);
	if (key === "ArrowRight") return Math.min(last, current + 1);
	return null;
}

export type QuestionFocusTarget =
	| "none"
	| "non-editing"
	| "empty-composer"
	| "draft-composer"
	| "editing"
	| "modal";

export function shouldClaimQuestionFocus(
	target: QuestionFocusTarget,
	coarsePointer: boolean,
): boolean {
	if (coarsePointer) return false;
	return target === "none" || target === "non-editing" || target === "empty-composer";
}

export function shouldFocusPageTarget(textEntryTarget: boolean, coarsePointer: boolean): boolean {
	return !(textEntryTarget && coarsePointer);
}

const panelDomId = (toolCallId: string) => `ask-panel-${toolCallId}`;
const tabDomId = (toolCallId: string, page: number | "review") => `ask-tab-${toolCallId}-${page}`;

export function createQuestionAttentionClaim(): (scope: object, toolCallId: string) => boolean {
	const claims = new WeakMap<object, Set<string>>();
	return (scope, toolCallId) => {
		let ids = claims.get(scope);
		if (!ids) {
			ids = new Set<string>();
			claims.set(scope, ids);
		}
		if (ids.has(toolCallId)) return false;
		ids.add(toolCallId);
		return true;
	};
}

const claimQuestionAttention = createQuestionAttentionClaim();
const ATTENTION_SETTLE_FRAMES = 30;
const MODAL_SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function focusTargetKind(active: Element | null, card: HTMLElement): QuestionFocusTarget {
	if (!active || active === document.body) return "none";
	if (card.contains(active)) return "non-editing";
	if (!(active instanceof HTMLElement)) return "editing";
	if (active.closest(MODAL_SURFACES)) return "modal";
	if (active.closest(".monaco-editor, .xterm")) return "editing";
	if (active.isContentEditable || active.closest('[contenteditable="true"]')) return "editing";
	const control = active.closest("input, textarea, select, iframe");
	if (!control) return "non-editing";
	if (control instanceof HTMLTextAreaElement && control.dataset.testid === "chat-input") {
		return control.value.length === 0 ? "empty-composer" : "draft-composer";
	}
	return "editing";
}

function hasCoarsePointer(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(!!target.closest("input, textarea, select") ||
			target.isContentEditable ||
			!!target.closest('[contenteditable="true"]'))
	);
}

function focusCurrentQuestionPage(card: HTMLElement): void {
	const target = card.querySelector<HTMLElement>('[data-ask-page-focus="true"]:not([disabled])');
	if (!target) return;
	if (!shouldFocusPageTarget(isTextEntryTarget(target), hasCoarsePointer())) return;
	target.focus({ preventScroll: true });
}

function focusQuestionAttention(card: HTMLElement): void {
	const selected = card.querySelector<HTMLElement>(
		'[data-testid="ask-option"][data-selected="true"], [data-testid="ask-custom-row"][data-selected="true"] input',
	);
	if (selected) selected.focus({ preventScroll: true });
	else focusCurrentQuestionPage(card);
}

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
	const ask = useAskState(toolCallId);
	const providedFocusScope = useAskFocusScope();
	const localFocusScope = useRef<object>({}).current;
	const focusScope = providedFocusScope ?? localFocusScope;
	const cardRef = useRef<HTMLElement>(null);
	const questions = useMemo(() => parseQuestions(args), [args]);
	const resolvedResult = ask?.answer ?? readAskResult(result);
	const awaiting = !resolvedResult && !ask?.superseded && status !== "error";
	const [states, setStates] = useState<Record<number, QState>>(
		() => cardStateCache.get(toolCallId)?.states ?? {},
	);
	const [tab, setTab] = useState(() => cardStateCache.get(toolCallId)?.tab ?? 0);
	const [submitted, setSubmitted] = useState(
		() => cardStateCache.get(toolCallId)?.submitted ?? false,
	);
	const [announced, setAnnounced] = useState(false);
	const [nudge, setNudge] = useState<ChoiceNudge | null>(null);
	const [nudgeSpoken, setNudgeSpoken] = useState(false);
	const nudgeSeq = useRef(0);
	const previousTab = useRef(tab);
	const reclaimFocusAfterFailedSend = useRef(false);

	useEffect(() => {
		if (awaiting) cardStateCache.set(toolCallId, { states, tab, submitted });
		else cardStateCache.delete(toolCallId);
	}, [toolCallId, awaiting, states, tab, submitted]);

	useEffect(() => {
		setNudgeSpoken(false);
		if (!nudge) return;
		const frame = requestAnimationFrame(() => setNudgeSpoken(true));
		const timer = setTimeout(() => setNudge(null), 2500);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}, [nudge]);

	useEffect(() => {
		if (!reclaimFocusAfterFailedSend.current || submitted) return;
		reclaimFocusAfterFailedSend.current = false;
		const card = cardRef.current;
		if (card) focusQuestionAttention(card);
	});

	useEffect(() => {
		if (previousTab.current === tab) return;
		previousTab.current = tab;
		const frame = requestAnimationFrame(() => {
			if (cardRef.current) focusCurrentQuestionPage(cardRef.current);
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

	useEffect(() => {
		if (!awaiting || streaming || questions.length === 0 || submitted) return;
		let frame: number | null = null;
		let attempts = 0;
		let userTookOver = false;
		const yieldToUser = () => {
			userTookOver = true;
		};
		window.addEventListener("pointerdown", yieldToUser, { capture: true, once: true });
		window.addEventListener("keydown", yieldToUser, { capture: true, once: true });
		const settleFocus = () => {
			const card = cardRef.current;
			if (!card || userTookOver) return;
			const kind = focusTargetKind(document.activeElement, card);
			if (!shouldClaimQuestionFocus(kind, hasCoarsePointer())) return;
			focusQuestionAttention(card);
			if (card.contains(document.activeElement)) return;
			attempts += 1;
			if (attempts < ATTENTION_SETTLE_FRAMES) frame = requestAnimationFrame(settleFocus);
		};
		frame = requestAnimationFrame(() => {
			if (!claimQuestionAttention(focusScope, toolCallId)) return;
			setAnnounced(true);
			const card = cardRef.current;
			if (!card) return;
			card.scrollIntoView({ block: "nearest" });
			settleFocus();
		});
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			window.removeEventListener("pointerdown", yieldToUser, { capture: true });
			window.removeEventListener("keydown", yieldToUser, { capture: true });
		};
	}, [awaiting, focusScope, questions.length, streaming, submitted, toolCallId]);

	const stateFor = (qi: number): QState => states[qi] ?? emptyQState();
	const patch = (qi: number, next: Partial<QState>) =>
		setStates((prev) => ({ ...prev, [qi]: { ...(prev[qi] ?? emptyQState()), ...next } }));

	const answers = deriveAnswers(questions, states);
	const answeredIndices = new Set(answers.map((a) => a.questionIndex));

	const reply = (r: AskUserQuestionResult) => {
		if (!actions) return;
		const held = document.activeElement;
		const handedOff = !!held && !!cardRef.current?.contains(held) && held.matches(":focus-visible");
		if (handedOff) actions.focusComposer();
		setSubmitted(true);
		actions.answerQuestion(toolCallId, r).catch(() => {
			reclaimFocusAfterFailedSend.current = handedOff;
			setSubmitted(false);
		});
	};

	if (resolvedResult) {
		return (
			<ResolvedRecord questions={questions} result={resolvedResult} rawText={resultText(result)} />
		);
	}
	if (ask?.superseded) return <SupersededRecord questions={questions} />;
	if (status === "error") {
		return <ResolvedRecord questions={questions} result={null} rawText={resultText(result)} />;
	}
	if (streaming || questions.length === 0) return <ComposingCard count={questions.length} />;
	if (submitted) {
		return (
			<WaitingCard>
				<span data-testid="ask-sent">Answer sent — continuing…</span>
			</WaitingCard>
		);
	}

	const multipleQuestions = questions.length > 1;
	const reviewTab = questions.length;
	const onReview = tab >= reviewTab;
	const idx = Math.min(tab, questions.length - 1);
	const q = questions[idx];
	const state = stateFor(idx);
	if (!q) return <WaitingCard>Preparing questions…</WaitingCard>;

	const showContinue = multipleQuestions && !onReview;
	const canSubmit =
		!!actions && (onReview || !multipleQuestions ? answers.length > 0 : answeredIndices.has(idx));
	const nudgeVisible = nudgeShowsOnPage(nudge, idx, onReview, answeredIndices.has(idx));

	const confirmQuestion = (nextState: QState) => {
		const nextStates = { ...states, [idx]: nextState };
		const nextAnswers = deriveAnswers(questions, nextStates);
		if (!nextAnswers.some((answer) => answer.questionIndex === idx)) {
			nudgeSeq.current += 1;
			setNudge({ question: idx, seq: nudgeSeq.current });
			return;
		}
		setNudge(null);
		setStates(nextStates);
		if (multipleQuestions) setTab(Math.min(idx + 1, reviewTab));
		else reply({ answers: nextAnswers, cancelled: false });
	};

	const confirmChoice = (label: string, cursor: number) =>
		confirmQuestion(confirmStateFor(state, !!q.multiSelect, { kind: "choice", label, cursor }));

	const confirmCustom = () =>
		confirmQuestion(confirmStateFor(state, !!q.multiSelect, { kind: "custom" }));

	const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (
			event.key === "Escape" &&
			event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			event.stopPropagation();
			reply({ answers: [], cancelled: true });
			return;
		}
		if (
			!multipleQuestions ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			isTextEntryTarget(event.target)
		)
			return;
		const next = questionPageForKey(event.key, tab, reviewTab);
		if (next == null) return;
		event.preventDefault();
		if (next !== tab) setTab(next);
	};

	return (
		<div className="flex flex-col gap-xs motion-safe:animate-reveal">
			<AttentionLine announced={announced} />
			<section
				ref={cardRef}
				data-testid="ask-user-question"
				data-tone="active"
				aria-label="Question from agent"
				aria-keyshortcuts="Shift+Escape"
				onKeyDown={onCardKeyDown}
				className="overflow-hidden rounded-[var(--radius-lg)] border border-primary bg-clip-padding bg-container-elevated-bg ring-2 ring-primary-soft"
			>
				{multipleQuestions ? (
					<div
						role="tablist"
						aria-label="Questions"
						className="flex items-center gap-xs overflow-x-auto border-border-default border-b px-md py-sm"
					>
						{questions.map((question, i) => (
							<TabChip
								key={question.question}
								id={tabDomId(toolCallId, i)}
								controls={panelDomId(toolCallId)}
								label={question.header || `Q${i + 1}`}
								active={tab === i}
								answered={answeredIndices.has(i)}
								onClick={() => setTab(i)}
							/>
						))}
						<TabChip
							id={tabDomId(toolCallId, "review")}
							controls={panelDomId(toolCallId)}
							label="Review & submit"
							active={onReview}
							answered={false}
							onClick={() => setTab(reviewTab)}
						/>
					</div>
				) : null}

				<div
					{...(multipleQuestions
						? {
								role: "tabpanel",
								id: panelDomId(toolCallId),
								"aria-labelledby": tabDomId(toolCallId, onReview ? "review" : idx),
							}
						: {})}
					className="flex flex-col gap-md p-md"
				>
					{onReview ? (
						<ReviewView
							questions={questions}
							answers={answers}
							submitEnabled={canSubmit}
							onJump={setTab}
						/>
					) : (
						<QuestionBody
							question={q}
							state={state}
							pageKeys={multipleQuestions}
							onSelect={(label, cursor) =>
								patch(idx, { cursor, option: label, customActive: false })
							}
							onToggleMulti={(label, cursor) =>
								patch(idx, {
									cursor,
									multi: state.multi.includes(label)
										? state.multi.filter((item) => item !== label)
										: [...state.multi, label],
								})
							}
							onCursor={(cursor) => {
								if (cursor !== state.cursor) patch(idx, { cursor });
							}}
							onConfirmChoice={confirmChoice}
							onCustomText={(text) => patch(idx, customTextPatch(text))}
							onToggleCustom={() => patch(idx, { customActive: !state.customActive })}
							onConfirmCustom={confirmCustom}
							onOpenNote={(label, cursor) =>
								patch(idx, {
									cursor,
									option: label,
									customActive: false,
									noteFor: label,
								})
							}
							onCloseNote={() => patch(idx, { noteFor: null })}
							onNote={(label, text) => patch(idx, { notes: { ...state.notes, [label]: text } })}
						/>
					)}

					<div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
						<ModeHint
							question={onReview ? undefined : q}
							review={onReview}
							multipleQuestions={multipleQuestions}
							noteAvailable={
								!onReview && answers.some((a) => a.questionIndex === idx && a.kind === "option")
							}
						/>
						<div className="flex items-center justify-end gap-md">
							{nudgeVisible ? (
								<span
									aria-hidden={nudgeSpoken || undefined}
									data-testid="ask-needs-choice"
									className="shrink-0 whitespace-nowrap text-feedback-warning tr-text-metadata"
								>
									Choose an option first
								</span>
							) : null}
							<span role="status" aria-live="polite" className="sr-only">
								{nudgeVisible && nudgeSpoken ? "Choose an option first." : ""}
							</span>
							<button
								type="button"
								data-testid="ask-skip"
								onClick={() => reply({ answers: [], cancelled: true })}
								disabled={!actions}
								className="shrink-0 rounded-[var(--radius-sm)] px-xs text-text-muted tr-text-ui outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text"
							>
								Skip
							</button>
							{showContinue ? (
								<button
									type="button"
									data-testid="ask-continue"
									onClick={() => setTab(Math.min(tab + 1, reviewTab))}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
								>
									Next →
								</button>
							) : (
								<button
									type="button"
									data-testid="ask-submit"
									data-ask-page-focus={onReview && canSubmit ? "true" : undefined}
									onClick={() => reply({ answers, cancelled: false })}
									disabled={!canSubmit}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
								>
									Submit
								</button>
							)}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}

function AttentionLine({ announced }: { announced: boolean }) {
	return (
		<div className="flex items-center gap-xs text-primary tr-text-action">
			<span aria-hidden={announced || undefined} className="flex items-center gap-xs">
				<MessageCircleQuestion className="size-3.5 shrink-0" />
				<span>Your input is needed</span>
				<span className="text-text-muted tr-text-metadata">· Agent is waiting</span>
			</span>
			<span role="status" aria-live="polite" className="sr-only">
				{announced ? "Your input is needed — the agent is waiting." : ""}
			</span>
		</div>
	);
}

function SupersededRecord({ questions }: { questions: AskUserQuestionItem[] }) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone="superseded"
			className="flex flex-col gap-xs text-text-muted tr-text-metadata"
		>
			<div className="flex items-center gap-xs">
				<SkipForward className="size-3.5 shrink-0" />
				Superseded — you replied in chat instead of answering these.
			</div>
			{questions.map((q) => (
				<div key={q.question} className="pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted">
					{q.question}
				</div>
			))}
		</div>
	);
}

function WaitingCard({ children }: { children: React.ReactNode }) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone="pending"
			role="status"
			className="flex items-center gap-xs rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg px-md py-sm text-text-muted tr-text-metadata"
		>
			<MessageCircleQuestion className="size-3.5 shrink-0" />
			{children}
		</div>
	);
}

function ComposingCard({ count }: { count: number }) {
	return (
		<div className="flex flex-col gap-xs">
			<div className="text-text-muted tr-text-metadata">Agent is preparing questions…</div>
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg px-md py-sm"
			>
				<div className="flex items-center gap-xs text-text-muted tr-text-metadata">
					<MessageCircleQuestion className="size-3.5 shrink-0" />
					Preparing questions…{count > 0 ? ` (${count} ready)` : ""}
				</div>
				<div className="flex animate-pulse flex-col gap-xs" aria-hidden="true">
					<div className="h-8 rounded-[var(--radius-sm)] bg-control-bg-selected" />
					<div className="h-8 rounded-[var(--radius-sm)] bg-control-bg-selected" />
				</div>
			</div>
		</div>
	);
}

function TabChip({
	id,
	controls,
	label,
	active,
	answered,
	onClick,
}: {
	id: string;
	controls: string;
	label: string;
	active: boolean;
	answered: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			id={id}
			aria-controls={controls}
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			data-testid="ask-tab"
			data-active={active}
			data-answered={answered}
			onClick={onClick}
			className={cn(
				"flex shrink-0 items-center gap-xs whitespace-nowrap rounded-full px-sm py-0.5 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-muted hover:bg-control-bg-hovered",
			)}
		>
			<span
				className={cn(
					"flex size-3.5 items-center justify-center rounded-full border",
					answered ? "border-primary text-primary" : "border-border-default",
				)}
			>
				{answered ? <Check className="size-2.5" /> : null}
			</span>
			{label}
		</button>
	);
}

function ModeHint({
	question,
	review,
	multipleQuestions,
	noteAvailable,
}: {
	question: AskUserQuestionItem | undefined;
	review: boolean;
	multipleQuestions: boolean;
	noteAvailable: boolean;
}) {
	if (review) {
		return (
			<span
				data-testid="ask-shortcuts"
				className="flex items-center gap-xs text-text-muted tr-text-metadata"
			>
				<ListChecks className="size-3.5 shrink-0" />
				Review · ←→ questions · Enter submit · Shift+Esc skip · Tab actions
			</span>
		);
	}
	const multiSelect = !!question?.multiSelect;
	return (
		<span
			data-testid="ask-shortcuts"
			className="flex flex-wrap items-center gap-xs text-text-muted tr-text-metadata"
		>
			{multiSelect ? (
				<ListChecks className="size-3.5 shrink-0" />
			) : (
				<CircleDot className="size-3.5 shrink-0" />
			)}
			<span>↑↓ move incl. Other</span>
			<span>· Space {multiSelect ? "toggle" : "select"}</span>
			<span>· Enter confirm</span>
			<span>· Tab {noteAvailable ? "note/actions" : "actions"}</span>
			<span>· Shift+Esc skip</span>
			{multipleQuestions ? <span>· ←→ questions</span> : null}
		</span>
	);
}

function QuestionBody({
	question,
	state,
	pageKeys,
	onSelect,
	onToggleMulti,
	onCursor,
	onConfirmChoice,
	onCustomText,
	onToggleCustom,
	onConfirmCustom,
	onOpenNote,
	onCloseNote,
	onNote,
}: {
	question: AskUserQuestionItem;
	state: QState;
	pageKeys: boolean;
	onSelect: (label: string, cursor: number) => void;
	onToggleMulti: (label: string, cursor: number) => void;
	onCursor: (cursor: number) => void;
	onConfirmChoice: (label: string, cursor: number) => void;
	onCustomText: (text: string) => void;
	onToggleCustom: () => void;
	onConfirmCustom: () => void;
	onOpenNote: (label: string, cursor: number) => void;
	onCloseNote: () => void;
	onNote: (label: string, text: string) => void;
}) {
	const choiceRefs = useRef<Array<HTMLElement | null>>([]);
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const focusNoteAfterRender = useRef(false);
	const otherIndex = question.options.length;
	const choiceCount = otherIndex + 1;
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const customOwnsPageFocus =
		state.customActive && (!question.multiSelect || state.multi.length === 0);
	const noteIndex = question.multiSelect
		? -1
		: question.options.findIndex((option) => option.label === state.option);
	const noteOption = noteIndex < 0 ? undefined : question.options[noteIndex];
	const anyPreview = !question.multiSelect && question.options.some((option) => option.preview);
	const previewSource =
		question.options.find((option) => option.label === state.option && option.preview) ??
		question.options.find((option) => option.preview);

	useEffect(() => {
		if (!focusNoteAfterRender.current || !noteRef.current) return;
		focusNoteAfterRender.current = false;
		noteRef.current.focus({ preventScroll: true });
	});

	const openNote = (label: string, index: number) => {
		focusNoteAfterRender.current = true;
		onOpenNote(label, index);
	};

	const focusChoice = (index: number) => {
		if (index < otherIndex) onCursor(index);
		choiceRefs.current[index]?.focus({ preventScroll: true });
	};

	const finishNote = (index: number) => {
		onCloseNote();
		requestAnimationFrame(() => choiceRefs.current[index]?.focus({ preventScroll: true }));
	};

	const onChoiceKeyDown = (
		event: KeyboardEvent<HTMLButtonElement>,
		label: string,
		index: number,
	) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const action = choiceKeyAction(event.key, index, choiceCount);
		if (action.type === "none") return;
		event.preventDefault();
		if (action.type === "move") focusChoice(action.index);
		else if (action.type === "select") {
			if (question.multiSelect) onToggleMulti(label, index);
			else onSelect(label, index);
		} else if (action.type === "confirm") onConfirmChoice(label, index);
	};

	return (
		<div className="flex flex-col gap-md">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-text-muted" />
				<p data-testid="ask-question-text" className="tr-title-dialog text-text-default">
					{question.question}
				</p>
			</div>
			<div className={cn("grid gap-sm", anyPreview && "md:grid-cols-2")}>
				<div className="flex min-w-0 flex-col gap-sm">
					<div
						role="listbox"
						aria-multiselectable={!!question.multiSelect}
						aria-label={question.question}
						className="flex flex-col gap-sm"
					>
						{question.options.map((option, index) => {
							const selected = question.multiSelect
								? state.multi.includes(option.label)
								: state.option === option.label;
							const ownsCursor = index === cursor;
							return (
								<OptionRow
									key={option.label}
									buttonRef={(node) => {
										choiceRefs.current[index] = node;
									}}
									label={option.label}
									description={option.description}
									recommendedReason={option.recommendedReason}
									selected={selected}
									cursor={ownsCursor}
									pageFocus={ownsCursor && !customOwnsPageFocus}
									multi={!!question.multiSelect}
									pageKeys={pageKeys}
									onFocus={() => onCursor(index)}
									onKeyDown={(event) => onChoiceKeyDown(event, option.label, index)}
									onClick={() =>
										question.multiSelect
											? onToggleMulti(option.label, index)
											: onSelect(option.label, index)
									}
								/>
							);
						})}
					</div>

					{noteOption ? (
						<div className="pl-[calc(1.125rem+var(--spacing-sm))]">
							{state.noteFor === noteOption.label ? (
								<textarea
									ref={noteRef}
									data-testid="ask-note"
									aria-label={`Note for ${splitRecommended(noteOption.label).text}`}
									aria-keyshortcuts="Enter Shift+Enter Escape"
									rows={2}
									value={state.notes[noteOption.label] ?? ""}
									placeholder="Add a note for the model…"
									onChange={(event) => onNote(noteOption.label, event.target.value)}
									onKeyDown={(event) => {
										const action = noteKeyAction(
											event.key,
											event.shiftKey,
											event.nativeEvent.isComposing,
										);
										if (action === "none") return;
										event.stopPropagation();
										if (action === "consume") return;
										event.preventDefault();
										finishNote(noteIndex);
									}}
									className="w-full resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs text-text-default tr-text-metadata outline-none focus-visible:border-control-border-active"
								/>
							) : (
								<button
									type="button"
									data-testid="ask-note-toggle"
									onClick={() => openNote(noteOption.label, noteIndex)}
									className="flex items-center gap-xs rounded-[var(--radius-sm)] text-text-muted tr-text-metadata outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
								>
									<Pencil className="size-3" />
									{state.notes[noteOption.label]?.trim() ? "Edit note" : "Add note"}
								</button>
							)}
						</div>
					) : null}

					<OtherOptionRow
						inputRef={(node) => {
							choiceRefs.current[otherIndex] = node;
						}}
						multi={!!question.multiSelect}
						active={state.customActive}
						text={state.customText}
						pageFocus={question.options.length === 0 || customOwnsPageFocus}
						onToggle={onToggleCustom}
						onText={onCustomText}
						onMove={(key) => {
							const action = choiceKeyAction(key, otherIndex, choiceCount);
							if (action.type === "move") focusChoice(action.index);
						}}
						onConfirm={onConfirmCustom}
					/>
				</div>

				{anyPreview && previewSource?.preview ? (
					<div
						data-testid="ask-preview"
						className="min-w-0 overflow-auto rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-metadata"
					>
						<div className="mb-xs text-text-muted tr-text-metadata">
							Preview · {previewSource.label}
						</div>
						<Markdown text={previewSource.preview} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function OptionRow({
	buttonRef,
	label,
	description,
	recommendedReason,
	selected,
	cursor,
	pageFocus,
	multi,
	pageKeys,
	onFocus,
	onKeyDown,
	onClick,
}: {
	buttonRef: (node: HTMLButtonElement | null) => void;
	label: string;
	description: string;
	recommendedReason?: string | undefined;
	selected: boolean;
	cursor: boolean;
	pageFocus: boolean;
	multi: boolean;
	pageKeys: boolean;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onClick: () => void;
}) {
	const { text, recommended, reason } = readRecommendation({ label, recommendedReason });
	return (
		<button
			ref={buttonRef}
			type="button"
			role="option"
			aria-selected={selected}
			aria-keyshortcuts={`ArrowUp ArrowDown Home End Space Enter${pageKeys ? " ArrowLeft ArrowRight" : ""} Shift+Escape`}
			tabIndex={cursor ? 0 : -1}
			data-testid="ask-option"
			data-selected={selected}
			data-cursor={cursor}
			data-ask-page-focus={pageFocus || undefined}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			onClick={onClick}
			className={cn(
				"flex items-start gap-sm rounded-[var(--radius-sm)] border px-md py-sm text-left outline-none transition-colors focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary",
				selected
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			<Indicator selected={selected} multi={multi} />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="flex items-center gap-xs">
					<span data-testid="ask-option-label" className="tr-text-ui text-text-default">
						{text}
					</span>
					{recommended ? <RecommendedBadge /> : null}
				</span>
				{description ? (
					<span className="text-text-muted tr-text-metadata">{description}</span>
				) : null}
				{reason ? (
					<span
						data-testid="ask-recommended-reason"
						className="mt-0.5 text-text-muted tr-text-metadata"
					>
						<span className="tr-text-emphasis text-primary">Why:</span> {reason}
					</span>
				) : null}
			</span>
		</button>
	);
}

function OtherOptionRow({
	inputRef,
	multi,
	active,
	text,
	pageFocus,
	onToggle,
	onText,
	onMove,
	onConfirm,
}: {
	inputRef: (node: HTMLInputElement | null) => void;
	multi: boolean;
	active: boolean;
	text: string;
	pageFocus: boolean;
	onToggle: () => void;
	onText: (text: string) => void;
	onMove: (key: "ArrowUp" | "ArrowDown") => void;
	onConfirm: () => void;
}) {
	const inputId = useId();
	return (
		<label
			htmlFor={inputId}
			data-testid="ask-custom-row"
			data-selected={active}
			className={cn(
				"flex cursor-text items-center gap-sm rounded-[var(--radius-sm)] border px-md py-sm transition-colors focus-within:border-control-border-active focus-within:ring-2 focus-within:ring-primary",
				active
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			{multi ? (
				<button
					type="button"
					data-testid="ask-custom-toggle"
					aria-label={active ? "Exclude your own answer" : "Include your own answer"}
					onClick={(e) => {
						e.preventDefault();
						onToggle();
					}}
					className="flex items-center rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<Indicator selected={active} multi className="mt-0" />
				</button>
			) : (
				<Indicator selected={active} multi={false} className="mt-0" />
			)}
			<span className="tr-text-ui text-text-default">Other</span>
			<input
				ref={inputRef}
				id={inputId}
				data-testid="ask-custom"
				data-ask-page-focus={pageFocus || undefined}
				aria-label="Other answer"
				aria-keyshortcuts="ArrowUp ArrowDown Enter Shift+Escape"
				value={text}
				placeholder="type your own answer…"
				onChange={(event) => onText(event.target.value)}
				onKeyDown={(event) => {
					if (
						(event.key === "ArrowUp" || event.key === "ArrowDown") &&
						!event.shiftKey &&
						!event.altKey &&
						!event.ctrlKey &&
						!event.metaKey
					) {
						event.preventDefault();
						onMove(event.key);
						return;
					}
					if (event.key === "Enter" && !event.nativeEvent.isComposing) {
						event.preventDefault();
						onConfirm();
					}
				}}
				className="min-w-0 flex-1 border-none bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
			/>
		</label>
	);
}

const RECOMMENDED_PILL =
	"inline-flex items-center rounded-full bg-primary-subtle px-xs py-0 tr-text-label-pill text-primary";

function RecommendedBadge() {
	return <span className={RECOMMENDED_PILL}>Recommended</span>;
}

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
					selected ? "border-primary bg-primary text-text-on-primary" : "border-border-default",
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
				selected ? "border-primary" : "border-border-default",
				className,
			)}
		>
			{selected ? <span className="size-2 rounded-full bg-primary" /> : null}
		</span>
	);
}

function ReviewView({
	questions,
	answers,
	submitEnabled,
	onJump,
}: {
	questions: AskUserQuestionItem[];
	answers: AskUserQuestionAnswer[];
	submitEnabled: boolean;
	onJump: (index: number) => void;
}) {
	const byIndex = new Map(answers.map((a) => [a.questionIndex, a]));
	const unanswered = questions.map((q, i) => ({ q, i })).filter(({ i }) => !byIndex.has(i));
	return (
		<div className="flex flex-col gap-sm">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-text-muted" />
				<p data-testid="ask-review-title" className="tr-title-dialog text-text-default">
					Review your answers
				</p>
			</div>
			<ul className="flex flex-col gap-md">
				{questions.map((q, i) => (
					<li key={q.question} data-testid="ask-review-item" className="flex flex-col gap-xs">
						<span className="text-text-muted tr-text-metadata">{q.header || `Q${i + 1}`}</span>
						<QuestionRecap question={q} answer={byIndex.get(i)} variant="review" />
					</li>
				))}
			</ul>
			{unanswered.length > 0 ? (
				<button
					type="button"
					data-testid="ask-unanswered"
					data-ask-page-focus={submitEnabled ? undefined : "true"}
					onClick={() => onJump(unanswered[0]?.i ?? 0)}
					className="self-start rounded-[var(--radius-sm)] text-feedback-warning tr-text-metadata outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
				>
					⚠ Unanswered: {unanswered.map(({ q, i }) => q.header || `Q${i + 1}`).join(", ")}
				</button>
			) : null}
		</div>
	);
}

function ResolvedRecord({
	questions,
	result,
	rawText,
}: {
	questions: AskUserQuestionItem[];
	result: AskUserQuestionResult | null;
	rawText: string;
}) {
	if (!result) {
		return (
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="text-text-muted tr-text-metadata"
			>
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
				<QuestionRecap key={q.question} question={q} answer={byIndex.get(i)} variant="resolved" />
			))}
			{questions.length === 0 ? (
				<div className="text-text-muted tr-text-metadata">{rawText || "Answered."}</div>
			) : null}
		</div>
	);
}

function QuestionRecap({
	question,
	answer,
	variant,
}: {
	question: AskUserQuestionItem;
	answer: AskUserQuestionAnswer | undefined;
	variant: "review" | "resolved";
}) {
	const reviewing = variant === "review";
	const { selectedLabels, customAnswer, showOptions } = deriveRecapState(answer, variant);
	const selected = new Set(selectedLabels);

	return (
		<div className="flex flex-col gap-xs">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
				<p
					data-testid={reviewing ? "ask-review-question" : undefined}
					className={cn("tr-text-ui", reviewing ? "text-text-default" : "text-text-muted")}
				>
					{question.question}
				</p>
			</div>
			{showOptions ? (
				<>
					<ul className="flex flex-col gap-0.5 pl-[calc(0.875rem+var(--spacing-sm))]">
						{question.options.map((opt) => {
							const isSel = selected.has(opt.label);
							return (
								<li
									key={opt.label}
									data-testid={reviewing ? "ask-review-option" : "ask-record-option"}
									data-selected={isSel}
									className={cn(
										"flex items-center gap-xs tr-text-ui",
										isSel ? "text-text-default" : "text-text-muted",
									)}
								>
									{isSel ? (
										<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
									) : (
										<span
											aria-hidden="true"
											className="size-3 shrink-0 rounded-full border border-border-default"
										/>
									)}
									<span data-testid="ask-selection-status" className="sr-only">
										{isSel ? "Selected: " : "Not selected: "}
									</span>
									<span>{splitRecommended(opt.label).text}</span>
								</li>
							);
						})}
						{customAnswer ? (
							<li
								data-testid={reviewing ? "ask-review-custom" : "ask-record-custom"}
								className="flex items-center gap-xs tr-text-ui text-text-default"
							>
								<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
								<span data-testid="ask-selection-status" className="sr-only">
									Selected custom answer:{" "}
								</span>
								<span>“{customAnswer}”</span>
							</li>
						) : null}
					</ul>
					{!answer ? (
						<div
							data-testid="ask-review-unanswered"
							className="flex items-center gap-xs pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata italic"
						>
							<SkipForward className="size-3 shrink-0" /> Not answered
						</div>
					) : null}
				</>
			) : !answer ? (
				<div className="flex items-center gap-xs pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata italic">
					<SkipForward className="size-3 shrink-0" /> No answer (skipped).
				</div>
			) : (
				<div className="flex items-center gap-xs border-border-default border-l-2 pl-sm">
					<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
					<span data-testid="ask-selection-status" className="sr-only">
						Selected custom answer:{" "}
					</span>
					<span className="tr-text-ui text-text-default">“{answer.answer}”</span>
				</div>
			)}
			{answer?.notes ? (
				<div className="pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata">
					Note: {answer.notes}
				</div>
			) : null}
		</div>
	);
}
