import {
	RiCheckLine as Check,
	RiQuestionnaireLine as MessageCircleQuestion,
	RiSkipForwardLine as SkipForward,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question/core";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { deriveRecapState, splitRecommended } from "./state";

export function SupersededRecord({ questions }: { questions: AskUserQuestionItem[] }) {
	const t = useT();
	return (
		<div
			data-testid="ask-user-question"
			data-tone="superseded"
			className="flex flex-col gap-4 text-text-muted tr-text-metadata"
		>
			<div className="flex items-center gap-4">
				<SkipForward className="size-14 shrink-0" />
				{t("tools.ask.superseded")}
			</div>
			{questions.map((q) => (
				<div key={q.question} className="pl-[calc(0.875rem+var(--space-8))] text-text-muted">
					{q.question}
				</div>
			))}
		</div>
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

export function ResolvedRecord({
	questions,
	result,
	rawText,
}: {
	questions: AskUserQuestionItem[];
	result: AskUserQuestionResult | null;
	rawText: string;
}) {
	const t = useT();
	if (!result) {
		return (
			<div
				data-testid="ask-user-question"
				data-tone="error"
				className="text-feedback-error tr-text-metadata"
			>
				{rawText || t("tools.ask.closed")}
			</div>
		);
	}
	const byIndex = new Map(result.answers.map((a) => [a.questionIndex, a]));
	return (
		<div
			data-testid="ask-user-question"
			data-tone={result.cancelled ? "skipped" : "answered"}
			className="flex flex-col gap-12"
		>
			{questions.map((q, i) => (
				<QuestionRecap key={q.question} question={q} answer={byIndex.get(i)} />
			))}
			{questions.length === 0 ? (
				<div className="text-text-muted tr-text-metadata">{rawText || t("tools.ask.answered")}</div>
			) : null}
		</div>
	);
}

function QuestionRecap({
	question,
	answer,
}: {
	question: AskUserQuestionItem;
	answer: AskUserQuestionAnswer | undefined;
}) {
	const t = useT();
	const { selectedLabels, customAnswer, showOptions } = deriveRecapState(answer);
	const selected = new Set(selectedLabels);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-8">
				<MessageCircleQuestion className="mt-2 size-14 shrink-0 text-text-muted" />
				<p className="tr-text-ui text-text-muted">{question.question}</p>
			</div>
			{showOptions ? (
				<ul className="flex flex-col gap-2 pl-[calc(0.875rem+var(--space-8))]">
					{question.options.map((opt) => {
						const isSel = selected.has(opt.label);
						return (
							<li
								key={opt.label}
								data-testid="ask-record-option"
								data-selected={isSel}
								className={cn(
									"flex items-center gap-4 tr-text-ui",
									isSel ? "text-text-default" : "text-text-muted",
								)}
							>
								{isSel ? (
									<Check aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
								) : (
									<span
										aria-hidden="true"
										className="size-12 shrink-0 rounded-full border border-border-default"
									/>
								)}
								<span data-testid="ask-selection-status" className="sr-only">
									{isSel ? t("tools.ask.selected") : t("tools.ask.notSelected")}
								</span>
								<span>{splitRecommended(opt.label).text}</span>
							</li>
						);
					})}
					{customAnswer ? (
						<li
							data-testid="ask-record-custom"
							className="flex items-center gap-4 tr-text-ui text-text-default"
						>
							<Check aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
							<span data-testid="ask-selection-status" className="sr-only">
								{t("tools.ask.selectedCustom")}
							</span>
							<span>{t("tools.ask.quotedAnswer", { answer: customAnswer })}</span>
						</li>
					) : null}
				</ul>
			) : !answer ? (
				<div className="flex items-center gap-4 pl-[calc(0.875rem+var(--space-8))] text-text-muted tr-text-metadata italic">
					<SkipForward className="size-12 shrink-0" /> {t("tools.ask.skipped")}
				</div>
			) : (
				<div className="flex items-center gap-4 border-border-default border-l-2 pl-8">
					<Check aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
					<span data-testid="ask-selection-status" className="sr-only">
						{t("tools.ask.selectedCustom")}
					</span>
					<span className="tr-text-ui text-text-default">
						{t("tools.ask.quotedAnswer", { answer: answer.answer })}
					</span>
				</div>
			)}
			{answer?.notes ? (
				<div className="pl-[calc(0.875rem+var(--space-8))] text-text-muted tr-text-metadata">
					{t("tools.ask.note", { note: answer.notes })}
				</div>
			) : null}
		</div>
	);
}
