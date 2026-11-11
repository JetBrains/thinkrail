import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import defaultFactory, {
	ASK_ACK_TEXT,
	ASK_UNAVAILABLE_TEXT,
	type AskRequest,
	type AskUserQuestionArgs,
	type AskUserQuestionExtensionOptions,
	createAskUserQuestionExtension,
	DEFAULT_DESCRIPTION,
	DEFAULT_PROMPT_GUIDELINES,
	defaultDescription,
} from "./index.ts";

type ExecResult = {
	content: { type: string; text: string }[];
	details: unknown;
	terminate?: boolean;
};

interface CapturedTool {
	name: string;
	description: string;
	parameters: unknown;
	promptSnippet?: string;
	promptGuidelines?: string[];
	executionMode?: string;
	exposure?: string;
	execute: (
		id: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<ExecResult>;
}

type MessageEndHandler = (event: { message: unknown }) => { message: unknown } | undefined;

function load(options?: AskUserQuestionExtensionOptions) {
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
	(options ? createAskUserQuestionExtension(options) : defaultFactory)(pi);
	if (!tool) throw new Error("the extension registered no tool");
	return { tool, handlers };
}

const args: AskUserQuestionArgs = {
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

const text = (result: ExecResult): string => result.content.map((block) => block.text).join("");

describe("ask_user_question extension", () => {
	test("registers a sequential, model-only ask_user_question with the default guidance", () => {
		const { tool, handlers } = load();
		expect(tool.name).toBe("ask_user_question");
		expect(tool.executionMode).toBe("sequential");
		expect(tool.exposure).toBe("model-only");
		expect(tool.description).toBe(DEFAULT_DESCRIPTION);
		expect(tool.promptGuidelines).toEqual([...DEFAULT_PROMPT_GUIDELINES]);
		expect(tool.promptSnippet).toBeUndefined();
		expect(handlers.has("message_end")).toBe(true);
	});

	test("guidance replaces the description, snippet and guidelines", () => {
		const { tool } = load({
			guidance: { description: "Host wording", promptSnippet: "Ask", promptGuidelines: ["one"] },
		});
		expect(tool.description).toBe("Host wording");
		expect(tool.promptSnippet).toBe("Ask");
		expect(tool.promptGuidelines).toEqual(["one"]);
	});

	test("the message_end hook keeps the first ask as the batch's only tool call", () => {
		const { handlers } = load();
		const message = {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "read-1", name: "read" },
				{ type: "toolCall", id: "ask-1", name: "ask_user_question" },
			],
		};
		expect(handlers.get("message_end")?.({ message })).toEqual({
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "ask-1", name: "ask_user_question" }],
			},
		});
		expect(
			handlers.get("message_end")?.({ message: { role: "user", content: "hi" } }),
		).toBeUndefined();
	});

	test("the message_end hook announces only the executable ask call it keeps", () => {
		const announced: string[] = [];
		const { handlers } = load({ announce: (toolCallId) => announced.push(toolCallId) });
		const batch = (stopReason: string) => ({
			role: "assistant",
			stopReason,
			content: [
				{ type: "toolCall", id: "ask-1", name: "ask_user_question" },
				{ type: "toolCall", id: "ask-2", name: "ask_user_question" },
			],
		});
		handlers.get("message_end")?.({ message: batch("toolUse") });
		for (const stopReason of ["length", "error", "aborted"])
			handlers.get("message_end")?.({ message: batch(stopReason) });
		handlers.get("message_end")?.({ message: { role: "user", content: "hi" } });
		expect(announced).toEqual(["ask-1"]);
	});

	test("without UI the built-in asker reports that it cannot ask", async () => {
		const { tool } = load();
		const result = await tool.execute("tc", args, undefined, undefined, { hasUI: false });
		expect(text(result)).toBe(ASK_UNAVAILABLE_TEXT);
		expect(result.details).toEqual({ answers: [], cancelled: true });
		expect(result.terminate).toBeUndefined();
	});

	test("a malformed questionnaire is rejected before anyone is asked", async () => {
		let asked = false;
		const { tool } = load({
			ask: async () => {
				asked = true;
				return { kind: "deferred" };
			},
		});
		const result = await tool.execute("tc", { questions: [] }, undefined, undefined, {});
		expect(text(result)).toContain("At least one question");
		expect(asked).toBe(false);
	});

	test("an injected asker receives the call and its outcome becomes the tool result", async () => {
		const requests: AskRequest[] = [];
		const signal = new AbortController().signal;
		const ctx = { hasUI: false, mode: "rpc" };
		const { tool } = load({
			ask: async (request) => {
				requests.push(request);
				return {
					kind: "answered",
					result: {
						cancelled: false,
						answers: [
							{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" },
						],
					},
				};
			},
		});
		const result = await tool.execute("tc-7", args, signal, undefined, ctx);
		expect(requests).toEqual([{ toolCallId: "tc-7", args, signal, ctx: ctx as never }]);
		expect(text(result)).toContain('"Which library?"="luxon"');
	});

	test("a deferred outcome ends the turn with the canonical ack", async () => {
		const { tool } = load({ ask: async () => ({ kind: "deferred" }) });
		const result = await tool.execute("tc", args, undefined, undefined, { hasUI: true });
		expect(text(result)).toBe(ASK_ACK_TEXT);
		expect(result.details).toEqual({ kind: "ack" });
		expect(result.terminate).toBe(true);
	});

	test("an asker's rejection propagates so pi records a tool error", async () => {
		const { tool } = load({
			ask: async () => {
				throw new Error("stopped");
			},
		});
		await expect(tool.execute("tc", args, undefined, undefined, { hasUI: true })).rejects.toThrow(
			"stopped",
		);
	});

	test("outside the terminal the built-in asker walks the questions with dialogs", async () => {
		const { tool } = load();
		const ui = {
			select: async (_title: string, choices: string[]) => choices[1],
			input: async () => undefined,
		};
		const result = await tool.execute("tc", args, undefined, undefined, {
			hasUI: true,
			mode: "rpc",
			ui,
		});
		expect(text(result)).toContain('"Which library?"="luxon"');
	});

	test("file previews exist for the model only when the host offers them", () => {
		const fields = (tool: CapturedTool) => {
			const question = (
				tool.parameters as {
					properties: {
						questions: {
							items: {
								properties: Record<string, { items?: { properties: Record<string, unknown> } }>;
							};
						};
					};
				}
			).properties.questions.items.properties;
			return {
				question: Object.keys(question),
				option: Object.keys(question.options?.items?.properties ?? {}),
			};
		};
		const plain = fields(load().tool);
		expect(plain.question).toContain("preview");
		expect(plain.question).not.toContain("previewFile");
		expect(plain.option).not.toContain("previewFile");
		const rich = load({ filePreviews: true });
		expect(fields(rich.tool).question).toContain("previewFile");
		expect(fields(rich.tool).option).toContain("previewBefore");
		expect(rich.tool.description).toBe(defaultDescription(true));
		expect(rich.tool.description).toContain("previewFile");
		expect(DEFAULT_DESCRIPTION).not.toContain("previewFile");
	});

	test("every distinct preview file is checked once before anyone is asked", async () => {
		const checked: string[] = [];
		let asked = false;
		const { tool } = load({
			filePreviews: true,
			checkFile: async (path, cwd) => {
				checked.push(`${cwd}:${path}`);
				if (path === "mockups/missing.html") throw new Error("no such file");
			},
			ask: async () => {
				asked = true;
				return { kind: "deferred" };
			},
		});
		const withFiles = (missing: boolean): AskUserQuestionArgs => ({
			questions: [
				{
					question: "Which layout?",
					header: "Layout",
					previewFile: "mockups/today.html",
					options: [
						{
							label: "Split",
							description: "two columns",
							previewFile: missing ? "mockups/missing.html" : "mockups/split.html",
							previewBefore: "mockups/today.html",
						},
						{ label: "Keep", description: "no change" },
					],
				},
			],
		});
		const failed = await tool.execute("tc", withFiles(true), undefined, undefined, { cwd: "/ws" });
		expect(text(failed)).toContain(
			"cannot show questions[0].options[0].previewFile (mockups/missing.html): no such file",
		);
		expect(asked).toBe(false);
		checked.length = 0;
		await tool.execute("tc", withFiles(false), undefined, undefined, { cwd: "/ws" });
		expect(checked).toEqual(["/ws:mockups/today.html", "/ws:mockups/split.html"]);
		expect(asked).toBe(true);
	});

	test("without file previews a file preview is rejected", async () => {
		const { tool } = load({ ask: async () => ({ kind: "deferred" }) });
		const result = await tool.execute(
			"tc",
			{ questions: [{ ...args.questions[0], previewFile: "a.html" }] },
			undefined,
			undefined,
			{},
		);
		expect(text(result)).toContain("file previews are not available");
	});
});
