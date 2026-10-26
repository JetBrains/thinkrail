import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AskUserQuestionArgs, CHAT_LABEL } from "./core.ts";
import { askWithDialogs, optionLine, parseMultiAnswer } from "./dialogs.ts";

type Reply = string | undefined | ((signal: AbortSignal | undefined) => string | undefined);

interface Prompt {
	kind: "select" | "input";
	title: string;
	choices?: string[];
	signal: AbortSignal | undefined;
}

function scriptedUi(replies: Reply[]) {
	const prompts: Prompt[] = [];
	const next = (prompt: Prompt): string | undefined => {
		prompts.push(prompt);
		if (replies.length === 0) throw new Error(`unexpected ${prompt.kind}: ${prompt.title}`);
		const reply = replies.shift();
		return typeof reply === "function" ? reply(prompt.signal) : reply;
	};
	const ui = {
		select: async (title: string, choices: string[], opts?: { signal?: AbortSignal }) =>
			next({ kind: "select", title, choices, signal: opts?.signal }),
		input: async (title: string, _placeholder?: string, opts?: { signal?: AbortSignal }) =>
			next({ kind: "input", title, signal: opts?.signal }),
	};
	return { ctx: { ui, hasUI: true, mode: "rpc" } as unknown as ExtensionContext, prompts };
}

const dateFns = {
	label: "date-fns (Recommended)",
	description: "small",
	recommendedReason: "lightest",
	preview: "```ts\nformat(d, 'P')\n```",
};
const luxon = { label: "luxon", description: "rich" };
const library = { question: "Which library?", header: "Lib", options: [dateFns, luxon] };

const targets = {
	question: "Which targets?",
	header: "Targets",
	multiSelect: true,
	options: [
		{ label: "web", description: "browser" },
		{ label: "cli", description: "terminal" },
		{ label: "desktop", description: "app" },
	],
};

const ask = (
	questions: AskUserQuestionArgs["questions"],
	replies: Reply[],
	signal?: AbortSignal,
) => {
	const { ctx, prompts } = scriptedUi(replies);
	const outcome = askWithDialogs({ toolCallId: "tc", args: { questions }, signal, ctx });
	return { outcome, prompts };
};

describe("askWithDialogs", () => {
	test("asks one select per question and maps the chosen line back to its option", async () => {
		const { outcome, prompts } = ask([library], [optionLine(luxon)]);
		expect(await outcome).toEqual({
			kind: "answered",
			result: {
				cancelled: false,
				answers: [
					{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" },
				],
			},
		});
		expect(prompts[0]?.choices).toEqual([
			"date-fns (Recommended) — small — Why: lightest",
			"luxon — rich",
			"Other…",
			CHAT_LABEL,
		]);
		expect(prompts[0]?.title).toContain("Lib: Which library?");
		expect(prompts[0]?.title).toContain("Preview · date-fns (Recommended):\n```ts");
	});

	test("keeps the selected option's preview in the answer", async () => {
		const { outcome } = ask([library], [optionLine(dateFns)]);
		const result = await outcome;
		expect(result.kind === "answered" && result.result.answers[0]?.preview).toBe(dateFns.preview);
	});

	test("asks for the own answer after Other and returns to the options when it is empty", async () => {
		const { outcome, prompts } = ask([library], ["Other…", "  ", "Other…", " dayjs "]);
		expect(await outcome).toEqual({
			kind: "answered",
			result: {
				cancelled: false,
				answers: [
					{ questionIndex: 0, question: "Which library?", kind: "custom", answer: "dayjs" },
				],
			},
		});
		expect(prompts.map((prompt) => prompt.kind)).toEqual(["select", "input", "select", "input"]);
	});

	test("declines the whole questionnaire when any dialog is dismissed", async () => {
		const { outcome } = ask([library, targets], [optionLine(luxon), undefined]);
		expect(await outcome).toEqual({ kind: "answered", result: { answers: [], cancelled: true } });
	});

	test("choosing to chat defers the answer to the conversation", async () => {
		const { outcome } = ask([library, targets], [CHAT_LABEL]);
		expect(await outcome).toEqual({ kind: "deferred", reason: "chat" });
	});

	test("reads a multi-select answer from one input and numbers the options in its title", async () => {
		const { outcome, prompts } = ask([targets], ["1, 3; a tray icon"]);
		expect(await outcome).toEqual({
			kind: "answered",
			result: {
				cancelled: false,
				answers: [
					{
						questionIndex: 0,
						question: "Which targets?",
						kind: "multi",
						answer: "a tray icon",
						selected: ["web", "desktop"],
					},
				],
			},
		});
		expect(prompts[0]?.kind).toBe("input");
		expect(prompts[0]?.title).toContain("1. web — browser\n2. cli — terminal\n3. desktop — app");
	});

	test("an empty multi-select input leaves that question unanswered", async () => {
		const { outcome } = ask([targets, library], ["", optionLine(luxon)]);
		const result = await outcome;
		expect(result.kind === "answered" && result.result.answers.map((a) => a.questionIndex)).toEqual(
			[1],
		);
	});

	test("numbers the pages when there are several questions", async () => {
		const { outcome, prompts } = ask([library, targets], [optionLine(luxon), "2"]);
		await outcome;
		expect(prompts[0]?.title).toStartWith("Lib (1/2): Which library?");
		expect(prompts[1]?.title).toStartWith("Targets (2/2): Which targets?");
	});

	test("a stop that dismisses the open dialog abandons the question", async () => {
		const controller = new AbortController();
		const { outcome, prompts } = ask(
			[library],
			[
				(signal) => {
					controller.abort();
					expect(signal?.aborted).toBe(true);
					return undefined;
				},
			],
			controller.signal,
		);
		expect(await outcome).toEqual({ kind: "abandoned" });
		expect(prompts[0]?.signal).toBe(controller.signal);
	});

	test("an answer given before the stop still wins; later questions are not asked", async () => {
		const controller = new AbortController();
		const last = ask(
			[library],
			[
				() => {
					controller.abort();
					return optionLine(luxon);
				},
			],
			controller.signal,
		);
		expect((await last.outcome).kind).toBe("answered");

		const pending = new AbortController();
		const earlier = ask(
			[library, targets],
			[
				() => {
					pending.abort();
					return optionLine(luxon);
				},
			],
			pending.signal,
		);
		expect(await earlier.outcome).toEqual({ kind: "abandoned" });
		expect(earlier.prompts).toHaveLength(1);
	});
});

describe("parseMultiAnswer", () => {
	test("reads numbers, own text, or both, ignoring unknown and repeated numbers", () => {
		expect(parseMultiAnswer("2", targets, 0)?.selected).toEqual(["cli"]);
		expect(parseMultiAnswer("3,1,3,9", targets, 0)?.selected).toEqual(["desktop", "web"]);
		expect(parseMultiAnswer("mobile too", targets, 0)).toMatchObject({
			selected: [],
			answer: "mobile too",
		});
		expect(parseMultiAnswer("web; and mobile", targets, 0)).toMatchObject({
			selected: [],
			answer: "web; and mobile",
		});
		expect(parseMultiAnswer("9", targets, 0)).toBeNull();
		expect(parseMultiAnswer("   ", targets, 0)).toBeNull();
	});
});
