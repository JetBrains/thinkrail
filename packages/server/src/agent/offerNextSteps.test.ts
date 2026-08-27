import { expect, test } from "bun:test";
import type { AgentMessage, AskUserQuestionResult } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { ASK_USER_QUESTION_TOOL_NAME, assessAnswerability } from "./askUserQuestion";
import { buildNextStepsMessage, OFFER_NEXT_STEPS_TOOL_NAME } from "./offerNextSteps";

const offerCall = (toolCallId: string) =>
	({
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: toolCallId,
				name: OFFER_NEXT_STEPS_TOOL_NAME,
				arguments: { projectName: "Todo Tracker" },
			},
		],
	}) as unknown as AgentMessage;

const ack = (toolCallId: string) =>
	({
		role: "toolResult",
		toolCallId,
		toolName: OFFER_NEXT_STEPS_TOOL_NAME,
		content: [{ type: "text", text: "ack" }],
		details: { kind: "ack" },
		isError: false,
	}) as unknown as AgentMessage;

const NAMES = [ASK_USER_QUESTION_TOOL_NAME, OFFER_NEXT_STEPS_TOOL_NAME];

const choice = (answer: string): AskUserQuestionResult => ({
	cancelled: false,
	answers: [{ questionIndex: 0, question: "How do you want to continue?", kind: "option", answer }],
});

test("assessAnswerability recognizes an offer_next_steps call when its name is allowed", () => {
	const verdict = assessAnswerability([offerCall("t1"), ack("t1")], "t1", NAMES);
	expect(verdict.ok).toBe(true);
	if (verdict.ok) expect(verdict.toolName).toBe(OFFER_NEXT_STEPS_TOOL_NAME);
});

test("assessAnswerability ignores an offer call when only ask is allowed (default)", () => {
	expect(assessAnswerability([offerCall("t1"), ack("t1")], "t1")).toEqual({
		ok: false,
		reason: "unknown_call",
	});
});

test("buildNextStepsMessage emits an ask-user-answers message naming the chosen path", () => {
	const msg = buildNextStepsMessage("t1", choice("Continue in the Default workspace"));
	expect(msg.customType).toBe(ASK_USER_ANSWERS_CUSTOM_TYPE);
	expect(msg.details).toEqual({
		toolCallId: "t1",
		result: choice("Continue in the Default workspace"),
	});
	expect(msg.content).toContain("Continue in the Default workspace");
});

test("buildNextStepsMessage handles a dismissed (cancelled) choice", () => {
	const msg = buildNextStepsMessage("t1", { cancelled: true, answers: [] });
	expect(msg.content).toContain("dismissed");
});
