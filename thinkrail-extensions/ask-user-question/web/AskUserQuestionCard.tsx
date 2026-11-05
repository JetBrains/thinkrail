import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { resultText, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionResult } from "@thinkrail/pi-ask-user-question/core";
import { AttentionLine } from "@thinkrail/ui/attention-line";
import { Button } from "@thinkrail/ui/button";
import { hasPlatformModifier, isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ModeHint, TabChip } from "./controls";
import {
	activeQuestionPage,
	createQuestionAttentionClaim,
	currentQuestionPageStart,
	focusCurrentQuestionPage,
	focusQuestionAttention,
	focusTargetKind,
	hasCoarsePointer,
	isInsidePreview,
	isTextEntryTarget,
	shouldClaimQuestionFocus,
} from "./focus";
import { GhostPage } from "./ghost";
import { QuestionBody } from "./QuestionBody";
import { readAskUserQuestionResult } from "./readResult";
import {
	AnsweredReceipt,
	ClosedRecord,
	ComposingCard,
	SupersededRecord,
	WaitingCard,
} from "./record";
import {
	type ChoiceNudge,
	customTextPatch,
	deriveAnswers,
	discussReasonPatch,
	emptyQState,
	hasPreview,
	nudgeShowsOnPage,
	openNotePatch,
	parseQuestions,
	type QState,
	questionPageForKey,
	selectOptionPatch,
	toggleCustomPatch,
	toggleMultiPatch,
} from "./state";

const noLayoutChange = () => () => undefined;

const panelDomId = (toolCallId: string) => `ask-panel-${toolCallId}`;
const tabDomId = (toolCallId: string, page: number) => `ask-tab-${toolCallId}-${page}`;

const claimQuestionAttention = createQuestionAttentionClaim();
const ATTENTION_SETTLE_FRAMES = 30;

interface CachedCardState {
	states: Record<number, QState>;
	tab: number;
	submitted: boolean;
	hostProtocol: number | undefined;
}
const cardStateCache = new Map<string, CachedCardState>();
const stackHeights = new Map<string, { width: number; height: number }>();

function PageStack({ toolCallId, children }: { toolCallId: string; children: ReactNode }) {
	const holderRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const holder = holderRef.current;
		const grid = gridRef.current;
		if (!holder || !grid) return;
		const keep = (rawWidth: number, height: number) => {
			const width = Math.round(rawWidth);
			const kept = stackHeights.get(toolCallId);
			const next = kept && kept.width === width ? Math.max(kept.height, height) : height;
			stackHeights.set(toolCallId, { width, height: next });
			holder.style.setProperty("--ask-stack-height", `${next}px`);
		};
		const rect = grid.getBoundingClientRect();
		keep(rect.width, rect.height);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) keep(entry.contentRect.width, entry.contentRect.height);
		});
		observer.observe(grid);
		return () => observer.disconnect();
	}, [toolCallId]);

	return (
		<div ref={holderRef} className="min-h-[var(--ask-stack-height,0px)]">
			<div ref={gridRef} className="grid">
				{children}
			</div>
		</div>
	);
}

