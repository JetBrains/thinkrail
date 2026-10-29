import {
	type AppSurvey,
	SURVEY_OPEN_TEXT_LIMIT,
	type SurveyAnswerValue,
	type SurveyQuestion,
	type SurveyRatingQuestion,
	surveyRatingValues,
} from "@thinkrail/contracts";

const RATING_EMOJI = {
	3: ["😞", "😐", "😊"],
	5: ["😠", "😞", "😐", "😊", "😍"],
} as const;

export interface SurveyDraft {
	answers: Record<string, SurveyAnswerValue>;
	otherSelected: Record<string, true>;
	otherText: Record<string, string>;
}

export function emptySurveyDraft(): SurveyDraft {
	return { answers: {}, otherSelected: {}, otherText: {} };
}

export function presentSurvey(
	survey: AppSurvey,
	random: () => number = Math.random,
): SurveyQuestion[] {
	const questions = survey.shuffleQuestions
		? shuffle(survey.questions, random)
		: [...survey.questions];
	return questions.map((question) =>
		(question.type === "single_choice" || question.type === "multiple_choice") &&
		question.shuffleOptions
			? { ...question, choices: shuffle(question.choices, random) }
			: question,
	);
}

export function ratingMark(question: SurveyRatingQuestion, value: number): string {
	if (question.display === "emoji" && (question.scale === 3 || question.scale === 5)) {
		return RATING_EMOJI[question.scale][value - 1] ?? String(value);
	}
	return String(value);
}

export function ratingPoints(question: SurveyRatingQuestion): number[] {
	return surveyRatingValues(question.scale);
}

export function thankYouText(survey: AppSurvey, fallback: string): string {
	return survey.thankYou || fallback;
}

export function selectSingleChoice(draft: SurveyDraft, id: string, choice: string): SurveyDraft {
	const otherSelected = { ...draft.otherSelected };
	delete otherSelected[id];
	return { ...draft, answers: { ...draft.answers, [id]: choice }, otherSelected };
}

export function selectSingleOther(draft: SurveyDraft, id: string): SurveyDraft {
	const answers = { ...draft.answers };
	delete answers[id];
	return { ...draft, answers, otherSelected: { ...draft.otherSelected, [id]: true } };
}

export function toggleChoice(draft: SurveyDraft, id: string, choice: string): SurveyDraft {
	const current = stringList(draft.answers[id]);
	const next = current.includes(choice)
		? current.filter((item) => item !== choice)
		: [...current, choice];
	return { ...draft, answers: { ...draft.answers, [id]: next } };
}

export function toggleOther(draft: SurveyDraft, id: string): SurveyDraft {
	const otherSelected = { ...draft.otherSelected };
	if (otherSelected[id]) delete otherSelected[id];
	else otherSelected[id] = true;
	return { ...draft, otherSelected };
}

export function setAnswerText(draft: SurveyDraft, id: string, text: string): SurveyDraft {
	return { ...draft, answers: { ...draft.answers, [id]: text } };
}

export function setOtherText(draft: SurveyDraft, id: string, text: string): SurveyDraft {
	return { ...draft, otherText: { ...draft.otherText, [id]: text } };
}

export function stepCanContinue(question: SurveyQuestion, draft: SurveyDraft): boolean {
	if (question.type === "open")
		return question.optional === true || openText(draft, question.id) !== "";
	if (question.type === "rating") {
		return question.optional === true || typeof draft.answers[question.id] === "string";
	}
	if (question.type === "single_choice") {
		if (draft.otherSelected[question.id]) return otherText(draft, question.id) !== "";
		const value = draft.answers[question.id];
		if (typeof value === "string" && question.choices.includes(value)) return true;
		return question.optional === true;
	}
	if (draft.otherSelected[question.id] && otherText(draft, question.id) === "") return false;
	const chosen = stringList(draft.answers[question.id]);
	return (
		question.optional === true || chosen.length > 0 || draft.otherSelected[question.id] === true
	);
}

export function committedAnswers(
	questions: readonly SurveyQuestion[],
	draft: SurveyDraft,
): { answers: Record<string, SurveyAnswerValue>; others: Record<string, string> } {
	const answers: Record<string, SurveyAnswerValue> = {};
	const others: Record<string, string> = {};
	for (const question of questions) {
		const value = committedValue(question, draft);
		if (value !== undefined) answers[question.id] = value;
		if (question.type !== "single_choice" && question.type !== "multiple_choice") continue;
		const other = draft.otherSelected[question.id] ? otherText(draft, question.id) : "";
		if (other) others[question.id] = other;
	}
	return { answers, others };
}

export function inlineOthers(
	questions: readonly SurveyQuestion[],
	committed: ReturnType<typeof committedAnswers>,
): Record<string, SurveyAnswerValue> {
	const answers = { ...committed.answers };
	for (const question of questions) {
		const other = committed.others[question.id];
		if (other === undefined) continue;
		const picked = answers[question.id];
		answers[question.id] =
			question.type === "multiple_choice" ? [...stringList(picked), other] : other;
	}
	return answers;
}

function committedValue(
	question: SurveyQuestion,
	draft: SurveyDraft,
): SurveyAnswerValue | undefined {
	if (question.type === "open") {
		const text = openText(draft, question.id);
		return text ? text : undefined;
	}
	if (question.type === "rating") {
		const value = draft.answers[question.id];
		return typeof value === "string" ? value : undefined;
	}
	if (question.type === "single_choice") {
		if (draft.otherSelected[question.id]) return undefined;
		const value = draft.answers[question.id];
		return typeof value === "string" && question.choices.includes(value) ? value : undefined;
	}
	const chosen = stringList(draft.answers[question.id]).filter((choice) =>
		question.choices.includes(choice),
	);
	return chosen.length > 0 ? chosen : undefined;
}

function openText(draft: SurveyDraft, id: string): string {
	const value = draft.answers[id];
	return typeof value === "string" ? value.trim().slice(0, SURVEY_OPEN_TEXT_LIMIT) : "";
}

function otherText(draft: SurveyDraft, id: string): string {
	return (draft.otherText[id] ?? "").trim().slice(0, SURVEY_OPEN_TEXT_LIMIT);
}

function stringList(value: SurveyAnswerValue | undefined): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
	const next = [...items];
	for (let index = next.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const current = next[index];
		const other = next[swap];
		if (current === undefined || other === undefined) continue;
		next[index] = other;
		next[swap] = current;
	}
	return next;
}
