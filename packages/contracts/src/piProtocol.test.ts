import { expect, test } from "bun:test";
import { isAskUserQuestionResult, isRecommendedQuestionOption } from "./piProtocol";

test("question-result guards accept human and literal timeout results only", () => {
	expect(isAskUserQuestionResult({ answers: [], cancelled: true })).toBe(true);
	expect(isAskUserQuestionResult({ answers: [], cancelled: true, timedOut: true })).toBe(true);
	expect(isAskUserQuestionResult({ answers: [], cancelled: true, timedOut: false })).toBe(false);
	expect(isAskUserQuestionResult({ answers: "none", cancelled: true })).toBe(false);
});

test("question recommendations use the same suffix-or-reason rule on both sides of the wire", () => {
	expect(isRecommendedQuestionOption({ label: "Postgres (Recommended)" })).toBe(true);
	expect(isRecommendedQuestionOption({ label: "Postgres (recommended)  " })).toBe(true);
	expect(
		isRecommendedQuestionOption({
			label: "Postgres",
			recommendedReason: "  Best fit  ",
		}),
	).toBe(true);
	expect(isRecommendedQuestionOption({ label: "Postgres", recommendedReason: "   " })).toBe(false);
	expect(isRecommendedQuestionOption({ label: "Postgres" })).toBe(false);
});
