import { expect, test } from "bun:test";
import { isRecommendedQuestionOption } from "./piProtocol";

test("question recommendations use the same suffix-or-reason rule on both sides of the wire", () => {
	expect(isRecommendedQuestionOption({ label: "Postgres (Recommended)", description: "" })).toBe(
		true,
	);
	expect(isRecommendedQuestionOption({ label: "Postgres (recommended)  ", description: "" })).toBe(
		true,
	);
	expect(
		isRecommendedQuestionOption({
			label: "Postgres",
			description: "",
			recommendedReason: "  Best fit  ",
		}),
	).toBe(true);
	expect(
		isRecommendedQuestionOption({ label: "Postgres", description: "", recommendedReason: "   " }),
	).toBe(false);
	expect(isRecommendedQuestionOption({ label: "Postgres", description: "" })).toBe(false);
});
