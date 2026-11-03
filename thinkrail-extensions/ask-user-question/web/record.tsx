import {
	RiChat3Line as ChatLine,
	RiCheckLine as Check,
	RiCheckboxCircleLine as CheckCircle,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiEditLine as EditLine,
	RiErrorWarningLine as ErrorGlyph,
	RiQuestionnaireLine as MessageCircleQuestion,
	RiSkipForwardLine as SkipForward,
	RiStopCircleLine as StopGlyph,
} from "@remixicon/react";
import type { ToolInteraction } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question/core";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { discussReasonKey } from "./discuss";
import { deriveRecapState, splitRecommended } from "./state";

type PrepareLayoutChange = ToolInteraction["prepareLayoutChange"] | undefined;

const receiptFolds = new Map<string, boolean>();

function useReceiptFold(
	key: string,
	fallback: boolean,
	prepare: PrepareLayoutChange,
): [boolean, (anchor: HTMLElement) => void] {
	const [open, setOpen] = useState(() => receiptFolds.get(key) ?? fallback);
	const complete = useRef<() => void>(() => undefined);
	useLayoutEffect(() => {
		const done = complete.current;
		complete.current = () => undefined;
		done();
	}, [open]);
	const toggle = (anchor: HTMLElement) => {
		if (prepare) complete.current = prepare(() => (anchor.isConnected ? anchor : null), "user");
		const next = !open;
		receiptFolds.set(key, next);
		setOpen(next);
	};
	return [open, toggle];
}

function RecordLine({
	tone,
	icon,
	children,
}: {
	tone: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone={tone}
			className="flex min-w-0 items-start gap-4 text-text-muted tr-text-metadata"
		>
			<span className="mt-2 flex shrink-0">{icon}</span>
			<span className="min-w-0">{children}</span>
		</div>
	);
}

export function SupersededRecord() {
	const t = useT();
	return (
		<RecordLine tone="superseded" icon={<SkipForward aria-hidden="true" className="size-14" />}>
			{t("tools.ask.superseded")}
		</RecordLine>
	);
}

export function ClosedRecord({ error, rawText }: { error: boolean; rawText: string }) {
	const t = useT();
	return (
		<RecordLine
			tone={error ? "error" : "closed"}
			icon={
				error ? (
					<ErrorGlyph aria-hidden="true" className="size-14 text-feedback-error" />
				) : (
					<StopGlyph aria-hidden="true" className="size-14" />
				)
			}
		>
			{rawText || t("tools.ask.closed")}
		</RecordLine>
	);
}

export function WaitingCard({ children }: { children: ReactNode }) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone="pending"
			role="status"
			className="flex items-center gap-4 rounded-lg border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
		>
			<MessageCircleQuestion className="size-14 shrink-0" />
			{children}
		</div>
	);
}

export function ComposingCard({ count }: { count: number }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<div className="text-text-muted tr-text-metadata">{t("tools.ask.composing")}</div>
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="flex flex-col gap-8 rounded-lg border border-border-default bg-container-elevated-bg px-12 py-8"
			>
				<div className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<MessageCircleQuestion className="size-14 shrink-0" />
					{count > 0 ? t("tools.ask.preparingReady", { count }) : t("tools.ask.preparing")}
				</div>
				<div className="flex animate-pulse flex-col gap-4" aria-hidden="true">
					<div className="h-32 rounded-sm bg-control-bg-selected" />
					<div className="h-32 rounded-sm bg-control-bg-selected" />
				</div>
			</div>
		</div>
	);
}

function answerSummary(answer: AskUserQuestionAnswer | undefined, t: Translator): string {
	if (!answer) return t("tools.ask.receiptSkippedQuestion");
	if (answer.kind === "discuss") return t("tools.ask.receiptDiscussFirst");
	if (answer.kind === "multi") {
		const picks = (answer.selected ?? []).map((label) => splitRecommended(label).text);
		return [...picks, ...(answer.answer ? [answer.answer] : [])].join(", ");
	}
	return answer.kind === "option" && answer.answer
		? splitRecommended(answer.answer).text
		: (answer.answer ?? "");
}

