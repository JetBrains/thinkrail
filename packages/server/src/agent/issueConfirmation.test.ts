import { expect, test } from "bun:test";
import { isTrustedQuestionnaireReceipt } from "./issueConfirmation";

const args = {
	questions: [
		{
			question: "Use this design?",
			header: "Design",
			options: [{ label: "Looks right", description: "Confirm" }],
		},
	],
};
const call = (id = "call_abc123|fc_0123456789abcdef", stopReason = "toolUse") => ({
	role: "assistant",
	stopReason,
	content: [{ type: "toolCall", id, name: "ask_user_question", arguments: args }],
});
const result = {
	cancelled: false,
	answers: [
		{ questionIndex: 0, question: "Use this design?", kind: "option", answer: "Looks right" },
	],
};
const receipt = (isError = false) => ({
	role: "toolResult",
	toolCallId: "call_abc123|fc_0123456789abcdef",
	isError,
	details: result,
});
const valid = (...messages: Record<string, unknown>[]) =>
	isTrustedQuestionnaireReceipt(messages, "call_abc123|fc_0123456789abcdef", args);

test("accepts an exact executable questionnaire and successful answer receipt", () => {
	expect(valid(call(), receipt())).toBe(true);
	expect(
		valid({ role: "user", content: [{ type: "image", ref: "img_123" }] }, call(), receipt()),
	).toBe(true);
	expect(
		valid(call(), {
			role: "custom",
			customType: "tool-response",
			details: { toolCallId: "call_abc123|fc_0123456789abcdef", response: result },
		}),
	).toBe(true);
	expect(valid(call(), receipt(), { role: "user", content: "next turn" })).toBe(true);
});

test("rejects altered, ambiguous, unsuccessful, pending, or superseded receipts", () => {
	expect(valid(call(), { ...receipt(), details: { kind: "ack" } })).toBe(false);
	expect(valid(call(), receipt(true))).toBe(false);
	expect(valid(call("call_abc123|fc_0123456789abcdef", "error"), receipt())).toBe(false);
	expect(valid(call(), { role: "user", content: "superseded" }, receipt())).toBe(false);
	expect(valid(call(), receipt(), receipt())).toBe(false);
	expect(valid(call(), receipt(), call())).toBe(false);
	expect(
		valid(
			{
				role: "assistant",
				stopReason: "toolUse",
				content: [{ type: "toolCall", id: "historical-read", name: "read", arguments: {} }],
			},
			{
				role: "assistant",
				stopReason: "toolUse",
				content: [{ type: "toolCall", id: "historical-read", name: "read", arguments: {} }],
			},
			call(),
			receipt(),
		),
	).toBe(false);
	expect(
		valid(call(), {
			...receipt(),
			details: { ...result, answers: [{ ...result.answers[0], notes: "extra" }] },
		}),
	).toBe(false);
	expect(
		valid(call(), {
			...receipt(),
			details: { ...result, answers: [result.answers[0], result.answers[0]] },
		}),
	).toBe(false);
	expect(
		valid(call(), receipt(), {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call_abc123|fc_0123456789abcdef", name: "other", arguments: {} },
			],
			stopReason: "toolUse",
		}),
	).toBe(false);
});

test("pending acknowledgement survives restart and accepts only one valid final answer", () => {
	const pending = { ...receipt(), details: { kind: "ack" } };
	const answer = {
		role: "custom",
		customType: "tool-response",
		details: { toolCallId: "call_abc123|fc_0123456789abcdef", response: result },
	};
	// JSON round-trip models the persisted transcript loaded after restart.
	const restored = JSON.parse(JSON.stringify([call(), pending]));
	expect(valid(...restored)).toBe(false);
	expect(valid(...restored, answer)).toBe(true);
	expect(valid(...restored, answer, { role: "user", content: "next turn" })).toBe(true);
	expect(valid(...restored, { role: "user", content: "superseded" }, answer)).toBe(false);
	expect(valid(call(), { ...pending, isError: true }, answer)).toBe(false);
	expect(valid(...restored, receipt(true), answer)).toBe(false);
	expect(valid(...restored, answer, answer)).toBe(false);
	expect(valid(...restored, receipt(), answer)).toBe(false);
	expect(valid(...restored, answer, receipt())).toBe(false);
	for (const response of [
		{ kind: "ack" },
		{ ...result, cancelled: true },
		{ ...result, answers: [{ ...result.answers[0], notes: "extra" }] },
	]) {
		expect(valid(...restored, { ...answer, details: { ...answer.details, response } })).toBe(false);
	}
});

test("rejects changed arguments and non-option answer additions", () => {
	for (const stopReason of ["error", "length", "aborted"]) {
		expect(valid(call(undefined, stopReason), receipt())).toBe(false);
	}
	for (const answer of [
		{ ...result.answers[0], kind: "custom" },
		{ ...result.answers[0], kind: "multi", selected: ["Looks right"] },
		{ ...result.answers[0], kind: "discuss" },
		{ ...result.answers[0], questionIndex: 1 },
		{ ...result.answers[0], question: "Changed?" },
		{ ...result.answers[0], answer: "looks right" },
	]) {
		expect(valid(call(), { ...receipt(), details: { ...result, answers: [answer] } })).toBe(false);
	}
	expect(valid(call())).toBe(false);
	expect(valid(receipt(), call())).toBe(false);
	expect(valid(call("other"), receipt())).toBe(false);
	expect(
		valid(
			{ ...call(), content: [{ ...call().content[0], arguments: { ...args, extra: true } }] },
			receipt(),
		),
	).toBe(false);
	for (const multiSelect of [true, "false", null]) {
		const expected = { questions: [{ ...args.questions[0], multiSelect }] };
		expect(
			isTrustedQuestionnaireReceipt(
				[
					{ ...call(), content: [{ ...call().content[0], arguments: expected }] },
					receipt(),
				] as Parameters<typeof isTrustedQuestionnaireReceipt>[0],
				"call_abc123|fc_0123456789abcdef",
				expected,
			),
		).toBe(false);
	}
	expect(
		valid(call(), {
			...receipt(),
			details: { ...result, answers: [{ ...result.answers[0], notes: "" }] },
		}),
	).toBe(true);
	expect(valid(call(), { ...receipt(), details: { ...result, notes: "added" } })).toBe(false);
});
