import {
	type AppSurvey,
	SURVEY_OPEN_TEXT_LIMIT,
	type SurveySubmitParams,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";
import {
	committedAnswers,
	emptySurveyDraft,
	presentSurvey,
	ratingMark,
	ratingPoints,
	type SurveyDraft,
	selectSingleChoice,
	selectSingleOther,
	setAnswerText,
	setOtherText,
	stepCanContinue,
	thankYouText,
	toggleChoice,
	toggleOther,
} from "./surveyDraft";

export function SurveyForm({
	survey,
	submissionId,
	onCompleted,
	onSent,
	onShown,
}: {
	survey: AppSurvey;
	submissionId?: string;
	onCompleted: (thanks: string | null) => void;
	onSent?: () => void;
	onShown?: () => void;
}) {
	const t = useT();
	const questions = useMemo(() => presentSurvey(survey), [survey]);
	const [step, setStep] = useState(0);
	const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft);
	const [pending, setPending] = useState(false);
	const submission = useRef(submissionId ?? crypto.randomUUID());
	const pendingRef = useRef(false);
	const onShownRef = useRef(onShown);
	onShownRef.current = onShown;
	const question = questions[step];

	useEffect(() => {
		void getTransport()
			.request("feedback.survey.submit", {
				submissionId: submission.current,
				event: "shown",
			})
			.then(() => onShownRef.current?.())
			.catch(() => {});
	}, []);

	if (!question) return null;
	const last = step === questions.length - 1;
	const send = (payload: SurveySubmitParams, advance: () => void) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		void getTransport()
			.request("feedback.survey.submit", payload)
			.then(() => {
				onSent?.();
				advance();
			})
			.catch((error) => toast.error(errorText(error), t("panels.survey.saveFailed")))
			.finally(() => {
				pendingRef.current = false;
				setPending(false);
			});
	};
	const continueStep = () => {
		const answers = committedAnswers(questions, draft, step);
		send(
			{
				submissionId: submission.current,
				event: "sent",
				completed: last,
				answers,
			},
			() => {
				if (last) onCompleted(thankYouText(survey, t("panels.survey.thankYou")));
				else setStep((current) => current + 1);
			},
		);
	};

	return (
		<div className="flex flex-col gap-12">
			<p className="text-text-muted tr-text-metadata" data-testid="survey-progress">
				{t("panels.survey.progress", { current: step + 1, total: questions.length })}
			</p>
			<div className="flex flex-col gap-4">
				<h3
					id="survey-question"
					className="tr-title-section text-text-default"
					data-testid="survey-question"
				>
					{question.question}
				</h3>
				{question.description ? (
					<p className="text-text-muted tr-text-metadata">{question.description}</p>
				) : null}
			</div>
			<SurveyAnswer question={question} survey={survey} draft={draft} onDraft={setDraft} />
			<Button
				variant="primary"
				className="self-start"
				data-testid="survey-continue"
				disabled={pending || !stepCanContinue(question, draft)}
				onClick={continueStep}
			>
				{t("panels.survey.continue")}
			</Button>
		</div>
	);
}

function SurveyAnswer({
	question,
	survey,
	draft,
	onDraft,
}: {
	question: NonNullable<ReturnType<typeof presentSurvey>[number]>;
	survey: AppSurvey;
	draft: SurveyDraft;
	onDraft: (draft: SurveyDraft) => void;
}) {
	const t = useT();
	if (question.type === "open") {
		const value = draft.answers[question.id];
		return (
			<Textarea
				rows={4}
				maxLength={SURVEY_OPEN_TEXT_LIMIT}
				value={typeof value === "string" ? value : ""}
				placeholder={survey.placeholder}
				onChange={(event) => onDraft(setAnswerText(draft, question.id, event.target.value))}
			/>
		);
	}
	if (question.type === "rating") {
		const selected = draft.answers[question.id];
		return (
			<div className="flex flex-wrap items-center gap-8">
				{question.lowerBoundLabel ? (
					<span className="text-text-muted tr-text-metadata">{question.lowerBoundLabel}</span>
				) : null}
				<div role="radiogroup" aria-label={question.question} className="flex flex-wrap gap-4">
					{ratingPoints(question).map((point) => {
						const value = String(point);
						const active = selected === value;
						return (
							<button
								key={value}
								type="button"
								aria-pressed={active}
								className={cn(
									"flex size-32 items-center justify-center rounded-sm border tr-text-ui outline-none focus-visible:ring-2 focus-visible:ring-primary",
									active
										? "border-primary-muted bg-primary-subtle text-primary"
										: "border-border-default hover:bg-control-bg-hovered",
								)}
								onClick={() => onDraft(setAnswerText(draft, question.id, value))}
							>
								{ratingMark(question, point)}
							</button>
						);
					})}
				</div>
				{question.upperBoundLabel ? (
					<span className="text-text-muted tr-text-metadata">{question.upperBoundLabel}</span>
				) : null}
			</div>
		);
	}
	const selected = draft.answers[question.id];
	const otherSelected = draft.otherSelected[question.id] === true;
	const body = (
		<>
			{question.choices.map((choice) => (
				<ChoiceRow
					key={choice}
					kind={question.type === "single_choice" ? "radio" : "checkbox"}
					name={question.id}
					label={choice}
					checked={
						question.type === "single_choice"
							? selected === choice && !otherSelected
							: Array.isArray(selected) && selected.includes(choice)
					}
					onSelect={() =>
						onDraft(
							question.type === "single_choice"
								? selectSingleChoice(draft, question.id, choice)
								: toggleChoice(draft, question.id, choice),
						)
					}
				/>
			))}
			{question.hasOpenChoice ? (
				<>
					<ChoiceRow
						kind={question.type === "single_choice" ? "radio" : "checkbox"}
						name={question.id}
						label={t("panels.survey.other")}
						checked={otherSelected}
						onSelect={() =>
							onDraft(
								question.type === "single_choice"
									? selectSingleOther(draft, question.id)
									: toggleOther(draft, question.id),
							)
						}
					/>
					{otherSelected ? (
						<Textarea
							rows={2}
							maxLength={SURVEY_OPEN_TEXT_LIMIT}
							value={draft.otherText[question.id] ?? ""}
							onChange={(event) => onDraft(setOtherText(draft, question.id, event.target.value))}
						/>
					) : null}
				</>
			) : null}
		</>
	);
	return question.type === "single_choice" ? (
		<div role="radiogroup" aria-label={question.question} className="flex flex-col gap-4">
			{body}
		</div>
	) : (
		<fieldset
			aria-labelledby="survey-question"
			className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
		>
			{body}
		</fieldset>
	);
}

function ChoiceRow({
	kind,
	name,
	label,
	checked,
	onSelect,
}: {
	kind: "radio" | "checkbox";
	name: string;
	label: string;
	checked: boolean;
	onSelect: () => void;
}) {
	return (
		<label
			className={cn(
				"flex cursor-pointer items-center gap-8 rounded-sm border px-12 py-8 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
				checked
					? "border-primary-muted bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			<input type={kind} name={name} checked={checked} onChange={onSelect} className="sr-only" />
			<span className="tr-text-ui text-text-default">{label}</span>
		</label>
	);
}
