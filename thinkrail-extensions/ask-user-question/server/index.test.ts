import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices, ToolResponse } from "@thinkrail/extension-api/server";
import {
	ASK_ACK_TEXT,
	ASK_STOPPED_ERROR,
	ASK_USER_QUESTION_TOOL_NAME,
	buildQuestionnaireResponse,
	isAckDetails,
} from "@thinkrail/pi-ask-user-question/core";
import askUserQuestion from "./index";

interface CapturedTool {
	name: string;
	description: string;
	parameters: unknown;
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

type MessageEndHandler = (event: { message: unknown }) => unknown;

function compose(
	respond: (toolCallId: string, signal: AbortSignal | undefined) => Promise<ToolResponse>,
	expectToolResponse: (toolCallId: string) => void = () => {},
	richPreviews: () => boolean = () => true,
	check: (path: string, cwd: string) => Promise<void> = async () => {},
) {
	const session: ExtensionSessionServices = {
		expectToolResponse,
		awaitToolResponse: respond,
		setting: (key) => {
			if (key !== "richPreviews") throw new Error(`unexpected setting ${key}`);
			return richPreviews();
		},
		workspaceFiles: { check, scratchDir: ".thinkrail/context/mockups/" },
	};
	const factories = askUserQuestion.sessionExtensions?.(session) ?? [];
	let tool: CapturedTool | undefined;
	const handlers = new Map<string, MessageEndHandler>();
	const pi = {
		registerTool: (definition: CapturedTool) => {
			tool = definition;
		},
		on: (event: string, handler: MessageEndHandler) => {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	for (const factory of factories) factory(pi);
	if (!tool) throw new Error("the session factories registered no tool");
	return { tool, factories, handlers };
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

	test("declares its tool interactive under the package's own name and describes late responses", () => {
		const interactive = askUserQuestion.interactiveTools ?? {};
		expect(Object.keys(interactive)).toEqual([ASK_USER_QUESTION_TOOL_NAME]);
		const describe = interactive[ASK_USER_QUESTION_TOOL_NAME]?.describeResponse;
		const answer = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Which library?", kind: "option" as const, answer: "luxon" },
			],
		};
		expect(describe?.(args, answer)).toBe(text(buildQuestionnaireResponse(answer, args)));
		expect(describe?.({ question: "foreign" }, answer)).toBeUndefined();
		expect(describe?.(args, { picked: "luxon" })).toBeUndefined();
	});

	test("the package's deferral ack is the host's pending marker", async () => {
		const deferred = await compose(async () => ({ kind: "deferred" })).tool.execute(
			"tc",
			args,
			undefined,
			undefined,
			{},
		);
		expect(deferred.details).toEqual({ kind: "ack" });
	});

	test("announces each executable ask call to the host before it runs", () => {
		const expected: string[] = [];
		const { handlers } = compose(
			async () => ({ kind: "deferred" }),
			(toolCallId) => expected.push(toolCallId),
		);
		handlers.get("message_end")?.({
			message: {
				role: "assistant",
				stopReason: "toolUse",
				content: [{ type: "toolCall", id: "ask-1", name: ASK_USER_QUESTION_TOOL_NAME }],
			},
		});
		expect(expected).toEqual(["ask-1"]);
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

	test("declares the rich-preview setting, on by default", () => {
		expect(askUserQuestion.settings).toEqual({ richPreviews: { type: "boolean", default: true } });
	});

	test("rich previews offer file fields and the mockup guidance; off, neither is offered", () => {
		const optionFields = (tool: CapturedTool) =>
			Object.keys(
				(
					tool.parameters as {
						properties: {
							questions: {
								items: {
									properties: { options: { items: { properties: Record<string, unknown> } } };
								};
							};
						};
					}
				).properties.questions.items.properties.options.items.properties,
			);
		const rich = compose(async () => ({ kind: "deferred" })).tool;
		expect(optionFields(rich)).toContain("previewFile");
		expect(rich.description).toContain("`.thinkrail/context/mockups/`");
		const plain = compose(
			async () => ({ kind: "deferred" }),
			() => {},
			() => false,
		).tool;
		expect(optionFields(plain)).not.toContain("previewFile");
		expect(plain.description).not.toContain("previewFile");
		expect(plain.description).toContain("Discuss button");
	});

	test("reads the setting each time pi loads the factory, so a reload sees a change", () => {
		let rich = true;
		const respond = async () => ({ kind: "deferred" as const });
		const { factories } = compose(
			respond,
			() => {},
			() => rich,
		);
		const load = () => {
			let description = "";
			const pi = {
				registerTool: (definition: CapturedTool) => {
					description = definition.description;
				},
				on: () => {},
			} as unknown as ExtensionAPI;
			for (const factory of factories) factory(pi);
			return description;
		};
		expect(load()).toContain("previewFile");
		rich = false;
		expect(load()).not.toContain("previewFile");
	});

	test("checks preview files through the host's workspace files before asking", async () => {
		const checked: string[] = [];
		let waited = false;
		const { tool } = compose(
			async () => {
				waited = true;
				return { kind: "deferred" };
			},
			() => {},
			() => true,
			async (path, cwd) => {
				checked.push(`${cwd}:${path}`);
				throw new Error("no such file");
			},
		);
		const withFile = {
			questions: [
				{
					...args.questions[0],
					options: [
						{ label: "date-fns", description: "small", previewFile: "mockups/a.html" },
						{ label: "luxon", description: "rich" },
					],
				},
			],
		};
		const result = await tool.execute("tc", withFile, undefined, undefined, { cwd: "/ws" });
		expect(text(result)).toContain(
			"cannot show questions[0].options[0].previewFile (mockups/a.html)",
		);
		expect(checked).toEqual(["/ws:mockups/a.html"]);
		expect(waited).toBe(false);
	});

	test("a late discuss answer reads like a live one", () => {
		const describe =
			askUserQuestion.interactiveTools?.[ASK_USER_QUESTION_TOOL_NAME]?.describeResponse;
		const answer = {
			cancelled: false,
			answers: [
				{
					questionIndex: 0,
					question: "Which library?",
					kind: "discuss" as const,
					answer: null,
					reason: "unclear" as const,
					notes: "what is luxon?",
				},
			],
		};
		const late = describe?.(args, answer);
		expect(late).toBe(text(buildQuestionnaireResponse(answer, args)));
		expect(late).toContain("the user wants to discuss this question first");
	});
});
