import { expect, test } from "bun:test";
import type { AskUserQuestionArgs, AskUserQuestionResult } from "@thinkrail/contracts";
import { buildQuestionnaireResponse, isAckDetails } from "./ask";

test("the package's questionnaire types and the wire types are interchangeable", () => {
	const args: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which targets?",
				header: "Targets",
				multiSelect: true,
				options: [
					{ label: "web (Recommended)", description: "browser", recommendedReason: "most users" },
					{ label: "cli", description: "terminal", preview: "```sh\nthinkrail\n```" },
				],
			},
		],
	};
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [
			{
				questionIndex: 0,
				question: "Which targets?",
				kind: "multi",
				answer: "tray",
				selected: ["web (Recommended)"],
				notes: "web: pwa",
			},
		],
	};
	const envelope = buildQuestionnaireResponse(result, args);
	const details: AskUserQuestionResult = envelope.details;
	expect(details).toBe(result);
	expect(isAckDetails({ kind: "ack" })).toBe(true);
});
