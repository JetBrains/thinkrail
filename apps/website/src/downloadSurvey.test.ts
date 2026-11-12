import { describe, expect, test } from "bun:test";
import type { WebsiteSurveySentProperties } from "@thinkrail/website-analytics";
import {
	answerSurveyStep,
	downloadPostHogSurveyId,
	downloadSurveyCompletionKey,
	downloadSurveySteps,
	orderedChoices,
	rememberSurveyCompleted,
	type SurveyPlace,
	type SurveyResponse,
	startSurveyResponse,
	stepCanContinue,
	surveyAnswerValue,
	surveyCompletedBefore,
	surveyDismissedProperties,
	surveySentProperties,
	surveyShownProperties,
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
		expect(email.email).toBe(true);
		expect(downloadSurveySteps.filter((step) => step.hint !== undefined)).toEqual([
			interest,
			tools,
		]);
	});
});

const place: SurveyPlace = { content_key: "landing", cta_location: "hero" };

function answerAll(
	response: SurveyResponse,
	answers: ReadonlyArray<readonly [readonly string[], string]>,
): WebsiteSurveySentProperties[] {
	const sends: WebsiteSurveySentProperties[] = [];
	let current = response;
	for (const [position, step] of downloadSurveySteps.entries()) {
		const [selected, freeText] = answers[position] ?? [[], ""];
		const answered = answerSurveyStep(current, step, selected, freeText, place);
		if (answered === undefined) throw new Error(`step ${step.index} was rejected`);
		current = answered.response;
		sends.push(answered.properties);
	}
	return sends;
}

function responseKeys(properties: WebsiteSurveySentProperties): string[] {
	return Object.keys(properties).filter((key) => key.startsWith("$survey_response_"));
}

describe("download survey response", () => {
	test("one submission id carries every answer so far and only the last step completes it", () => {
		const sends = answerAll(
			startSurveyResponse("response-1", () => 0),
			[
				[["pi_gui", "spec_driven"], ""],
				[["codes_self"], ""],
				[["cursor", "other"], "Helix"],
				[["cost"], ""],
				[[], "try the spec graph"],
				[[], "ada@example.com"],
			],
		);

		expect(sends.map((send) => send.$survey_submission_id)).toEqual(
			Array(downloadSurveySteps.length).fill("response-1"),
		);
		expect(sends.map((send) => send.$survey_completed)).toEqual([
			false,
			false,
			false,
			false,
			false,
			true,
		]);
		expect(sends.map((send) => responseKeys(send).length)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(sends.at(-1)).toMatchObject({
			$survey_id: downloadPostHogSurveyId,
			content_key: "landing",
			cta_location: "hero",
			[`$survey_response_${interest.questionId}`]: [
				"Graphical interface for Pi",
				"Spec-driven development",
			],
			[`$survey_response_${tools.questionId}`]: ["Cursor", "Helix"],
			[`$survey_response_${firstTry.questionId}`]: "try the spec graph",
			[`$survey_response_${email.questionId}`]: "ada@example.com",
		});
	});

	test("blank optional answers are left out of every send", () => {
		const sends = answerAll(
			startSurveyResponse("response-1", () => 0),
			[
				[["pi_gui"], ""],
				[["codes_self"], ""],
				[["cursor"], ""],
				[["cost"], ""],
				[[], "  "],
				[[], ""],
			],
		);

		expect(sends.map((send) => responseKeys(send).length)).toEqual([1, 2, 3, 4, 4, 4]);
		expect(sends.at(-1)?.$survey_completed).toBe(true);
	});

	test("an invalid step sends nothing and leaves the response untouched", () => {
		const response = startSurveyResponse("response-1", () => 0);

		expect(answerSurveyStep(response, interest, [], "", place)).toBeUndefined();
		expect(answerSurveyStep(response, interest, ["other"], "  ", place)).toBeUndefined();
		expect(response).toMatchObject({ answers: {}, sent: false });
	});

	test("a response is dismissed only before its first send", () => {
		const response = startSurveyResponse("response-1", () => 0);
		const answered = answerSurveyStep(response, interest, ["pi_gui"], "", place);

		expect(surveyDismissedProperties(response, place)).toEqual({
			$survey_id: downloadPostHogSurveyId,
			content_key: "landing",
			cta_location: "hero",
		});
		expect(answered?.response.sent).toBe(true);
		if (answered === undefined) throw new Error("expected the first step to be accepted");
		expect(surveyDismissedProperties(answered.response, place)).toBeUndefined();
		expect(response.sent).toBe(false);
	});

	test("each response starts with its own id, no answers, and a fresh choice order", () => {
		const first = startSurveyResponse("response-1", () => 0);
		const second = startSurveyResponse("response-2", () => 0.99);
		const choiceIds = (response: SurveyResponse) =>
			response.order.map((choices) => choices.map((choice) => choice.id));

		expect([first.id, second.id]).toEqual(["response-1", "response-2"]);
		expect(second.answers).toEqual({});
		expect(choiceIds(first)).not.toEqual(choiceIds(second));
		for (const response of [first, second]) {
			for (const [position, step] of downloadSurveySteps.entries()) {
				const custom = step.choices.find((choice) => choice.custom === true);
				if (custom !== undefined) expect(response.order[position]?.at(-1)).toBe(custom);
			}
		}
	});

	test("a finished survey is remembered by its id only", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
		};

		expect(surveyCompletedBefore(storage)).toBe(false);
		rememberSurveyCompleted(storage);
		expect(surveyCompletedBefore(storage)).toBe(true);
		expect([...values]).toEqual([[downloadSurveyCompletionKey, downloadPostHogSurveyId]]);

		values.set(downloadSurveyCompletionKey, "an-older-survey");
		expect(surveyCompletedBefore(storage)).toBe(false);
	});

	test("unavailable storage never throws and never counts as finished", () => {
		const denied = {
			getItem(): string | null {
				throw new Error("denied");
			},
			setItem(): void {
				throw new Error("denied");
			},
		};

		expect(() => rememberSurveyCompleted(denied)).not.toThrow();
		expect(surveyCompletedBefore(denied)).toBe(false);
		expect(surveyCompletedBefore(undefined)).toBe(false);
	});

	test("a showing names the survey and where the download was", () => {
		expect(surveyShownProperties({ content_key: "blog/introducing-thinkrail" })).toEqual({
			$survey_id: downloadPostHogSurveyId,
			content_key: "blog/introducing-thinkrail",
		});
	});
});
