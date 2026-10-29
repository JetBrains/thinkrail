import { afterEach, expect, test } from "bun:test";
import {
	configureSurveySource,
	confirmInAppSurvey,
	currentInAppSurvey,
	localizeSurvey,
	parseSurveySubmission,
	refreshInAppSurvey,
	resetSurveyForTests,
	selectInAppSurvey,
	setSurveyClockForTests,
	surveyResponse,
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
						choices: ["Yes", "No", "Other"],
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

test("PostHog's last choice is the open answer whatever its label, never a second option", () => {
	const selected = selectInAppSurvey({
		surveys: [
			launched({
				questions: [
					{
						type: "single_choice",
						id: "choice-1",
						question: "Pick one",
						choices: ["Yes", "Other"],
						hasOpenChoice: true,
					},
					{
						type: "multiple_choice",
						id: "choice-2",
						question: "Pick any",
						choices: ["A", "Other"],
					},
					{
						type: "multiple_choice",
						id: "choice-3",
						question: "Pick some",
						choices: ["A", "B", "Something else"],
						hasOpenChoice: true,
						shuffleOptions: true,
					},
				],
			}),
		],
	});
	expect(selected?.questions).toEqual([
		{
			id: "choice-1",
			type: "single_choice",
			question: "Pick one",
			choices: ["Yes"],
			hasOpenChoice: true,
		},
		{
			id: "choice-2",
			type: "multiple_choice",
			question: "Pick any",
			choices: ["A", "Other"],
		},
		{
			id: "choice-3",
			type: "multiple_choice",
			question: "Pick some",
			choices: ["A", "B"],
			hasOpenChoice: true,
			shuffleOptions: true,
		},
	]);
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

const SUBMISSION_ID = "00000000-0000-4000-8000-000000000001";

function submission(answers: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
	return parseSurveySubmission({
		submissionId: SUBMISSION_ID,
		surveyId: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		iteration: 2,
		answers,
		...overrides,
	});
}

test("a finished submission becomes one survey sent payload keyed by question id", () => {
	const survey = selectInAppSurvey({ surveys: [launched()] });
	if (!survey) throw new Error("expected a survey");
	expect(surveyResponse(survey, submission({ [openQuestion.id]: "  Faster search  " }))).toEqual({
		$survey_id: survey.id,
		$survey_iteration: 2,
		$survey_submission_id: SUBMISSION_ID,
		$survey_completed: true,
		$survey_questions: [{ id: openQuestion.id, question: openQuestion.question }],
		[`$survey_response_${openQuestion.id}`]: "Faster search",
	});
	expect(() => surveyResponse(survey, submission({}))).toThrow("Invalid survey answer");
	expect(() => surveyResponse(survey, submission({ unknown: "x" }))).toThrow(
		"Invalid survey answer",
	);
});

test("a submission must name its survey version and a v4 submission id", () => {
	expect(submission({}).surveyId).toBe("01a17d9c-e8d7-0000-dbbb-79aad51d2281");
	for (const overrides of [
		{ submissionId: "nope" },
		{ surveyId: "" },
		{ surveyId: 7 },
		{ iteration: -1 },
		{ iteration: 1.5 },
		{ iteration: "2" },
	]) {
		expect(() => submission({}, overrides)).toThrow("Invalid survey submission");
	}
	expect(() => submission({ q: 3 })).toThrow("Invalid survey submission");
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
						choices: ["One", "Two", "Other"],
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
	const properties = surveyResponse(
		survey,
		submission({ multi: ["Two"], rate: "4" }, { others: { multi: "  Something else  " } }),
	);
	expect(properties.$survey_response_multi).toEqual(["Two", "Something else"]);
	expect(properties.$survey_response_rate).toBe("4");
	expect(() => surveyResponse(survey, submission({ multi: ["One"], rate: "9" }))).toThrow(
		"Invalid survey answer",
	);
	expect(
		surveyResponse(survey, submission({ multi: ["One"] })).$survey_response_rate,
	).toBeUndefined();
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

test("a failed refresh drops a copy older than the stale lifetime, and confirm always fetches", async () => {
	let calls = 0;
	let status = 200;
	let iteration = 2;
	const fetchImpl = (() => {
		calls += 1;
		if (status !== 200) return Promise.resolve(new Response("nope", { status }));
		return Promise.resolve(
			new Response(JSON.stringify({ surveys: [launched({ current_iteration: iteration })] }), {
				status: 200,
			}),
		);
	}) as unknown as typeof fetch;
	let at = 1_000;
	setSurveyClockForTests(() => at);
	configureSurveySource({ apiKey: "phc_test", fetchImpl });
	expect((await refreshInAppSurvey())?.iteration).toBe(2);

	iteration = 3;
	expect((await refreshInAppSurvey())?.iteration).toBe(2);
	expect((await confirmInAppSurvey())?.iteration).toBe(3);
	expect(calls).toBe(2);

	status = 500;
	await expect(confirmInAppSurvey()).rejects.toThrow("survey list failed");
	expect(currentInAppSurvey()?.iteration).toBe(3);
	at += 45 * 60 * 1000;
	expect((await refreshInAppSurvey())?.iteration).toBe(3);
	at += 15 * 60 * 1000;
	expect(await refreshInAppSurvey()).toBeNull();
	expect(currentInAppSurvey()).toBeNull();
});

test("a cached copy expires an hour after its last successful read, even between retries", async () => {
	let status = 200;
	const fetchImpl = (() =>
		Promise.resolve(
			status === 200
				? new Response(JSON.stringify({ surveys: [launched()] }), { status: 200 })
				: new Response("nope", { status }),
		)) as unknown as typeof fetch;
	let at = 1_000;
	setSurveyClockForTests(() => at);
	configureSurveySource({ apiKey: "phc_test", fetchImpl });
	expect(await refreshInAppSurvey()).not.toBeNull();

	status = 500;
	at += 59 * 60 * 1000;
	expect(await refreshInAppSurvey()).not.toBeNull();
	at += 2 * 60 * 1000;
	expect(currentInAppSurvey()).toBeNull();
	expect(await refreshInAppSurvey()).toBeNull();
});

const translatedSurvey = () =>
	selectInAppSurvey([
		launched({
			translations: { fr: { thankYouMessageHeader: "Merci !" }, "pt-br": { name: "x" } },
			questions: [
				{
					type: "single_choice",
					id: "pick",
					question: "Pick one",
					choices: ["Great", "Okay"],
					hasOpenChoice: true,
					translations: {
						FR: { question: "Choisissez", choices: ["Super", "Correct"] },
						de: { question: "Wählen", choices: ["Toll"] },
						"zh-cn": { question: "选择一个", choices: ["很好", "还行"] },
					},
				},
				{
					type: "rating",
					id: "rate",
					question: "Score",
					display: "number",
					scale: 5,
					lowerBoundLabel: "Bad",
					upperBoundLabel: "Good",
					translations: { fr: { lowerBoundLabel: "<b>Mauvais</b>" }, xx_bad: { question: "?" } },
				},
			],
		}),
	]);

test("a survey is localized by exact tag, then base language, else left as written", () => {
	const survey = translatedSurvey();
	if (!survey) throw new Error("expected a survey");
	expect(localizeSurvey(survey, undefined)).toBe(survey);
	expect(localizeSurvey(survey, "ja")).toBe(survey);

	const french = localizeSurvey(survey, "fr-CA");
	expect(french.language).toBe("fr");
	expect(french.thankYou).toBe("Merci !");
	expect(french.questions[0]).toMatchObject({
		question: "Choisissez",
		choices: ["Super", "Correct"],
	});
	expect(french.questions[1]).toMatchObject({
		question: "Score",
		lowerBoundLabel: "Mauvais",
		upperBoundLabel: "Good",
	});

	const german = localizeSurvey(survey, "de");
	expect(german.language).toBe("de");
	expect(german.questions[0]).toMatchObject({ question: "Wählen", choices: ["Great", "Okay"] });

	expect(localizeSurvey(survey, "zh-CN").questions[0]).toMatchObject({ question: "选择一个" });
	expect(localizeSurvey(survey, "pt-BR")).toBe(survey);
});

test("a translated answer is sent as the original choice with the language it was shown in", () => {
	const survey = translatedSurvey();
	if (!survey) throw new Error("expected a survey");
	const french = (answers: Record<string, unknown>, language = "fr") =>
		parseSurveySubmission({
			submissionId: SUBMISSION_ID,
			surveyId: survey.id,
			iteration: 2,
			language,
			answers,
			others: {},
		});
	const properties = surveyResponse(survey, french({ pick: "Super", rate: "4" }));
	expect(properties.$survey_language).toBe("fr");
	expect(properties.$survey_response_pick).toBe("Great");
	expect(properties.$survey_questions).toEqual([
		{ id: "pick", question: "Pick one" },
		{ id: "rate", question: "Score" },
	]);
	const typed = (other: string) =>
		surveyResponse(
			survey,
			parseSurveySubmission({
				...submissionShape(survey),
				language: "fr",
				answers: { rate: "4" },
				others: { pick: other },
			}),
		).$survey_response_pick;
	expect(typed("Autre chose")).toBe("Autre chose");
	expect(typed("Super")).toBe("Super");
	expect(typed("Great")).toBe("Great");
	expect(() => surveyResponse(survey, french({ pick: "Great", rate: "4" }))).toThrow(
		"Invalid survey answer",
	);
	expect(() => surveyResponse(survey, french({ pick: "Super", rate: "4" }, "es"))).toThrow(
		"Invalid survey answer",
	);
	expect(
		surveyResponse(
			survey,
			parseSurveySubmission({ ...submissionShape(survey), answers: { pick: "Okay", rate: "1" } }),
		).$survey_language,
	).toBeUndefined();
	expect(() => french({}, "FR")).toThrow("Invalid survey submission");
});

function submissionShape(survey: { id: string }) {
	return { submissionId: SUBMISSION_ID, surveyId: survey.id, iteration: 2 };
}

test("Other text is never mistaken for a choice, and a choice never for Other text", () => {
	const survey = selectInAppSurvey([
		launched({
			questions: [
				{
					type: "multiple_choice",
					id: "multi",
					question: "Which?",
					choices: ["Great", "Okay"],
					hasOpenChoice: true,
					translations: { fr: { choices: ["Super", "Correct"] } },
				},
				{ type: "single_choice", id: "one", question: "One?", choices: ["A", "B"] },
			],
		}),
	]);
	if (!survey) throw new Error("expected a survey");
	const send = (fields: Record<string, unknown>) =>
		surveyResponse(
			survey,
			parseSurveySubmission({ ...submissionShape(survey), language: "fr", others: {}, ...fields }),
		);
	expect(
		send({ answers: { multi: ["Correct", "Super"], one: "A" }, others: { multi: "Super" } })
			.$survey_response_multi,
	).toEqual(["Okay", "Great", "Super"]);
	expect(
		send({ answers: { one: "A" }, others: { multi: "Great" } }).$survey_response_multi,
	).toEqual(["Great"]);
	expect(() => send({ answers: { multi: ["Other"], one: "A" } })).toThrow("Invalid survey answer");
	expect(() => send({ answers: { multi: ["Super"] }, others: { one: "C" } })).toThrow(
		"Invalid survey answer",
	);
	expect(() => send({ answers: { multi: ["Super"], one: "A" }, others: { one: "A" } })).toThrow(
		"Invalid survey answer",
	);
	expect(() => send({ answers: { multi: ["Super"], one: "A" }, others: 3 })).toThrow(
		"Invalid survey submission",
	);
});

test("a pre-v98 client's inline Other text is still told apart from its picked choices", () => {
	const survey = selectInAppSurvey([
		launched({
			questions: [
				{
					type: "multiple_choice",
					id: "m",
					question: "Which?",
					choices: ["Great", "Okay"],
					hasOpenChoice: true,
				},
				{
					type: "single_choice",
					id: "s",
					question: "One?",
					choices: ["A", "B"],
					hasOpenChoice: true,
					optional: true,
				},
			],
		}),
	]);
	if (!survey) throw new Error("expected a survey");
	const legacy = (answers: Record<string, unknown>) =>
		surveyResponse(survey, parseSurveySubmission({ ...submissionShape(survey), answers }));
	expect(legacy({ m: ["Great", " keep this typed answer "], s: "B" })).toMatchObject({
		$survey_response_m: ["Great", "keep this typed answer"],
		$survey_response_s: "B",
	});
	expect(legacy({ m: ["Only typed"], s: "Something else" })).toMatchObject({
		$survey_response_m: ["Only typed"],
		$survey_response_s: "Something else",
	});
	expect(() => legacy({ m: ["one", "two"] })).toThrow("Invalid survey answer");
});
