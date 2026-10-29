import { expect, test } from "bun:test";
import type { AppSurvey, SurveyQuestion } from "@thinkrail/contracts";
import {
	committedAnswers,
	emptySurveyDraft,
	inlineOthers,
	presentSurvey,
	selectSingleChoice,
	selectSingleOther,
	setAnswerText,
	setOtherText,
	stepCanContinue,
	thankYouText,
	toggleChoice,
	toggleOther,
} from "./surveyDraft";

const openQuestion: SurveyQuestion = {
	id: "open",
	type: "open",
	question: "What can we improve?",
};

const rating: SurveyQuestion = {
	id: "rate",
	type: "rating",
	question: "Score",
	display: "number",
	scale: 5,
	lowerBoundLabel: "Bad",
	upperBoundLabel: "Good",
};

const checks: SurveyQuestion = {
	id: "multi",
	type: "multiple_choice",
	question: "Which?",
	choices: ["One", "Two"],
	hasOpenChoice: true,
};

function survey(questions: SurveyQuestion[], extras: Partial<AppSurvey> = {}): AppSurvey {
	return { id: "survey-1", iteration: 1, questions, ...extras };
}

test("questions and choices shuffle once, and Other stays outside the choice list", () => {
	const first: SurveyQuestion = {
		id: "one",
		type: "single_choice",
		question: "Pick",
		choices: ["Yes", "No", "Maybe"],
		shuffleOptions: true,
		hasOpenChoice: true,
	};
	const presented = presentSurvey(
		survey([openQuestion, rating, first], { shuffleQuestions: true }),
		() => 0,
	);
	expect(presented.map((question) => question.id)).toEqual(["rate", "one", "open"]);
	expect(presented.find((question) => question.id === "one")).toMatchObject({
		choices: ["No", "Maybe", "Yes"],
		hasOpenChoice: true,
	});
	expect(presentSurvey(survey([openQuestion, rating])).map((question) => question.id)).toEqual([
		"open",
		"rate",
	]);
});

test("required steps block Continue until they have a value", () => {
	const draft = emptySurveyDraft();
	expect(stepCanContinue(openQuestion, draft)).toBe(false);
	expect(stepCanContinue({ ...openQuestion, optional: true }, draft)).toBe(true);
	const answered = setAnswerText(draft, "open", "  Faster search  ");
	expect(stepCanContinue(openQuestion, answered)).toBe(true);
	expect(committedAnswers([openQuestion], answered)).toEqual({
		answers: { open: "Faster search" },
		others: {},
	});
	expect(thankYouText(survey([openQuestion], { thankYou: "" }), "Thanks")).toBe("Thanks");
	expect(thankYouText(survey([openQuestion]), "Thanks")).toBe("Thanks");
	expect(thankYouText(survey([openQuestion], { thankYou: "Merci" }), "Thanks")).toBe("Merci");
});

test("rating and checkbox answers keep the values PostHog records", () => {
	const rated = setAnswerText(emptySurveyDraft(), "rate", "4");
	expect(stepCanContinue(rating, rated)).toBe(true);
	let draft = toggleChoice(emptySurveyDraft(), "multi", "Two");
	expect(stepCanContinue(checks, draft)).toBe(true);
	draft = toggleOther(draft, "multi");
	expect(stepCanContinue(checks, draft)).toBe(false);
	draft = setOtherText(draft, "multi", " Something else ");
	expect(
		committedAnswers([rating, checks], { ...draft, answers: { ...draft.answers, rate: "4" } }),
	).toEqual({
		answers: { rate: "4", multi: ["Two"] },
		others: { multi: "Something else" },
	});

	const single = selectSingleChoice(emptySurveyDraft(), "one", "Yes");
	const choice: SurveyQuestion = {
		id: "one",
		type: "single_choice",
		question: "Pick",
		choices: ["Yes", "No"],
	};
	expect(committedAnswers([choice], single)).toEqual({ answers: { one: "Yes" }, others: {} });
	const typedOther = setOtherText(selectSingleOther(single, "one"), "one", "Yes");
	expect(committedAnswers([{ ...choice, hasOpenChoice: true }], typedOther)).toEqual({
		answers: {},
		others: { one: "Yes" },
	});
});

test("a pre-v98 host gets Other text inline, the shape it parses", () => {
	const multi: SurveyQuestion = {
		id: "m",
		type: "multiple_choice",
		question: "Which?",
		choices: ["Great", "Okay"],
		hasOpenChoice: true,
	};
	const single: SurveyQuestion = { ...multi, id: "s", type: "single_choice" };
	const committed = {
		answers: { m: ["Great"] },
		others: { m: "keep this typed answer", s: "Something else" },
	};
	expect(inlineOthers([multi, single], committed)).toEqual({
		m: ["Great", "keep this typed answer"],
		s: "Something else",
	});
	expect(inlineOthers([multi], { answers: {}, others: { m: "Only typed" } })).toEqual({
		m: ["Only typed"],
	});
});
