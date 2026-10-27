import { describe, expect, test } from "bun:test";
import {
	downloadPostHogSurveyId,
	downloadSurveySteps,
	orderedChoices,
	stepCanContinue,
	surveyAnswerValue,
	surveySentProperties,
} from "./downloadSurvey";

const interest = downloadSurveySteps[0];
const experience = downloadSurveySteps[1];
const tools = downloadSurveySteps[2];
const dissatisfaction = downloadSurveySteps[3];
const firstTry = downloadSurveySteps[4];
const email = downloadSurveySteps[5];

if (
	interest === undefined ||
	experience === undefined ||
	tools === undefined ||
	dissatisfaction === undefined ||
	firstTry === undefined ||
	email === undefined
) {
	throw new Error("download survey is missing a step");
}

describe("download survey", () => {
	test("keeps a custom answer last and shuffles the rest", () => {
		const random = [0, 0.9, 0.2, 0.4, 0.1];
		let call = 0;
		const ordered = orderedChoices(interest, () => random[call++] ?? 0);
		expect(ordered.at(-1)?.id).toBe("other");
		expect(
			ordered
				.map((choice) => choice.id)
				.slice(0, -1)
				.sort(),
		).toEqual(
			interest.choices
				.filter((choice) => choice.custom !== true)
				.map((choice) => choice.id)
				.sort(),
		);
		expect(orderedChoices(experience, () => 0).some((choice) => choice.custom)).toBe(false);
	});

	test("requires a choice, and text when the custom choice is selected", () => {
		expect(stepCanContinue(interest, [], "")).toBe(false);
		expect(stepCanContinue(interest, ["pi_gui"], "")).toBe(true);
		expect(stepCanContinue(interest, ["other"], "  ")).toBe(false);
		expect(stepCanContinue(interest, ["other"], "the graph")).toBe(true);
		expect(stepCanContinue(dissatisfaction, ["cost", "slow_tools", "other"], "")).toBe(false);
		expect(
			stepCanContinue(dissatisfaction, ["cost", "slow_tools", "reviewing_ai", "other"], "x"),
		).toBe(false);
		expect(stepCanContinue(firstTry, [], "")).toBe(true);
		expect(stepCanContinue(email, [], "")).toBe(true);
	});

	test("records each answer on the PostHog survey and marks only the last send complete", () => {
		expect(surveyAnswerValue(interest, ["trying_tools", "not-a-choice"], "")).toEqual([
			"Trying new tools",
		]);
		expect(surveyAnswerValue(interest, ["other"], "  the graph  ")).toEqual(["the graph"]);
		expect(surveyAnswerValue(experience, ["codes_self", "ai_chats"], "")).toEqual([
			"I code myself",
			"I use AI suggestions and chats",
		]);
		const partial = surveySentProperties({
			submissionId: "response-1",
			contentKey: "landing",
			ctaLocation: "hero",
			answers: { [interest.questionId]: ["Trying new tools"] },
			completed: false,
		});
		expect(partial).toMatchObject({
			$survey_id: downloadPostHogSurveyId,
			$survey_submission_id: "response-1",
			$survey_completed: false,
			content_key: "landing",
			cta_location: "hero",
			[`$survey_response_${interest.questionId}`]: ["Trying new tools"],
		});
		expect(partial.$survey_questions).toHaveLength(6);
		expect(
			surveySentProperties({
				submissionId: "response-1",
				contentKey: "landing",
				answers: { [email.questionId]: "ada@example.com" },
				completed: true,
			}).$survey_completed,
		).toBe(true);
		expect(surveyAnswerValue(firstTry, [], "  ")).toBeUndefined();
	});

	test("asks for tools in two columns and limits dissatisfaction to three", () => {
		expect(tools.columns).toBe(true);
		expect(tools.choices).toHaveLength(11);
		expect(dissatisfaction.max).toBe(3);
		expect(email.action).toBe("Finish");
	});
});
