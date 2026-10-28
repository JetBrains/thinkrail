import { afterEach, expect, test } from "bun:test";
import {
	configureSurveySource,
	currentInAppSurvey,
	parseSurveySubmission,
	refreshInAppSurvey,
	resetSurveyForTests,
	selectInAppSurvey,
	setSurveyClockForTests,
	surveyCapture,
} from "./survey";

afterEach(() => {
	resetSurveyForTests();
});

const openQuestion = {
	id: "98283ced-ad26-4913-ab32-ab56441ff1ed",
	type: "open",
	question: "What can we do to improve our product?",
	description: "<b>Test</b>",
	descriptionContentType: "html",
};

function launched(overrides: Record<string, unknown> = {}) {
	return {
		id: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		name: "in-app-feedback",
		type: "popover",
		start_date: "2026-10-28T00:00:00.000Z",
		end_date: null,
		archived: false,
		current_iteration: 2,
		questions: [openQuestion],
		appearance: {
			placeholder: "Start typing...",
			thankYouMessageHeader: "Thank you for your feedback!",
			displayThankYouMessage: true,
			shuffleQuestions: false,
		},
		...overrides,
	};
}

test("selects the newest launched in-app survey and drops unsupported questions", () => {
	const selected = selectInAppSurvey({
		surveys: [
			launched({
				id: "older",
				start_date: "2026-10-01T00:00:00.000Z",
				current_iteration: null,
			}),
			{ ...launched(), name: "download" },
			launched({ start_date: null }),
			launched({ end_date: "2026-11-01T00:00:00.000Z" }),
			launched({ archived: true }),
			launched({
				questions: [
					{ type: "link", id: "link-1", question: "Read this", link: "https://thinkrail.ai" },
					{
						type: "rating",
						id: "rate-1",
						question: "How is it?",
						display: "emoji",
						scale: 10,
						lowerBoundLabel: "Low",
						upperBoundLabel: "High",
					},
					{
						type: "single_choice",
						id: "choice-1",
						question: "Pick one",
						choices: ["Yes", "No"],
						hasOpenChoice: true,
						shuffleOptions: true,
						optional: true,
						buttonText: "Next",
					},
					{
						type: "multiple_choice",
						id: "choice-2",
						question: "Pick any",
						choices: ["A", "B"],
					},
					openQuestion,
				],
			}),
		],
	});

	expect(selected).toEqual({
		id: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		iteration: 2,
		placeholder: "Start typing...",
		thankYou: "Thank you for your feedback!",
		questions: [
			{
				id: "rate-1",
				type: "rating",
				question: "How is it?",
				display: "number",
				scale: 10,
				lowerBoundLabel: "Low",
				upperBoundLabel: "High",
			},
			{
				id: "choice-1",
				type: "single_choice",
				question: "Pick one",
				choices: ["Yes", "No"],
				hasOpenChoice: true,
				shuffleOptions: true,
				optional: true,
				buttonText: "Next",
			},
			{
				id: "choice-2",
				type: "multiple_choice",
				question: "Pick any",
				choices: ["A", "B"],
			},
			{
				id: openQuestion.id,
				type: "open",
				question: openQuestion.question,
				description: "Test",
			},
		],
	});
});

test("a survey with no drawable questions and a declined thank-you are absent", () => {
	expect(
		selectInAppSurvey({
			surveys: [launched({ questions: [{ type: "link", id: "only", question: "Docs" }] })],
		}),
	).toBeNull();
	expect(
		selectInAppSurvey({
			surveys: [launched({ appearance: { displayThankYouMessage: false, placeholder: "  " } })],
		}),
	).toEqual({
		id: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		iteration: 2,
		questions: [
			{
				id: openQuestion.id,
				type: "open",
				question: openQuestion.question,
				description: "Test",
			},
		],
	});
});

test("a missing iteration is a single run and emoji ratings stay emoji on short scales", () => {
	const selected = selectInAppSurvey([
		launched({
			current_iteration: null,
			questions: [
				{
					type: "rating",
					id: "rate-3",
					question: "Mood",
					display: "emoji",
					scale: 3,
					lowerBoundLabel: "",
					upperBoundLabel: "",
				},
			],
		}),
	]);
	expect(selected?.iteration).toBe(0);
	expect(selected?.questions[0]).toMatchObject({ display: "emoji", scale: 3 });
});