export function AnsweredReceipt({
	toolCallId,
	questions,
	result,
	rawText,
	prepareLayoutChange,
}: {
	toolCallId: string;
	questions: AskUserQuestionItem[];
	result: AskUserQuestionResult;
	rawText: string;
	prepareLayoutChange: PrepareLayoutChange;
}) {
	const t = useT();
	const [expanded, toggle] = useReceiptFold(toolCallId, true, prepareLayoutChange);
	if (result.cancelled) {
		return (
			<RecordLine tone="skipped" icon={<SkipForward aria-hidden="true" className="size-14" />}>
				{t("tools.ask.receiptSkippedAll")}
			</RecordLine>
		);
	}
	const byIndex = new Map(result.answers.map((a) => [a.questionIndex, a]));
	const discussCount = result.answers.filter((a) => a.kind === "discuss").length;
	const answeredCount = result.answers.length - discussCount;
	const total = questions.length;
	const headline =
		answeredCount === 0 && discussCount > 0
			? t("tools.ask.receiptAllDiscuss", { count: discussCount })
			: answeredCount >= total
				? t("tools.ask.receiptAnswered", { count: answeredCount })
				: t("tools.ask.receiptAnsweredOf", { count: answeredCount, total });
	const summary = questions.map((_, i) => answerSummary(byIndex.get(i), t)).join(" · ");

	return (
		<div
			data-testid="ask-user-question"
			data-tone="answered"
			className="flex min-w-0 flex-col gap-8"
		>
			<button
				type="button"
				tabIndex={0}
				data-testid="ask-receipt-toggle"
				aria-expanded={expanded}
				onClick={(event) => toggle(event.currentTarget)}
				className="flex min-w-0 items-center gap-4 self-start rounded-sm text-left text-text-muted tr-text-metadata outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{expanded ? (
					<ChevronDown aria-hidden="true" className="size-14 shrink-0" />
				) : (
					<ChevronRight aria-hidden="true" className="size-14 shrink-0" />
				)}
				{answeredCount === 0 && discussCount > 0 ? (
					<ChatLine aria-hidden="true" className="size-14 shrink-0 text-feedback-info" />
				) : (
					<CheckCircle aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
				)}
				<span className="shrink-0 text-text-default">{headline}</span>
				{discussCount > 0 && answeredCount > 0 ? (
					<span className="shrink-0 text-feedback-info">
						{t("tools.ask.receiptToDiscuss", { count: discussCount })}
					</span>
				) : null}
				{!expanded && total > 0 ? (
					<span data-testid="ask-receipt-summary" className="min-w-0 truncate">
						{t("tools.ask.receiptSummary", { summary })}
					</span>
				) : null}
			</button>
			{expanded ? (
				<div className="ml-4 flex min-w-0 flex-col border-border-default border-l-2 pl-16">
					{questions.map((question, index) => (
						<ReceiptPair
							key={question.question}
							toolCallId={toolCallId}
							index={index}
							last={index === total - 1}
							question={question}
							answer={byIndex.get(index)}
							prepareLayoutChange={prepareLayoutChange}
						/>
					))}
					{total === 0 ? (
						<div className="text-text-muted tr-text-metadata">
							{rawText || t("tools.ask.answered")}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function AnswerLine({ answer }: { answer: AskUserQuestionAnswer | undefined }) {
	const t = useT();
	if (!answer) {
		return (
			<p data-testid="ask-receipt-answer" className="text-text-muted tr-text-ui italic">
				{t("tools.ask.receiptSkippedQuestion")}
			</p>
		);
	}
	if (answer.kind === "discuss") {
		return (
			<p
				data-testid="ask-receipt-answer"
				data-kind="discuss"
				className="flex flex-wrap items-center gap-4 text-feedback-info tr-text-ui"
			>
				<ChatLine aria-hidden="true" className="size-14 shrink-0" />
				{t("tools.ask.receiptDiscussFirst")}
				{answer.reason ? (
					<span className="text-text-muted">
						{t("tools.ask.receiptReason", { reason: t(discussReasonKey(answer.reason)) })}
					</span>
				) : null}
			</p>
		);
	}
	const own = (text: string) => (
		<span className="inline-flex items-start gap-4">
			<EditLine aria-hidden="true" className="mt-2 size-14 shrink-0 text-text-muted" />
			<span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
		</span>
	);
	const picks =
		answer.kind === "multi"
			? (answer.selected ?? []).map((label) => splitRecommended(label).text).join(", ")
			: answer.kind === "option" && answer.answer
				? splitRecommended(answer.answer).text
				: "";
	const custom = answer.kind === "custom" || answer.kind === "multi" ? answer.answer : null;
	return (
		<p
			data-testid="ask-receipt-answer"
			data-kind={answer.kind}
			className="flex flex-wrap items-start gap-4 text-text-default tr-text-ui"
		>
			{picks ? <span>{picks}</span> : null}
			{picks && custom ? <span className="text-text-muted">+</span> : null}
			{custom ? own(custom) : null}
		</p>
	);
}

function ReceiptPair({
	toolCallId,
	index,
	last,
	question,
	answer,
	prepareLayoutChange,
}: {
	toolCallId: string;
	index: number;
	last: boolean;
	question: AskUserQuestionItem;
	answer: AskUserQuestionAnswer | undefined;
	prepareLayoutChange: PrepareLayoutChange;
}) {
	const t = useT();
	const [optionsOpen, toggleOptions] = useReceiptFold(
		`${toolCallId}\u0000${index}`,
		false,
		prepareLayoutChange,
	);
	const { selectedLabels, customAnswer } = deriveRecapState(answer);
	const selected = new Set(selectedLabels);
	return (
		<div
			data-testid="ask-receipt-pair"
			className={cn(
				"flex min-w-0 flex-col gap-2",
				index > 0 && "border-border-default border-t pt-8",
				!last && "pb-8",
			)}
		>
			<div className="flex items-start gap-8">
				<p className="min-w-0 flex-1 text-text-muted tr-text-metadata">{question.question}</p>
				<button
					type="button"
					tabIndex={0}
					data-testid="ask-receipt-options-toggle"
					aria-expanded={optionsOpen}
					aria-label={t("tools.ask.receiptOptionsLabel", { question: question.question })}
					onClick={(event) => toggleOptions(event.currentTarget)}
					className="inline-flex shrink-0 items-center gap-2 rounded-sm px-4 text-text-muted tr-text-metadata outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					{t("tools.ask.receiptOptions")}
					{optionsOpen ? (
						<ChevronDown aria-hidden="true" className="size-14" />
					) : (
						<ChevronRight aria-hidden="true" className="size-14" />
					)}
				</button>
			</div>
			<AnswerLine answer={answer} />
			{answer?.notes ? (
				<p className="whitespace-pre-wrap break-words text-text-muted tr-text-metadata">
					{t("tools.ask.quotedAnswer", { answer: answer.notes })}
				</p>
			) : null}
			{optionsOpen ? (
				<ul className="flex flex-col gap-4 pt-4">
					{question.options.map((option) => {
						const isSelected = selected.has(option.label);
						return (
							<li
								key={option.label}
								data-testid="ask-record-option"
								data-selected={isSelected}
								className="flex items-start gap-8 tr-text-metadata"
							>
								{isSelected ? (
									<Check
										aria-hidden="true"
										className="mt-2 size-14 shrink-0 text-feedback-success"
									/>
								) : (
									<span
										aria-hidden="true"
										className="mt-2 size-12 shrink-0 rounded-full border border-border-default"
									/>
								)}
								<span data-testid="ask-selection-status" className="sr-only">
									{isSelected ? t("tools.ask.selected") : t("tools.ask.notSelected")}
								</span>
								<span className="flex min-w-0 flex-col">
									<span className={isSelected ? "text-text-default" : "text-text-muted"}>
										{splitRecommended(option.label).text}
									</span>
									{option.description ? (
										<span className="text-text-subtle">{option.description}</span>
									) : null}
								</span>
							</li>
						);
					})}
					{customAnswer ? (
						<li
							data-testid="ask-record-custom"
							className="flex items-start gap-8 text-text-default tr-text-metadata"
						>
							<Check aria-hidden="true" className="mt-2 size-14 shrink-0 text-feedback-success" />
							<span data-testid="ask-selection-status" className="sr-only">
								{t("tools.ask.selectedCustom")}
							</span>
							<span className="min-w-0 whitespace-pre-wrap break-words">
								{t("tools.ask.quotedAnswer", { answer: customAnswer })}
							</span>
						</li>
					) : null}
				</ul>
			) : null}
		</div>
	);
}
