import { RiArrowDownSLine as CollapseGlyph, RiArrowUpSLine as ExpandGlyph } from "@remixicon/react";
import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { resultText, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionResult } from "@thinkrail/pi-ask-user-question/core";
import { AttentionLine } from "@thinkrail/ui/attention-line";
import { Button, IconButton } from "@thinkrail/ui/button";
import { hasPlatformModifier, isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import {
	type FocusEvent,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ModeHint, TabChip } from "./controls";
import { forgetDockState, requestDockFocus, setDockCollapsed, useDockState } from "./dockState";
import {
	activeQuestionPage,
	createQuestionAttentionClaim,
	focusCurrentQuestionPage,
	focusQuestionAttention,
	focusTargetKind,
	hasCoarsePointer,
	isCardBackground,
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
	DockedStub,
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
			if (rawWidth === 0) return;
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
	const placement = interaction?.placement;
	const docked = placement === "dock";
	const dock = useDockState(toolCallId);
	const collapsed = docked && dock.collapsed;
	const handledFocusRequest = useRef(dock.focusRequest);
	const cardRef = useRef<HTMLElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
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
			if (placement !== "stub") {
				cardStateCache.set(toolCallId, { states, tab, submitted, hostProtocol });
			}
			return;
		}
		cardStateCache.delete(toolCallId);
		stackHeights.delete(toolCallId);
		forgetDockState(toolCallId);
	}, [toolCallId, awaiting, placement, states, tab, submitted, hostProtocol]);

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
			bodyRef.current?.scrollTo({ top: 0 });
			focusCurrentQuestionPage(card);
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

	useEffect(() => {
		if (!awaiting || !canRespond || streaming || questions.length === 0 || submitted) return;
		if (placement === "stub") return;
		const frame = requestAnimationFrame(() => {
			const card = cardRef.current;
			if (!card || !claimQuestionAttention(focusScope, toolCallId)) return;
			setAnnounced(true);
			if (card.contains(document.activeElement)) return;
			const kind = focusTargetKind(document.activeElement, card);
			if (shouldClaimQuestionFocus(kind, hasCoarsePointer())) focusQuestionAttention(card);
		});
		return () => cancelAnimationFrame(frame);
	}, [
		awaiting,
		canRespond,
		focusScope,
		placement,
		questions.length,
		streaming,
		submitted,
		toolCallId,
	]);

	useEffect(() => {
		if (!docked || dock.focusRequest === handledFocusRequest.current) return;
		handledFocusRequest.current = dock.focusRequest;
		const frame = requestAnimationFrame(() => {
			const card = cardRef.current;
			if (!card) return;
			if (hasCoarsePointer()) focusCurrentQuestionPage(card);
			else focusQuestionAttention(card);
		});
		return () => cancelAnimationFrame(frame);
	}, [docked, dock.focusRequest]);

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

	if (docked && !awaiting) return null;
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
	if (placement === "stub") {
		return <DockedStub count={questions.length} onOpen={() => requestDockFocus(toolCallId)} />;
	}
	if (submitted) {
		return (
			<WaitingCard docked={docked}>
				<span data-testid="ask-sent">{t("tools.ask.sent")}</span>
			</WaitingCard>
		);
	}

	const multipleQuestions = questions.length > 1;
	const lastPage = questions.length - 1;
	const idx = Math.min(tab, lastPage);
	const q = questions[idx];
	if (!q) return <WaitingCard docked={docked}>{t("tools.ask.preparing")}</WaitingCard>;

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
		if (collapsed || isImeComposing(event.nativeEvent)) return;
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
			event.target === event.currentTarget &&
			(event.key === "ArrowUp" || event.key === "ArrowDown") &&
			!event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			focusCurrentQuestionPage(event.currentTarget);
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

	const closeNote = () => {
		if (stateFor(idx).noteFor !== null) patch(idx, { noteFor: null });
	};

	const onCardPointerDown = (event: PointerEvent<HTMLElement>) => {
		if (isCardBackground(event.target, event.currentTarget)) closeNote();
	};

	const onCardBlur = (event: FocusEvent<HTMLElement>) => {
		if (event.currentTarget.contains(event.relatedTarget) || !document.hasFocus()) return;
		closeNote();
	};

	const selectPage = (page: number) => {
		setTab(page);
		if (collapsed) setDockCollapsed(toolCallId, false);
	};

	const tabs = multipleQuestions ? (
		<div
			role="tablist"
			aria-label={t("tools.ask.tabsLabel")}
			className={cn(
				"flex items-center gap-4 overflow-x-auto",
				docked ? "min-w-0" : "border-border-default border-b px-12 py-8",
			)}
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
					onClick={() => selectPage(i)}
				/>
			))}
		</div>
	) : null;

	const pages = (
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
								onDiscussReason={(reason) => patch(page, discussReasonPatch(pageState, reason))}
								onDiscussText={(text) => patch(page, { discussText: text })}
								onTogglePreview={() => patch(page, { previewExpanded: !pageState.previewExpanded })}
							/>
						</GhostPage>
					</div>
				);
			})}
		</PageStack>
	);

	const footer = (
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
	);

	const cardProps = {
		ref: cardRef,
		"data-testid": "ask-user-question",
		"data-tone": canRespond ? "active" : "idle",
		"aria-label": t("tools.ask.cardLabel"),
		"aria-keyshortcuts": "Shift+Escape Meta+Enter Control+Enter",
		tabIndex: -1,
		onKeyDown: onCardKeyDown,
		onPointerDown: onCardPointerDown,
		onBlur: onCardBlur,
	};

	if (docked) {
		return (
			<section
				{...cardProps}
				data-placement="dock"
				data-collapsed={collapsed}
				className="@container flex min-h-0 flex-col border-primary border-t-2 bg-container-elevated-bg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset motion-safe:animate-reveal"
			>
				<div className="flex shrink-0 items-center gap-12 border-border-default border-b px-12 py-4">
					<div className="shrink-0">
						<AttentionLine announced={announced} />
					</div>
					<div className="flex min-w-0 flex-1 justify-end">
						{tabs ?? (
							<span className="truncate text-text-muted tr-text-metadata">
								{q.header || t("tools.ask.questionTab", { number: 1 })}
							</span>
						)}
					</div>
					<IconButton
						icon={collapsed ? ExpandGlyph : CollapseGlyph}
						label={collapsed ? t("tools.ask.expand") : t("tools.ask.collapse")}
						aria-expanded={!collapsed}
						tabIndex={0}
						data-testid="ask-collapse"
						onClick={() => setDockCollapsed(toolCallId, !collapsed)}
						className="shrink-0"
					/>
				</div>
				<div
					ref={bodyRef}
					data-testid="ask-dock-body"
					className={cn("min-h-0 overflow-y-auto p-12", collapsed && "hidden")}
				>
					{pages}
				</div>
				<div
					className={cn(
						"shrink-0 border-border-default border-t px-12 py-8",
						collapsed && "hidden",
					)}
				>
					{footer}
				</div>
			</section>
		);
	}

	return (
		<div className="flex flex-col gap-4 motion-safe:animate-reveal">
			{canRespond ? <AttentionLine announced={announced} /> : null}
			<section
				{...cardProps}
				className={cn(
					"@container overflow-hidden rounded-lg border bg-clip-padding bg-container-elevated-bg outline-none focus-visible:ring-2 focus-visible:ring-primary",
					canRespond ? "border-primary ring-2 ring-primary-soft" : "border-border-default",
				)}
			>
				{tabs}
				<div className="flex flex-col gap-12 p-12">
					{pages}
					{footer}
				</div>
			</section>
		</div>
	);
}
