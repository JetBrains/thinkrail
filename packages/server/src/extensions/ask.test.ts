import { expect, test } from "bun:test";
import {
	type AskUserQuestionArgs,
	type AskUserQuestionResult,
	ASK_USER_QUESTION_TOOL_NAME as WIRE_TOOL_NAME,
} from "@thinkrail/contracts";
import { ASK_USER_QUESTION_TOOL_NAME, buildQuestionnaireResponse, isAckDetails } from "./ask";

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

test("the wire tool name the web keys on is the package's tool name", () => {
	expect(WIRE_TOOL_NAME).toBe(ASK_USER_QUESTION_TOOL_NAME);
});