test("survey capture uses question ids and rejects an unfinished required set", () => {
	const survey = selectInAppSurvey({ surveys: [launched()] });
	if (!survey) throw new Error("expected a survey");
	const submissionId = "00000000-0000-4000-8000-000000000001";
	expect(surveyCapture(survey, parseSurveySubmission({ submissionId, event: "shown" }))).toEqual({
		name: "survey shown",
		completed: false,
		properties: {
			$survey_id: survey.id,
			$survey_iteration: 2,
			$survey_submission_id: submissionId,
		},
	});
	expect(
		surveyCapture(
			survey,
			parseSurveySubmission({
				submissionId,
				event: "sent",
				completed: true,
				answers: { [openQuestion.id]: "  Faster search  " },
			}),
		),
	).toMatchObject({
		name: "survey sent",
		completed: true,
		properties: {
			$survey_completed: true,
			[`$survey_response_${openQuestion.id}`]: "Faster search",
		},
	});
	expect(() =>
		surveyCapture(
			survey,
			parseSurveySubmission({ submissionId, event: "sent", completed: true, answers: {} }),
		),
	).toThrow("Invalid survey answer");
	expect(() => parseSurveySubmission({ submissionId: "nope", event: "shown" })).toThrow(
		"Invalid survey submission",
	);
});

test("choice and rating answers keep PostHog's value shapes", () => {
	const survey = selectInAppSurvey({
		surveys: [
			launched({
				questions: [
					{
						type: "multiple_choice",
						id: "multi",
						question: "Which?",
						choices: ["One", "Two"],
						hasOpenChoice: true,
					},
					{
						type: "rating",
						id: "rate",
						question: "Score",
						display: "number",
						scale: 5,
						lowerBoundLabel: "Bad",
						upperBoundLabel: "Good",
						optional: true,
					},
				],
			}),
		],
	});
	if (!survey) throw new Error("expected a survey");
	const properties = surveyCapture(
		survey,
		parseSurveySubmission({
			submissionId: "00000000-0000-4000-8000-000000000002",
			event: "sent",
			completed: false,
			answers: { multi: ["Two", "  Something else  "], rate: "4" },
		}),
	).properties;
	expect(properties.$survey_response_multi).toEqual(["Two", "Something else"]);
	expect(properties.$survey_response_rate).toBe("4");
	expect(() =>
		surveyCapture(
			survey,
			parseSurveySubmission({
				submissionId: "00000000-0000-4000-8000-000000000002",
				event: "sent",
				completed: false,
				answers: { rate: "9" },
			}),
		),
	).toThrow("Invalid survey answer");
});

test("a failed refresh keeps the last survey and a fresh one waits out the interval", async () => {
	let calls = 0;
	let status = 200;
	const fetchImpl = (() => {
		calls += 1;
		if (status !== 200) return Promise.resolve(new Response("nope", { status }));
		return Promise.resolve(
			new Response(JSON.stringify({ surveys: [launched()] }), { status: 200 }),
		);
	}) as unknown as typeof fetch;
	let at = 1_000;
	setSurveyClockForTests(() => at);
	configureSurveySource({ apiKey: "phc_test", host: "https://eu.i.posthog.com", fetchImpl });

	expect((await refreshInAppSurvey())?.id).toBe("01a17d9c-e8d7-0000-dbbb-79aad51d2281");
	expect(calls).toBe(1);
	await refreshInAppSurvey();
	expect(calls).toBe(1);

	status = 500;
	at += 15 * 60 * 1000;
	expect((await refreshInAppSurvey())?.id).toBe("01a17d9c-e8d7-0000-dbbb-79aad51d2281");
	expect(currentInAppSurvey()?.iteration).toBe(2);
	expect(calls).toBe(2);

	configureSurveySource(null);
	expect(currentInAppSurvey()).toBeNull();
});
