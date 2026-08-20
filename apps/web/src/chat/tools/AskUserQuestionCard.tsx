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

// The inline `ask_user_question` questionnaire — the browser side of the host-owned tool. Rendered as a
// "bare" tool card (see the tool registry `chrome`), so it's a full-width, always-open panel rather than a
// folded card. Styled after the app's inline prompt-card spec: the question IS the card header, options are
// radio/checkbox rows (the recommended one badged) closed by a mandatory native "Other" row (same
// radio/checkbox indicator, inline free-text field), a footer with a mode hint + Skip/Next/Submit, and
// compact, borderless "record" states once resolved.
//
// The tool is **ack + terminate** (its own result is just an ack; the turn ends), so the card's lifecycle
// derives from the TRANSCRIPT, not the tool status: `useAskState` supplies the reply (an
// `ask-user-answers` message pairs by tool call id) or the superseded verdict (a later free-form user
// message closed the questionnaire). With neither, the card is "awaiting" — answerable now, after a
// reconnect, or after any number of host restarts. Legacy transcripts (the blocking-era tool, validation
// errors, restart-repaired declines) carry a final result in the tool result itself and render as the
// same resolved record. Presentational: reads the questions from the tool-call `args`, replies through
// the `ChatActions` context (provided by `ChatView`) — never the store/transport directly.

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

/**
 * Read an option's recommendation: its display text, whether it's recommended, and the optional "why".
 * A non-empty `recommendedReason` **implies** recommended (defensive — a model that authors a reason but
 * forgets the "(Recommended)" suffix must not silently lose the badge). Pure.
 */
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