export function AskUserQuestionCard({
	toolCallId,
	args,
	result,
	status,
	streaming,
	interaction,
	onOpenFile,
}: ToolRenderProps) {
	const t = useT();
	const localFocusScope = useRef<object>({}).current;
	const focusScope = interaction?.focusScope ?? localFocusScope;
	const revealElement = interaction?.revealElement;
	const cancelAutomaticReveal = interaction?.cancelAutomaticReveal;
	const cardRef = useRef<HTMLElement>(null);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const questions = useMemo(() => parseQuestions(args), [args]);
	const resolvedResult =
		readAskUserQuestionResult(interaction?.state.response) ?? readAskUserQuestionResult(result);
	const superseded = interaction?.state.superseded ?? false;
	const ended = interaction?.state.ended ?? false;
	const canRespond = !!interaction && interaction.state.accepting;
	const [hostProtocol, setHostProtocol] = useState(
		() => interaction?.hostProtocol ?? cardStateCache.get(toolCallId)?.hostProtocol,
	);
	const liveProtocol = interaction?.hostProtocol;
	if (liveProtocol !== undefined && liveProtocol !== hostProtocol) setHostProtocol(liveProtocol);
	const discussAvailable = (hostProtocol ?? 0) >= ASK_DISCUSS_PROTOCOL_VERSION;
	const awaiting = !resolvedResult && !superseded && !ended && status !== "error";
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
	const prepareGeometryChange = interaction?.prepareLayoutChange ?? noLayoutChange;
	const completeSubmitChange = useRef<() => void>(() => undefined);

	useLayoutEffect(() => {
		if (!submitted) return;
		const complete = completeSubmitChange.current;
		completeSubmitChange.current = () => undefined;
		complete();
	}, [submitted]);

	useEffect(() => {
		if (awaiting) {
			cardStateCache.set(toolCallId, { states, tab, submitted, hostProtocol });
			return;
		}
		cardStateCache.delete(toolCallId);
		stackHeights.delete(toolCallId);
	}, [toolCallId, awaiting, states, tab, submitted, hostProtocol]);

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
			const card = cardRef.current;
			if (!card) return;
			revealElement?.(currentQuestionPageStart(card), {
				block: "nearest",
				provenance: "user-navigation",
				runway: "release",
				stability: "bounded",
			});
			focusCurrentQuestionPage(card);
		});
		return () => cancelAnimationFrame(frame);
	}, [revealElement, tab]);

	useEffect(() => {
		if (!awaiting || !canRespond || streaming || questions.length === 0 || submitted) return;
		let frame: number | null = null;
		let attempts = 0;
		let userTookOver = false;
		const yieldToUser = () => {
			userTookOver = true;
			cancelAutomaticReveal?.();
		};
		const settleAttention = () => {
			const card = cardRef.current;
			if (!card || userTookOver) return;
			if (attempts === 0) {
				revealElement?.(currentQuestionPageStart(card), {
					block: "start",
					provenance: "automatic-attention",
					runway: "release",
					stability: "bounded",
				});
			}
			if (!card.contains(document.activeElement)) {
				const kind = focusTargetKind(document.activeElement, card);
				if (shouldClaimQuestionFocus(kind, hasCoarsePointer())) focusQuestionAttention(card);
			}
			attempts += 1;
			if (attempts < ATTENTION_SETTLE_FRAMES) {
				frame = requestAnimationFrame(settleAttention);
			}
		};
		frame = requestAnimationFrame(() => {
			if (!claimQuestionAttention(focusScope, toolCallId)) return;
			setAnnounced(true);
			settleAttention();
			window.addEventListener("pointerdown", yieldToUser, { capture: true, once: true });
			window.addEventListener("keydown", yieldToUser, { capture: true, once: true });
			window.addEventListener("wheel", yieldToUser, { capture: true, once: true, passive: true });
		});
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			window.removeEventListener("pointerdown", yieldToUser, { capture: true });
			window.removeEventListener("keydown", yieldToUser, { capture: true });
			window.removeEventListener("wheel", yieldToUser, { capture: true });
		};
	}, [
		awaiting,
		canRespond,
		cancelAutomaticReveal,
		focusScope,
		questions.length,
		revealElement,
		streaming,
		submitted,
		toolCallId,
	]);

	const stateFor = (qi: number): QState => states[qi] ?? emptyQState();
	const patch = (qi: number, next: Partial<QState>) =>
		setStates((prev) => ({ ...prev, [qi]: { ...(prev[qi] ?? emptyQState()), ...next } }));

	const answers = deriveAnswers(questions, states);
	const answeredIndices = new Set(answers.map((a) => a.questionIndex));
	const discussIndices = new Set(
		answers.filter((a) => a.kind === "discuss").map((a) => a.questionIndex),
	);

	const reply = (r: AskUserQuestionResult) => {
		if (!interaction || !canRespond) return;
		const held = document.activeElement;
		const handedOff = !!held && !!cardRef.current?.contains(held) && held.matches(":focus-visible");
		if (handedOff) interaction.focusComposer();
		completeSubmitChange.current = prepareGeometryChange(() => cardRef.current, "user");
		setSubmitted(true);
		interaction.respond(r).catch(() => {
			reclaimFocusAfterFailedSend.current = handedOff;
			setSubmitted(false);
		});
	};

	if (resolvedResult) {
		return (
			<AnsweredReceipt
				toolCallId={toolCallId}
				questions={questions}
				result={resolvedResult}
				rawText={resultText(result)}
				prepareLayoutChange={interaction?.prepareLayoutChange}
			/>
		);
	}
	if (superseded) return <SupersededRecord />;
	if (ended || status === "error") {
		return <ClosedRecord error={status === "error"} rawText={resultText(result)} />;
	}
	if (streaming || questions.length === 0) return <ComposingCard count={questions.length} />;
	if (submitted) {
		return (
			<WaitingCard>
				<span data-testid="ask-sent">{t("tools.ask.sent")}</span>
			</WaitingCard>
		);
	}

	const multipleQuestions = questions.length > 1;
	const lastPage = questions.length - 1;
	const idx = Math.min(tab, lastPage);
	const q = questions[idx];
	if (!q) return <WaitingCard>{t("tools.ask.preparing")}</WaitingCard>;

	const showContinue = idx < lastPage;
	const canSubmit = canRespond && answers.length > 0;
	const nudgeVisible = nudgeShowsOnPage(nudge, idx, answeredIndices.has(idx));

	const submitRound = () => {
		if (!canRespond) return;
		if (answers.length === 0) {
			nudgeSeq.current += 1;
			setNudge({ question: idx, seq: nudgeSeq.current });
			return;
		}
		setNudge(null);
		reply({ answers, cancelled: false });
	};

	const focusPrimary = () => {
		const button = primaryRef.current;
		if (!button || button.disabled) return false;
		button.focus({ preventScroll: true });
		return true;
	};

	const onPrimaryKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		const card = cardRef.current;
		if (!card) return;
		const page = activeQuestionPage(card);
		const target =
			event.key === "ArrowUp"
				? page.querySelector<HTMLElement>("[data-ask-custom-row] textarea")
				: page.querySelector<HTMLElement>("[data-ask-option]");
		if (!target) return;
		event.preventDefault();
		target.focus({ preventScroll: true });
	};

	const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (isImeComposing(event.nativeEvent)) return;
		if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
		if (isInsidePreview(event.target)) return;
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
			event.key === "Enter" &&
			hasPlatformModifier(event.nativeEvent) &&
			!event.altKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			event.stopPropagation();
			submitRound();
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
		const next = questionPageForKey(event.key, idx, lastPage);
		if (next == null) return;
		event.preventDefault();
		if (next !== idx) setTab(next);
	};

	return (
		<div className="flex flex-col gap-4 motion-safe:animate-reveal">
			{canRespond ? <AttentionLine announced={announced} /> : null}
			<section
				ref={cardRef}
				data-testid="ask-user-question"
				data-tone={canRespond ? "active" : "idle"}
				aria-label={t("tools.ask.cardLabel")}
				aria-keyshortcuts="Shift+Escape Meta+Enter Control+Enter"
				onKeyDown={onCardKeyDown}
				className={cn(
					"@container overflow-hidden rounded-lg border bg-clip-padding bg-container-elevated-bg",
					canRespond ? "border-primary ring-2 ring-primary-soft" : "border-border-default",
				)}
			>
				{multipleQuestions ? (
					<div
						role="tablist"
						aria-label={t("tools.ask.tabsLabel")}
						className="flex items-center gap-4 overflow-x-auto border-border-default border-b px-12 py-8"
					>
						{questions.map((question, i) => (
							<TabChip
								key={question.question}
								id={tabDomId(toolCallId, i)}
								controls={panelDomId(toolCallId)}
								label={question.header || t("tools.ask.questionTab", { number: i + 1 })}
								active={idx === i}
								answered={answeredIndices.has(i)}
								discuss={discussIndices.has(i)}
								onClick={() => setTab(i)}
							/>
						))}
					</div>
				) : null}

				<div className="flex flex-col gap-12 p-12">
					<PageStack toolCallId={toolCallId}>
						{questions.map((question, page) => {
							const active = page === idx;
							const pageState = stateFor(page);
							return (
								<div
									key={question.question}
									data-ask-active={active}
									aria-hidden={active ? undefined : true}
									inert={!active}
									{...(active && multipleQuestions
										? {
												role: "tabpanel",
												id: panelDomId(toolCallId),
												"aria-labelledby": tabDomId(toolCallId, idx),
											}
										: {})}
									className={cn("col-start-1 row-start-1 min-w-0", !active && "invisible")}
								>
									<GhostPage value={!active}>
										<QuestionBody
											question={question}
											state={pageState}
											pageKeys={multipleQuestions}
											discussAvailable={discussAvailable}
											primaryEnabled={page < lastPage || canSubmit}
											onFocusPrimary={focusPrimary}
											onOpenFile={onOpenFile}
											onSelect={(label, cursor) =>
												patch(page, selectOptionPatch(pageState, label, cursor))
											}
											onToggleMulti={(label, cursor) =>
												patch(page, toggleMultiPatch(pageState, label, cursor))
											}
											onCursor={(cursor) => {
												if (cursor !== pageState.cursor) patch(page, { cursor });
											}}
											onCustomText={(text) => patch(page, customTextPatch(text))}
											onToggleCustom={() => patch(page, toggleCustomPatch(pageState))}
											onReopenCustom={() => {
												if (pageState.customText.trim())
													patch(page, customTextPatch(pageState.customText));
											}}
											onOpenNote={(label, cursor) =>
												patch(page, openNotePatch(pageState, !!question.multiSelect, label, cursor))
											}
											onCloseNote={() => patch(page, { noteFor: null })}
											onNote={(label, text) =>
												patch(page, { notes: { ...pageState.notes, [label]: text } })
											}
											onToggleDiscuss={() => patch(page, { discuss: !pageState.discuss })}
											onDiscussReason={(reason) =>
												patch(page, discussReasonPatch(pageState, reason))
											}
											onDiscussText={(text) => patch(page, { discussText: text })}
											onTogglePreview={() =>
												patch(page, { previewExpanded: !pageState.previewExpanded })
											}
										/>
									</GhostPage>
								</div>
							);
						})}
					</PageStack>

					<div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
						<ModeHint
							multiSelect={!!q.multiSelect}
							multipleQuestions={multipleQuestions}
							previewKeys={!q.multiSelect && q.options.some(hasPreview)}
							discussKey={discussAvailable}
						/>
						<div className="flex items-center justify-end gap-12">
							{nudgeVisible ? (
								<span
									aria-hidden={nudgeSpoken || undefined}
									data-testid="ask-needs-choice"
									className="shrink-0 whitespace-nowrap text-feedback-warning tr-text-metadata"
								>
									{t("tools.ask.needsChoice")}
								</span>
							) : null}
							<span role="status" aria-live="polite" className="sr-only">
								{nudgeVisible && nudgeSpoken ? t("tools.ask.needsChoiceAnnouncement") : ""}
							</span>
							<Button
								variant="ghost"
								size="l"
								tabIndex={0}
								data-testid="ask-skip"
								onClick={() => reply({ answers: [], cancelled: true })}
								disabled={!canRespond}
								className="shrink-0"
							>
								{t("tools.ask.skip")}
							</Button>
							{showContinue ? (
								<Button
									ref={primaryRef}
									variant="primary"
									size="l"
									tabIndex={0}
									data-testid="ask-continue"
									onKeyDown={onPrimaryKeyDown}
									onClick={() => setTab(idx + 1)}
									className="shrink-0"
								>
									{t("tools.ask.next")}
								</Button>
							) : (
								<Button
									ref={primaryRef}
									variant="primary"
									size="l"
									tabIndex={0}
									data-testid="ask-submit"
									onKeyDown={onPrimaryKeyDown}
									onClick={() => reply({ answers, cancelled: false })}
									disabled={!canSubmit}
									className="shrink-0"
								>
									{t("tools.ask.submit")}
								</Button>
							)}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
