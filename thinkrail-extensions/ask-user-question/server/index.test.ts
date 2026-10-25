import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices, ToolResponse } from "@thinkrail/extension-api/server";
import askUserQuestion, {
	ASK_ACK_TEXT,
	ASK_STOPPED_ERROR,
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	isAckDetails,
} from "./index";

interface CapturedTool {
	name: string;
	description: string;
	promptGuidelines?: string[];
	execute: (
		id: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<{ content: { text: string }[]; details: unknown; terminate?: boolean }>;
}

const args = {
	questions: [
		{
			question: "Which library?",
			header: "Lib",
			options: [
				{ label: "date-fns", description: "small" },
				{ label: "luxon", description: "rich" },
			],
		},
	],
};

function compose(
	respond: (toolCallId: string, signal: AbortSignal | undefined) => Promise<ToolResponse>,
) {
	const session: ExtensionSessionServices = { awaitToolResponse: respond };
	const factories = askUserQuestion.sessionExtensions?.(session) ?? [];
	let tool: CapturedTool | undefined;
	const pi = {
		registerTool: (definition: CapturedTool) => {
			tool = definition;
		},
		on: () => {},
	} as unknown as ExtensionAPI;
	for (const factory of factories) factory(pi);
	if (!tool) throw new Error("the session factories registered no tool");
	return { tool, factories };
}

const text = (result: { content: { text: string }[] }) =>
	result.content.map((block) => block.text).join("");

describe("the ask-user-question server half", () => {
	test("is a session-only extension that registers the tool with ThinkRail's wording", () => {
		expect(askUserQuestion.name).toBe("ask-user-question");
		expect(askUserQuestion.extensions).toEqual([]);
		const { tool, factories } = compose(async () => ({ kind: "deferred" }));
		expect(factories).toHaveLength(1);
		expect(tool.name).toBe(ASK_USER_QUESTION_TOOL_NAME);
		expect(tool.description).toContain("render inline in the chat as an interactive card");
		expect(tool.description).toContain("then the card is superseded");
		expect(tool.promptGuidelines?.length).toBe(4);
	});

	test("waits for the host's response to this call and returns the answer envelope", async () => {
		const asked: { toolCallId: string; signal: AbortSignal | undefined }[] = [];
		const signal = new AbortController().signal;
		const answer = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Which library?", kind: "option" as const, answer: "luxon" },
			],
		};
		const { tool } = compose(async (toolCallId, received) => {
			asked.push({ toolCallId, signal: received });
			return { kind: "response", value: answer };
		});
		const result = await tool.execute("tc-1", args, signal, undefined, { hasUI: false });
		expect(asked).toEqual([{ toolCallId: "tc-1", signal }]);
		expect(result).toEqual(buildQuestionnaireResponse(answer, args));
	});

	test("a deferral is the canonical ack that ends the turn; abandonment reports the stop", async () => {
		const deferred = await compose(async () => ({ kind: "deferred" })).tool.execute(
			"tc",
			args,
			undefined,
			undefined,
			{},
		);
		expect(text(deferred)).toBe(ASK_ACK_TEXT);
		expect(isAckDetails(deferred.details)).toBe(true);
		expect(deferred.terminate).toBe(true);
		const abandoned = await compose(async () => ({ kind: "abandoned" })).tool.execute(
			"tc",
			args,
			undefined,
			undefined,
			{},
		);
		expect(text(abandoned)).toBe(ASK_STOPPED_ERROR);
		expect(abandoned.terminate).toBe(true);
	});

	test("a malformed response or a refused wait fails the call", async () => {
		await expect(
			compose(async () => ({ kind: "response", value: { kind: "ack" } })).tool.execute(
				"tc",
				args,
				undefined,
				undefined,
				{},
			),
		).rejects.toThrow("Malformed ask_user_question response");
		await expect(
			compose(() => Promise.reject(new Error(ASK_STOPPED_ERROR))).tool.execute(
				"tc",
				args,
				undefined,
				undefined,
				{},
			),
		).rejects.toThrow(ASK_STOPPED_ERROR);
	});
});