/** Per-question local UI state. Already public through `deriveAnswer`/`confirmStateFor`. */
export interface QState {
	/** Selected single-select option label. */
	option: string | null;
	/** Free-text ("Type your own answer") value + whether it's the active answer. */
	customText: string;
	customActive: boolean;
	/** Selected labels for a multi-select question. */
	multi: string[];
	/** The authored choice that owns the roving Tab stop. */
	cursor: number;
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
	cursor: 0,
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

/** Derive every currently answerable question from a sparse card-state map. Pure. */
export function deriveAnswers(
	questions: AskUserQuestionItem[],
	states: Record<number, QState>,
): AskUserQuestionAnswer[] {
	return questions
		.map((question, index) => deriveAnswer(question, index, states[index] ?? emptyQState()))
		.filter((answer): answer is AskUserQuestionAnswer => answer != null);
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

interface RecapState {
	selectedLabels: string[];
	customAnswer: string | null;
	showOptions: boolean;
}

/** Derive the shared review/resolved recap model from one structured answer. Pure. */
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

/** Claude-style choice key reducer. The count includes the synthetic final Other input target. */
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

/**
 * How typed text in the mandatory "Other" row moves the question's state. **Text, never focus, is what
 * makes Other the answer:** ↑/↓/Home/End wrap *through* the row, so activating on focus would clear a
 * single-select pick and paint an empty row as chosen just for passing over it. Emptying the field hands
 * the row back (`deriveAnswer` ignores blank text either way, so a checked-looking empty row is a lie).
 * Multi-select keeps its explicit checkbox for excluding text it should not submit. Pure.
 */
export function customTextPatch(text: string): Partial<QState> {
	return text.trim()
		? { customText: text, customActive: true, option: null }
		: { customText: text, customActive: false };
}

/** Where a confirm gesture came from: a choice row (with the focused label) or the Other row. */
export type ConfirmSource = { kind: "choice"; label: string; cursor: number } | { kind: "custom" };

/**
 * The question state a confirm gesture commits — the single place both Enter paths agree on what "confirm
 * what this question has" means.
 *
 * From a **choice row**: single-select chooses the focused label as it confirms (and drops Other); a
 * multi-select confirms the set it already has, since Space, not Enter, is its toggle.
 *
 * From the **Other row**: the state exactly as it stands. Deliberately *not* re-derived from the text via
 * `customTextPatch` — `onCustomText` already keeps `customActive` in step with every keystroke, so
 * re-patching here could only ever contradict the row the user is looking at: it would resurrect
 * multi-select text they had explicitly unchecked (the one thing that checkbox is for), and on single-select
 * it would submit text left over from an earlier edit while the card still paints the option picked after
 * it. Text — never focus, and never a stale value — is what makes Other the answer. Pure.
 */
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

/**
 * Note editor keys: Enter and Escape finish; Shift+Enter stays available for a newline. **Escape finishes
 * with Shift held too** — the card reads `Shift+Escape` as "skip the questionnaire", and the innermost
 * open thing must close first, or the gesture would throw away the note the user is still typing.
 *
 * **Escape belongs to the editor even mid-IME-composition** — as `"consume"` rather than `"finish"`. There
 * the IME owns the key (it cancels the composition) so the note must stay open, but the gesture still may
 * not reach the card: declining not to *finish* while also declining to *swallow* would let `Shift+Escape`
 * bubble out and take the whole questionnaire down with the text being composed — the exact loss the
 * Shift-held rule above exists to prevent, through the one door left open.
 */
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

/** A confirm gesture that had nothing to confirm, stamped so a repeat is a distinct state (see below). */
export interface ChoiceNudge {
	/** The question that raised it — the complaint belongs to that page and travels with it, not the card. */
	question: number;
	/** Bumped per gesture: a *second* fruitless confirm must re-arm the timer and re-announce. */
	seq: number;
}

/**
 * Whether the "choose an option first" complaint belongs on the page currently shown. Scoped to the
 * question that raised it: paging on within its 2.5s life must not carry the complaint to a question the
 * user never tried to confirm. Pure.
 */
export function nudgeShowsOnPage(
	nudge: ChoiceNudge | null,
	page: number,
	onReview: boolean,
	answered: boolean,
): boolean {
	return !!nudge && !onReview && nudge.question === page && !answered;
}

/** Left/Right page navigation across real questions plus the synthetic review page; edges clamp. */
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

/**
 * Whether attention may move focus, given what holds it and what kind of pointer this is. Pure policy,
 * DOM adapters below. A **coarse pointer never gives up focus**: on a phone there is no keyboard flow to
 * hand off to, and focusing a row (the Other input especially) raises the soft keyboard and shoves the
 * viewport at someone who was reading. The reveal + scroll-into-view still happen — that is the whole
 * attention treatment on touch. (Page changes are exempt: those *follow* a tap the user just made.)
 */
export function shouldClaimQuestionFocus(
	target: QuestionFocusTarget,
	coarsePointer: boolean,
): boolean {
	if (coarsePointer) return false;
	return target === "none" || target === "non-editing" || target === "empty-composer";
}

/**
 * Whether a **page change** may focus that page's landing target. It follows a gesture the user just made,
 * so unlike the initial claim it may move focus on touch — except into a text field, which raises the soft
 * keyboard the reveal path avoids (page away from a typed-in Other row and back, and that is the target).
 */
export function shouldFocusPageTarget(textEntryTarget: boolean, coarsePointer: boolean): boolean {
	return !(textEntryTarget && coarsePointer);
}

// Tab↔panel wiring ids. Several cards can be on screen at once, so both are qualified by the tool call.
const panelDomId = (toolCallId: string) => `ask-panel-${toolCallId}`;
const tabDomId = (toolCallId: string, page: number | "review") => `ask-tab-${toolCallId}-${page}`;

/** A per-mounted-chat, per-tool-call one-shot attention registry (WeakMap lets closed chats disappear). */
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
// Enough time for a closing Radix menu/focus scope to release focus after it reopens a chat.
const ATTENTION_SETTLE_FRAMES = 30;
/**
 * Surfaces that own focus for as long as they are open — a dialog, a menu, or another choice list (which
 * includes a *second* questionnaire mid-answer). A card revealing itself behind one never takes focus.
 */
const MODAL_SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function focusTargetKind(active: Element | null, card: HTMLElement): QuestionFocusTarget {
	if (!active || active === document.body) return "none";
	if (card.contains(active)) return "non-editing";
	if (!(active instanceof HTMLElement)) return "editing";
	// An *open* dialog/menu is answered by leaving it alone: its own focus scope would fight back for as
	// long as the settle loop retries, and an untrapped popover would simply lose focus mid-interaction.
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

/** Touch/pen as the *primary* pointer — i.e. a phone or tablet, not a laptop that happens to have a screen. */
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
	const ask = useAskState(toolCallId);
	const providedFocusScope = useAskFocusScope();
	const localFocusScope = useRef<object>({}).current;
	const focusScope = providedFocusScope ?? localFocusScope;
	const cardRef = useRef<HTMLElement>(null);
	const questions = useMemo(() => parseQuestions(args), [args]);
	// The reply, wherever it lives: the transcript's ask-user-answers message (ack + terminate design), or
	// the tool result itself (legacy blocking-era transcripts, validation errors, restart-repaired declines).
	const resolvedResult = ask?.answer ?? readAskResult(result);
	// Awaiting = shown and unanswered: interactive until a reply or a superseding user message exists. A
	// dead call (aborted/errored owning message → status "error") is terminal, never answerable.
	const awaiting = !resolvedResult && !ask?.superseded && status !== "error";
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
	// Set once by the attention claim below (never cached): the spoken half of "your input is needed".
	const [announced, setAnnounced] = useState(false);
	// A confirm gesture that had nothing to confirm — shown briefly so Enter is never a silent no-op.
	const [nudge, setNudge] = useState<ChoiceNudge | null>(null);
	// The nudge's spoken half, a frame behind the visible one — same reason as the attention line's.
	const [nudgeSpoken, setNudgeSpoken] = useState(false);
	const nudgeSeq = useRef(0);
	const previousTab = useRef(tab);
	// Set when a failed send un-latches the form: the reply had already handed focus to the composer, so
	// the card has to take it back — its one-shot attention claim is long spent and cannot do it.
	const reclaimFocusAfterFailedSend = useRef(false);

	useEffect(() => {
		if (awaiting) cardStateCache.set(toolCallId, { states, tab, submitted });
		else cardStateCache.delete(toolCallId);
	}, [toolCallId, awaiting, states, tab, submitted]);

	// The "pick something first" nudge is transient: it answers one keystroke, then gets out of the way.
	// Keyed on the whole `nudge` object, so a repeat gesture (new `seq`) re-enters here: the region is
	// emptied for a frame and refilled, and only that *change* makes a screen reader speak the second
	// keystroke — an identical live-region string is silence, which is the no-op this nudge exists to end.
	// Re-arming the timeout on the same pass is what keeps the complaint alive as long as it is being made.
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

	// A send that failed put the form back; focus went to the composer at reply time, so bring it back to
	// the choice the user was standing on — otherwise the card silently reappears with nobody on it.
	useEffect(() => {
		if (!reclaimFocusAfterFailedSend.current || submitted) return;
		reclaimFocusAfterFailedSend.current = false;
		const card = cardRef.current;
		if (card) focusQuestionAttention(card);
	});

	// A user-driven page change hands focus to that page's selected/first choice (or review heading).
	// Initial attention is handled separately below so its focus-theft guard can make the decision.
	useEffect(() => {
		if (previousTab.current === tab) return;
		previousTab.current = tab;
		const frame = requestAnimationFrame(() => {
			if (cardRef.current) focusCurrentQuestionPage(cardRef.current);
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

	// Claim attention exactly once per mounted chat + call. The claim happens inside scheduled work so
	// React StrictMode's setup/cleanup replay cannot spend it while cancelling the first frame. Marking it
	// before the editing check remains deliberate: a protected draft must not be surprised later.
	useEffect(() => {
		if (!awaiting || streaming || questions.length === 0 || submitted) return;
		let frame: number | null = null;
		let attempts = 0;
		// The retry window below exists to out-wait a *closing focus scope*, never the user. Any real input
		// during it means focus is where they just put it, and a later retry would yank it back out from
		// under the click/keystroke they were making — so the first genuine gesture ends the claim.
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
			// A menu's modal focus scope can reject focus until its close finishes. Retry only inside this
			// one attention claim, always rechecking that the user has not started editing in the meantime.
			attempts += 1;
			if (attempts < ATTENTION_SETTLE_FRAMES) frame = requestAnimationFrame(settleFocus);
		};
		frame = requestAnimationFrame(() => {
			if (!claimQuestionAttention(focusScope, toolCallId)) return;
			// The same one-shot governs the spoken announcement: filling an already-mounted live region a
			// frame after reveal is what makes it announce at all (a region inserted *with* its text is
			// unreliable), and spending the claim here means a Virtuoso remount cannot say it again.
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
		// Answering unmounts the form, and with it whatever the user was standing on — focus would revert to
		// `<body>` and swallow every following keystroke, right after a keyboard-only questionnaire. So the
		// composer takes it back, while the card is still mounted, on the two conditions that make it a
		// hand-off rather than a hijack: the card still holds focus, and that focus is *visible* — the same
		// `:focus-visible` signal every ring in this card is drawn from, i.e. the user got here by keyboard.
		// A tap/click answer leaves focus alone, so touch keeps its soft keyboard down.
		const held = document.activeElement;
		const handedOff = !!held && !!cardRef.current?.contains(held) && held.matches(":focus-visible");
		if (handedOff) actions.focusComposer();
		setSubmitted(true);
		// Un-latch on a failed send (host rejected the session / transport down) so the user can retry — and
		// undo the hand-off with it, or the form returns with the keyboard parked in the composer.
		actions.answerQuestion(toolCallId, r).catch(() => {
			reclaimFocusAfterFailedSend.current = handedOff;
			setSubmitted(false);
		});
	};

	// Answered (here or on another client) / legacy-resolved → a compact, read-only record.
	if (resolvedResult) {
		return (
			<ResolvedRecord questions={questions} result={resolvedResult} rawText={resultText(result)} />
		);
	}
	// A later free-form user message replaced the answer — terminal, matching the host-side verdict.
	if (ask?.superseded) return <SupersededRecord questions={questions} />;
	// Dead call (the owning message aborted/errored — pi never ran it): a closed record, never a form.
	if (status === "error") {
		return <ResolvedRecord questions={questions} result={null} rawText={resultText(result)} />;
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

	const multipleQuestions = questions.length > 1;
	const reviewTab = questions.length; // synthetic "Review & submit" tab index
	const onReview = tab >= reviewTab;
	const idx = Math.min(tab, questions.length - 1);
	const q = questions[idx];
	const state = stateFor(idx);
	if (!q) return <WaitingCard>Preparing questions…</WaitingCard>;

	// A multi-question questionnaire always advances through its synthetic review step; only that step
	// submits. Single-question cards retain their direct Submit action.
	const showContinue = multipleQuestions && !onReview;
	const canSubmit =
		!!actions && (onReview || !multipleQuestions ? answers.length > 0 : answeredIndices.has(idx));
	// Derived once: the visible nudge and its live region must never disagree about whether it is showing.
	const nudgeVisible = nudgeShowsOnPage(nudge, idx, onReview, answeredIndices.has(idx));

	// Confirm advances (or submits) only what it can actually derive; the write is the *value* the decision
	// was made from, not a `prev => …` update, so what lands can never disagree with what we advanced on.
	const confirmQuestion = (nextState: QState) => {
		const nextStates = { ...states, [idx]: nextState };
		const nextAnswers = deriveAnswers(questions, nextStates);
		if (!nextAnswers.some((answer) => answer.questionIndex === idx)) {
			// Nothing to confirm — an empty multi-select set, or Enter in an untouched Other row. Say so
			// instead of swallowing the keystroke, and keep the partial state exactly as the user left it.
			// A fresh `seq` every time, so the Nth fruitless keystroke is answered as visibly as the first.
			nudgeSeq.current += 1;
			setNudge({ question: idx, seq: nudgeSeq.current });
			return;
		}
		setNudge(null);
		setStates(nextStates);
		if (multipleQuestions) setTab(Math.min(idx + 1, reviewTab));
		else reply({ answers: nextAnswers, cancelled: false });
	};

	// Both Enter paths route through one reducer, so "confirm what this question has" cannot mean two things.
	const confirmChoice = (label: string, cursor: number) =>
		confirmQuestion(confirmStateFor(state, !!q.multiSelect, { kind: "choice", label, cursor }));

	const confirmCustom = () =>
		confirmQuestion(confirmStateFor(state, !!q.multiSelect, { kind: "custom" }));

	const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		// A keystroke the IME is currently composing is never a card gesture — it belongs to the text being
		// written. The note editor consumes its own Escape (`noteKeyAction`), but the Other field has no inner
		// guard, and skipping is destructive enough that it must not fire off a key the user aimed at an IME.
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

				{/* The questions' shared body IS the tablist's panel. Activation is automatic (a chip's
				    arrow/click switches page outright), and focus follows into the panel rather than staying
				    on the chip — the page, not the chip, is what the user came to act on. */}
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
							// Picking an authored option deactivates "Other" but keeps its text (cheap to re-activate).
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
							// Read off the derived answers rather than re-deriving "is a valid option picked?":
							// `kind === "option"` is exactly the state that renders an Add/Edit note control.
							noteAvailable={
								!onReview && answers.some((a) => a.questionIndex === idx && a.kind === "option")
							}
						/>
						<div className="flex items-center justify-end gap-md">
							{/* Sits beside the action the keystroke was aiming at, so the answer to "why did
							    nothing happen?" is where the user is already looking. It clears the moment the
							    question becomes answerable (the complaint is stale), and times out otherwise.
							    Spoken by the region below, not by announcing itself: the visible copy yields
							    the accessibility tree once that region has the text, so never both at once. */}
							{nudgeVisible ? (
								<span
									aria-hidden={nudgeSpoken || undefined}
									data-testid="ask-needs-choice"
									className="shrink-0 whitespace-nowrap text-feedback-warning tr-text-metadata"
								>
									Choose an option first
								</span>
							) : null}
							{/* Out of flow (`sr-only` is absolute), so an empty region costs no flex gap. */}
							<span role="status" aria-live="polite" className="sr-only">
								{nudgeVisible && nudgeSpoken ? "Choose an option first." : ""}
							</span>
							<button
								type="button"
								data-testid="ask-skip"
								onClick={() => reply({ answers: [], cancelled: true })}
								disabled={!actions}
								className="shrink-0 rounded-[var(--radius-sm)] px-xs text-text-muted tr-text-ui outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary-soft disabled:text-control-disabled-text"
							>
								Skip
							</button>
							{showContinue ? (
								<button
									type="button"
									data-testid="ask-continue"
									onClick={() => setTab(Math.min(tab + 1, reviewTab))}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary-soft"
								>
									Next →
								</button>
							) : (
								<button
									type="button"
									data-testid="ask-submit"
									// The review page's keyboard landing point is the real Submit control: Enter and
									// Space activate it natively and AT announces a button, where a paragraph wearing
									// `aria-keyshortcuts` announced static text. A review with nothing answered has
									// no Submit to land on and hands the page focus to its "Unanswered" nudge instead.
									data-ask-page-focus={onReview && canSubmit ? "true" : undefined}
									onClick={() => reply({ answers, cancelled: false })}
									disabled={!canSubmit}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
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

/**
 * The active card's visual + assistive-tech announcement that this turn now needs the user. The visible
 * line is plain text and always renders; the spoken half is a **separate, always-mounted live region**
 * that the attention claim fills one frame later, exactly once per mounted chat — so it is announced when
 * it appears (a live region inserted together with its text often is not) and stays quiet through every
 * Virtuoso remount as the user scrolls past a question they already know about.
 *
 * **Exactly one copy is in the accessibility tree**: the visible line goes `aria-hidden` once the region
 * carries the text, so the line is read once — and a remount, where the claim is spent and the region
 * stays empty, still exposes it.
 */
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

/**
 * The terminal record for a questionnaire the conversation moved past: the user replied with their own
 * message instead of answering, so the model was told to treat that message as the reply. Read-only — a
 * late answer would be rejected by the host (`assessAnswerability`) anyway.
 */
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

/** The card frame used for the transient "answer sent" state (no interactive body). */
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

/**
 * The stable placeholder shown while the tool call's args stream: a header with a live ready-count and
 * fixed skeleton rows — never live controls (a form whose labels mutate under the cursor reads as broken).
 * The complete questionnaire replaces it in one shot at message end.
 */
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
				"flex shrink-0 items-center gap-xs whitespace-nowrap rounded-full px-sm py-0.5 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary-soft",
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

/** Compact, context-aware shortcut legend at the bottom of the active card. */
function ModeHint({
	question,
	review,
	multipleQuestions,
	noteAvailable,
}: {
	question: AskUserQuestionItem | undefined;
	review: boolean;
	multipleQuestions: boolean;
	/** Whether an Add/Edit note control is actually on this page — it only exists once a choice is picked. */
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
	/** Whether ←/→ page across questions here — only a multi-question card advertises them to AT. */
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
	// The roving Tab stop stays on an **authored** choice even while focus sits in the Other input (which is
	// natively tabbable and needs no stop of its own) — otherwise the choice list would have no tab stop at
	// all and Tab could never get back into it. Clamped because a card can mount mid-stream, with a cached
	// cursor from more options than the final args carry.
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const customOwnsPageFocus =
		state.customActive && (!question.multiSelect || state.multi.length === 0);
	// The one choice a note can hang on. A label that no longer exists in the args (picked mid-stream, then
	// renamed) owns nothing — the staleness `deriveAnswer` filters, so control and answer agree.
	const noteIndex = question.multiSelect
		? -1
		: question.options.findIndex((option) => option.label === state.option);
	const noteOption = noteIndex < 0 ? undefined : question.options[noteIndex];
	// Previews are a single-select affordance (the pane follows `state.option`); a multi-select question
	// authored with previews anyway renders without the pane rather than with one that never updates.
	const anyPreview = !question.multiSelect && question.options.some((option) => option.preview);
	// Side-by-side preview shows the selected option's preview, else the first option that carries one.
	const previewSource =
		question.options.find((option) => option.label === state.option && option.preview) ??
		question.options.find((option) => option.preview);

	// Focus only in response to an explicit open action. Unlike mount-time autofocus, this does not steal
	// focus when Virtuoso remounts a card whose cached note editor was already open.
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
					{/* A listbox, not a radiogroup: this card's keys ARE the listbox pattern — a roving cursor
					    that moves without committing, Space to select, Enter to confirm — where a radiogroup's
					    arrows select as they move. `aria-selected` per row then means what the indicator draws,
					    and each row is announced with its position in the set.

					    It owns **nothing but `option`s** — a `listbox` may only own `option`/`group`, and a
					    stray textarea/button/input inside one is skipped by some screen readers and corrupts
					    the announced set — so the note editor and the Other row are siblings below it.
					    Movement runs through `choiceRefs`, not DOM containment, so the keys are unaffected. */}
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

					{/* The selected single-select choice's note, indented to its label. Only one choice can own
					    one, and `aria-label` names it — what AT gets in place of adjacency. */}
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
										// Stopping propagation first is the whole point: the editor owns this gesture
										// either way, so it can never reach the card's `Shift+Escape` skip.
										event.stopPropagation();
										// Mid-composition the key is the IME's — no `preventDefault`, so it still
										// cancels the composition, and the note stays open with its text intact.
										if (action === "consume") return;
										event.preventDefault();
										finishNote(noteIndex);
									}}
									className="w-full resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs text-text-default tr-text-metadata outline-none focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft"
								/>
							) : (
								<button
									type="button"
									data-testid="ask-note-toggle"
									onClick={() => openNote(noteOption.label, noteIndex)}
									className="flex items-center gap-xs rounded-[var(--radius-sm)] text-text-muted tr-text-metadata outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary-soft"
								>
									<Pencil className="size-3" />
									{state.notes[noteOption.label]?.trim() ? "Edit note" : "Add note"}
								</button>
							)}
						</div>
					) : null}

					{/* The "Other" option is MANDATORY — offered on every question (issue #50) — and looks native:
					    one more option row (radio on single-select, checkbox on multi-select) with the free-text
					    field inline. Single-select: exclusive with the authored options; multi-select: additive. */}
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
			// A selectable option, not a toggle button: `aria-pressed` announced an exclusive pick as
			// "toggle button, pressed", and said nothing about the set it belongs to. `option` +
			// `aria-selected` inside the listbox is the role pair for a cursor that moves without
			// committing, and it carries the row's position in the choices with it.
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
				"flex items-start gap-sm rounded-[var(--radius-sm)] border px-md py-sm text-left outline-none transition-colors focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft",
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
				{/* The recommendation rationale, shown inline up front for a recommended option so it
				    reads on touch, and AT reads it as ordinary visible text. */}
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

/**
 * The mandatory "Other" choice, styled as one more option row so it reads native: the same indicator as
 * its siblings (radio on single-select, checkbox on multi-select) plus an inline free-text field. The
 * row is a <label> **explicitly bound to the input** (`htmlFor`), which is what makes clicking anywhere in
 * it focus the field: a `<button>` is a labelable element too, so on multi-select the implicit control
 * would be the include/exclude toggle *above* the input in tree order — clicking the row's padding or the
 * word "Other" would flip the checkbox and never focus the field at all. **Typed text** activates it (on single-select
 * that clears the radio pick — exclusive; on multi-select the checked options stay — additive), while
 * mere focus does not: ↑/↓/Home/End wrap through this row, and a pass-over must not spend the answer
 * (`customTextPatch`). On multi-select the checkbox itself is a separate toggle, so the typed text can be
 * excluded without deleting it.
 */
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
				"flex cursor-text items-center gap-sm rounded-[var(--radius-sm)] border px-md py-sm transition-colors focus-within:border-control-border-active focus-within:ring-2 focus-within:ring-primary-soft",
				active
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			{multi ? (
				<button
					type="button"
					data-testid="ask-custom-toggle"
					// State lives in the name rather than `aria-checked`: a real `<input type="checkbox">` here
					// would become the wrapping <label>'s associated control and steal it from the text field,
					// and `aria-checked` is not a button's to claim. Crude, but it says the true thing.
					aria-label={active ? "Exclude your own answer" : "Include your own answer"}
					onClick={(e) => {
						// The checkbox purely toggles — never let the label's default (focus the input) re-activate.
						e.preventDefault();
						onToggle();
					}}
					className="flex items-center rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary-soft"
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
					// Enter confirms whatever the question currently has: the typed text, or — from an
					// untouched Other row — the choice still selected above it. Unconditional, so the card
					// answers the keystroke either way (with nothing to confirm it says so).
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

/**
 * The "Recommended" pill next to an agent-recommended option — a plain label. Its rationale renders
 * inline in `OptionRow` (a `Why:` block below the description) so it's visible up front and on touch,
 * where a tooltip/popover never opens reliably.
 */
function RecommendedBadge() {
	return <span className={RECOMMENDED_PILL}>Recommended</span>;
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
					// With nothing answered there is no enabled Submit to land on, so the page's keyboard
					// target is the nudge back to the first gap — Enter goes there rather than nowhere.
					data-ask-page-focus={submitEnabled ? undefined : "true"}
					onClick={() => onJump(unanswered[0]?.i ?? 0)}
					className="self-start rounded-[var(--radius-sm)] text-feedback-warning tr-text-metadata outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary-soft"
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

/** Shared question + answer recap, with fuller context on the pre-submit review page. */
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
						{/* A custom answer follows the authored options: additive for multi-select, exclusive for
						    single-select review. Keeping it inside the list aligns it with the option rows. */}
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
