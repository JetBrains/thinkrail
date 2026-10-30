import {
	type AppSurvey,
	SURVEY_OPEN_TEXT_LIMIT,
	SURVEY_TRANSLATIONS_PROTOCOL_VERSION,
	type SurveyQuestion,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useRef, useState } from "react";
import { randomUuid } from "@/lib";
import { getTransport, wsErrorCode } from "@/transport";
import {
	committedAnswers,
	emptySurveyDraft,
	inlineOthers,
	presentSurvey,
	ratingMark,
	ratingPoints,
	type SurveyDraft,
	selectSingleChoice,
	selectSingleOther,
	setAnswerText,
	setOtherText,
	stepCanContinue,
	toggleChoice,
	toggleOther,
} from "./surveyDraft";

export function SurveyForm({
	survey,
	hostProtocol,
	onSent,
	onChanged,
}: {
	survey: AppSurvey;
	hostProtocol: number | null;
	onSent: () => void;
	onChanged: () => void;
}) {
	const t = useT();
	const [questions] = useState(() => presentSurvey(survey));
	const [submissionId] = useState(randomUuid);
	const [step, setStep] = useState(0);
	const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<"unavailable" | "sendFailed" | null>(null);
	const sending = useRef(false);
	const question = questions[step];
	if (!question) return null;
	const last = step === questions.length - 1;

	const send = () => {
		if (sending.current || hostProtocol === null) return;
		sending.current = true;
		setPending(true);
		setFailure(null);
		const committed = committedAnswers(questions, draft);
		const legacyHost = hostProtocol < SURVEY_TRANSLATIONS_PROTOCOL_VERSION;
		void getTransport()
			.request("feedback.survey.submit", {
				submissionId,
				surveyId: survey.id,
				iteration: survey.iteration,
				...(legacyHost
					? { answers: inlineOthers(questions, committed) }
					: { ...(survey.language ? { language: survey.language } : {}), ...committed }),
			})
			.then(() => onSent())
			.catch((error: unknown) => {
				const code = wsErrorCode(error);
				if (code === "SURVEY_CHANGED") onChanged();
				else setFailure(code === "SURVEY_UNAVAILABLE" ? "unavailable" : "sendFailed");
			})
			.finally(() => {
				sending.current = false;
				setPending(false);
			});
	};

	return (
		<div className="flex flex-col gap-12">
			{step === 0 ? (
				<p data-testid="survey-notice" className="text-text-muted tr-text-metadata">
					{t("panels.survey.notice")}
				</p>
			) : null}
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
			<SurveyAnswer
				key={question.id}
				question={question}
				placeholder={survey.placeholder}
				draft={draft}
				onDraft={setDraft}
			/>
			{failure ? (
				<p role="alert" className="tr-text-metadata text-feedback-error">
					{failure === "unavailable"
						? t("panels.survey.unavailable")
						: t("panels.survey.sendFailed")}
				</p>
			) : null}
			<Button
				variant="primary"
				className="self-start"
				data-testid={last ? "survey-send" : "survey-continue"}
				disabled={pending || (last && hostProtocol === null) || !stepCanContinue(question, draft)}
				onClick={last ? send : () => setStep(step + 1)}
			>
				{last ? t("panels.survey.send") : t("panels.survey.continue")}
			</Button>
		</div>
	);
}

function SurveyAnswer({
	question,
	placeholder,
	draft,
	onDraft,
}: {
	question: SurveyQuestion;
	placeholder: string | undefined;
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
				aria-labelledby="survey-question"
				value={typeof value === "string" ? value : ""}
				placeholder={placeholder}
				onChange={(event) => onDraft(setAnswerText(draft, question.id, event.target.value))}
			/>
		);
	}
	if (question.type === "rating") {
		const selected = draft.answers[question.id];
		return (
			<div className="flex w-fit max-w-full flex-col gap-4">
				<div
					role="radiogroup"
					aria-labelledby="survey-question"
					className="flex flex-wrap gap-4"
					data-testid="survey-rating"
				>
					{ratingPoints(question).map((point) => {
						const value = String(point);
						const checked = selected === value;
						return (
							<label
								key={value}
								className={cn(
									"flex size-32 cursor-pointer items-center justify-center rounded-sm border tr-text-ui transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
									checked
										? "border-primary-muted bg-primary-subtle text-primary"
										: "border-border-default text-text-default hover:bg-control-bg-hovered",
								)}
							>
								<input
									type="radio"
									name={question.id}
									value={value}
									checked={checked}
									onChange={() => onDraft(setAnswerText(draft, question.id, value))}
									className="sr-only"
								/>
								{ratingMark(question, point)}
							</label>
						);
					})}
				</div>
				{question.lowerBoundLabel || question.upperBoundLabel ? (
					<div className="flex w-full justify-between gap-8 text-text-muted tr-text-metadata">
						<span>{question.lowerBoundLabel}</span>
						<span>{question.upperBoundLabel}</span>
					</div>
				) : null}
			</div>
		);
	}
	const single = question.type === "single_choice";
	const selected = draft.answers[question.id];
	const otherSelected = draft.otherSelected[question.id] === true;
	const body = (
		<>
			{question.choices.map((choice) => (
				<ChoiceRow
					key={choice}
					kind={single ? "radio" : "checkbox"}
					name={question.id}
					label={choice}
					checked={
						single
							? selected === choice && !otherSelected
							: Array.isArray(selected) && selected.includes(choice)
					}
					onSelect={() =>
						onDraft(
							single
								? selectSingleChoice(draft, question.id, choice)
								: toggleChoice(draft, question.id, choice),
						)
					}
				/>
			))}
			{question.hasOpenChoice ? (
				<>
					<ChoiceRow
						kind={single ? "radio" : "checkbox"}
						name={question.id}
						label={t("panels.survey.other")}
						checked={otherSelected}
						onSelect={() =>
							onDraft(
								single ? selectSingleOther(draft, question.id) : toggleOther(draft, question.id),
							)
						}
					/>
					{otherSelected ? (
						<Textarea
							rows={2}
							autoFocus
							maxLength={SURVEY_OPEN_TEXT_LIMIT}
							aria-label={t("panels.survey.other")}
							value={draft.otherText[question.id] ?? ""}
							onChange={(event) => onDraft(setOtherText(draft, question.id, event.target.value))}
						/>
					) : null}
				</>
			) : null}
		</>
	);
	return single ? (
		<div role="radiogroup" aria-labelledby="survey-question" className="flex flex-col gap-4">
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
