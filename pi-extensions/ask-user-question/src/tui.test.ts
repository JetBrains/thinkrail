import { beforeAll, describe, expect, test } from "bun:test";
import { type ExtensionContext, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
	ASK_STOPPED_ERROR,
	type AskOutcome,
	type AskUserQuestionArgs,
	type AskUserQuestionItem,
	DECLINE_MESSAGE,
} from "./core.ts";
import { askInTerminal, QuestionnaireComponent, renderAskCall, renderAskResult } from "./tui.ts";

const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	enter: "\r",
	escape: "\x1b",
	tab: "\t",
	shiftTab: "\x1b[Z",
	space: " ",
	ctrlEnter: "\x1b[13;5u",
};

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const tui = { requestRender: () => {}, terminal: { rows: 40, columns: 120 } } as unknown as TUI;

beforeAll(() => initTheme("dark", false));

const library: AskUserQuestionItem = {
	question: "Which library should we use for dates?",
	header: "Lib",
	options: [
		{
			label: "date-fns (Recommended)",
			description: "Tree-shakable functions",
			recommendedReason: "smallest bundle for our usage",
		},
		{ label: "luxon", description: "Rich time zone support" },
	],
};

const runtime: AskUserQuestionItem = {
	question: "Which runtime?",
	header: "Runtime",
	options: [
		{ label: "bun", description: "fast" },
		{ label: "node", description: "everywhere" },
	],
};

const targets: AskUserQuestionItem = {
	question: "Which targets ship first?",
	header: "Targets",
	multiSelect: true,
	options: [
		{ label: "web", description: "browser" },
		{ label: "cli", description: "terminal" },
		{ label: "desktop", description: "app" },
	],
};

const withPreview: AskUserQuestionItem = {
	question: "Which layout?",
	header: "Layout",
	options: [
		{ label: "Stacked", description: "one column", preview: "```\n[ header ]\n[ body   ]\n```" },
		{ label: "Split", description: "two columns", preview: "```\n[ nav | body ]\n```" },
	],
};

function open(...questions: AskUserQuestionItem[]) {
	const outcomes: AskOutcome[] = [];
	const args: AskUserQuestionArgs = { questions };
	const component = new QuestionnaireComponent(args, tui, theme, (outcome) =>
		outcomes.push(outcome),
	);
	return {
		component,
		outcomes,
		press: (...keys: string[]) => {
			for (const key of keys) component.handleInput(key);
		},
		type: (text: string) => {
			for (const char of text) component.handleInput(char);
		},
		lines: (width = 80) =>
			component.render(width).map((line) => stripTerminalSequences(line).trimEnd()),
		screen: (width = 80) =>
			component
				.render(width)
				.map((line) => stripTerminalSequences(line).trimEnd())
				.join("\n"),
	};
}

const answered = (outcomes: AskOutcome[]) => {
	const outcome = outcomes[0];
	return outcome?.kind === "answered" ? outcome.result.answers : undefined;
};

describe("QuestionnaireComponent — single question", () => {
	test("shows the question, marked options, the recommendation, Other, Submit and Chat", () => {
		const { screen } = open(library);
		const shown = screen();
		expect(shown).toContain("Which library should we use for dates?");
		expect(shown).toContain("› ○ date-fns  Recommended");
		expect(shown).toContain("Tree-shakable functions");
		expect(shown).toContain("Why: smallest bundle for our usage");
		expect(shown).toContain("○ luxon");
		expect(shown).toContain("○ Other: type your own answer…");
		expect(shown).toContain("Submit answers");
		expect(shown).toContain("Chat about this");
		expect(shown).toContain("↑↓ move · Enter select · Space note · d discuss · Ctrl+Enter submit");
		expect(shown).not.toContain("Review & submit");
	});

	test("arrows only move; Enter picks and stays; Submit answers or Ctrl+Enter sends", () => {
		const { press, screen, outcomes } = open(library);
		press(KEY.down);
		expect(screen()).toContain("› ○ luxon");
		press(KEY.enter);
		expect(screen()).toContain("› ● luxon");
		expect(outcomes).toEqual([]);
		press(KEY.down, KEY.down);
		expect(screen()).toContain("›   Submit answers");
		press(KEY.enter);
		expect(outcomes).toEqual([
			{
				kind: "answered",
				result: {
					cancelled: false,
					answers: [
						{
							questionIndex: 0,
							question: "Which library should we use for dates?",
							kind: "option",
							answer: "luxon",
						},
					],
				},
			},
		]);
	});

	test("Ctrl+Enter sends from an option row", () => {
		const { press, outcomes } = open(library);
		press(KEY.enter, KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]?.answer).toBe("date-fns (Recommended)");
	});

	test("Ctrl+Enter with nothing answered asks for an answer first", () => {
		const { press, screen, outcomes } = open(library);
		press(KEY.ctrlEnter);
		expect(screen()).toContain("Answer at least one question first, or press Esc to skip");
		expect(outcomes).toEqual([]);
	});

	test("Other opens an editor; Enter saves without sending and parks on the Other row", () => {
		const { press, type, screen, outcomes } = open(library);
		press(KEY.down, KEY.down, KEY.enter);
		expect(screen()).toContain("Enter save · Shift+Enter new line · Esc back");
		type("dayjs");
		press(KEY.enter);
		expect(outcomes).toEqual([]);
		expect(screen()).toContain("› ● Other: dayjs");
		press(KEY.ctrlEnter);
		expect(answered(outcomes)).toEqual([
			{
				questionIndex: 0,
				question: "Which library should we use for dates?",
				kind: "custom",
				answer: "dayjs",
			},
		]);
	});

	test("typing on the Other row starts the own answer; Esc keeps and selects it", () => {
		const { press, type, screen, outcomes } = open(library);
		press(KEY.down, KEY.down);
		type("moment");
		press(KEY.escape);
		expect(screen()).toContain("● Other: moment");
		expect(screen()).toContain("○ luxon");
		expect(outcomes).toEqual([]);
	});

	test("Space opens the focused option's note; the saved note becomes its own row", () => {
		const { press, type, screen, outcomes } = open(library);
		press(KEY.down, KEY.space);
		expect(screen()).toContain("Note for luxon:");
		expect(screen()).toContain("● luxon");
		type("for tz");
		press(KEY.enter);
		expect(screen()).toContain("›   ✎ for tz");
		press(KEY.enter);
		expect(screen()).toContain("Note for luxon:");
		press(KEY.escape, KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]).toMatchObject({ answer: "luxon", notes: "for tz" });
	});

	test("Esc skips the whole questionnaire", () => {
		const { press, outcomes } = open(library);
		press(KEY.escape);
		expect(outcomes).toEqual([{ kind: "answered", result: { answers: [], cancelled: true } }]);
	});

	test("Chat about this hands the questions back to the conversation", () => {
		const { press, outcomes } = open(library);
		press(KEY.up, KEY.enter);
		expect(outcomes).toEqual([{ kind: "deferred", reason: "chat" }]);
	});

	test("settles only once", () => {
		const { press, outcomes } = open(library);
		press(KEY.escape, KEY.enter, KEY.escape);
		expect(outcomes).toHaveLength(1);
	});
});

describe("QuestionnaireComponent — discuss, previews and one option", () => {
	test("d on an option marks the question for discussion; its editor saves onto a row", () => {
		const { press, type, screen, outcomes } = open(library);
		press(KEY.down, "d");
		expect(screen()).toContain("Discuss first");
		expect(screen()).toContain("What should the agent explain?");
		expect(screen()).toContain("○ luxon");
		type("why dates at all?");
		press(KEY.enter);
		expect(outcomes).toEqual([]);
		expect(screen()).toContain("› ? Discuss first");
		press(KEY.ctrlEnter);
		expect(answered(outcomes)).toEqual([
			{
				questionIndex: 0,
				question: "Which library should we use for dates?",
				kind: "discuss",
				answer: null,
				notes: "why dates at all?",
			},
		]);
	});

	test("d types into the Other editor instead of discussing", () => {
		const { press, type, screen } = open(library);
		press(KEY.down, KEY.down);
		type("dayjs");
		expect(screen()).not.toContain("Discuss first");
		expect(screen()).toContain("dayjs");
	});

	test("picking an option after Esc cancels the discussion; the tab shows ?", () => {
		const { press, screen, outcomes } = open(library, runtime);
		press("d", KEY.escape);
		expect(screen()).toContain("Lib ?");
		expect(screen()).toContain("Discuss first");
		press(KEY.down, KEY.enter);
		expect(screen()).not.toContain("Discuss first");
		press(KEY.tab, KEY.enter, KEY.ctrlEnter);
		expect(answered(outcomes)?.map((a) => a.kind)).toEqual(["option", "option"]);
	});

	test("marking a discussion keeps the pick, and the pick returns when the mark is cancelled", () => {
		const { press, screen } = open(library);
		press(KEY.enter, "d", KEY.escape);
		expect(screen()).toContain("● date-fns");
		press(KEY.down, KEY.enter);
		expect(screen()).not.toContain("Discuss first");
		expect(screen()).toContain("● date-fns");
	});

	test("the note moves with the selection instead of being dropped", () => {
		const { press, type, outcomes } = open(library);
		press(KEY.space);
		type("tree-shaking matters");
		press(KEY.enter, KEY.down, KEY.enter, KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]).toMatchObject({
			answer: "luxon",
			notes: "tree-shaking matters",
		});
	});

	test("the question preview prints above the options", () => {
		const { screen } = open({ ...library, preview: "Today we use moment.js everywhere." });
		const shown = screen();
		expect(shown.indexOf("Today we use moment.js everywhere.")).toBeGreaterThan(
			shown.indexOf("Which library should we use for dates?"),
		);
		expect(shown.indexOf("Today we use moment.js everywhere.")).toBeLessThan(
			shown.indexOf("date-fns"),
		);
	});

	test("file previews print their paths; the preview follows the cursor", () => {
		const files: AskUserQuestionItem = {
			question: "Which page layout?",
			header: "Page",
			previewFile: "mockups/today.html",
			options: [
				{
					label: "Split",
					description: "two columns",
					previewFile: "mockups/split.html",
					previewBefore: "mockups/today.html",
				},
				{ label: "Keep it", description: "no change" },
			],
		};
		const { press, screen } = open(files);
		expect(screen(120)).toContain("preview: mockups/today.html");
		expect(screen(120)).toContain("preview: mockups/today.html → mockups/split.html");
		press(KEY.down);
		expect(screen(120)).toContain("No preview for this option");
	});

	test("a one-option confirmation is picked with Enter and sent", () => {
		const { press, outcomes } = open({
			question: "You want the queue in the right panel, collapsed when empty?",
			header: "Confirm",
			options: [{ label: "Looks right", description: "accurate as written" }],
		});
		press(KEY.enter, KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]?.answer).toBe("Looks right");
	});
});

describe("QuestionnaireComponent — multi-select", () => {
	test("Enter checks and unchecks in place; Submit answers sends the checked options", () => {
		const { press, screen, outcomes } = open(targets);
		expect(screen()).toContain("☐ web");
		expect(screen()).toContain("Enter toggle");
		press(KEY.down, KEY.down, KEY.enter, KEY.up, KEY.up, KEY.enter);
		expect(screen()).toContain("☑ desktop");
		expect(screen()).toContain("☑ web");
		press(KEY.enter);
		expect(screen()).toContain("☐ web");
		press(KEY.enter);
		expect(outcomes).toEqual([]);
		press(KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]).toMatchObject({
			kind: "multi",
			selected: ["desktop", "web"],
			answer: null,
		});
	});

	test("an own answer is added to the checked options", () => {
		const { press, type, screen, outcomes } = open(targets);
		press(KEY.enter, KEY.up, KEY.up, KEY.up, KEY.enter);
		type("tray");
		press(KEY.escape);
		expect(screen()).toContain("☑ Other: tray");
		press(KEY.ctrlEnter);
		expect(answered(outcomes)?.[0]).toMatchObject({
			kind: "multi",
			selected: ["web"],
			answer: "tray",
		});
	});
});

describe("QuestionnaireComponent — several questions", () => {
	test("Next → and Tab page through the questions; the last page sends", () => {
		const { press, screen, outcomes } = open(library, runtime);
		expect(screen()).toContain(" Lib │ Runtime");
		expect(screen()).toContain("Next →");
		expect(screen()).not.toContain("Submit answers");
		press(KEY.down, KEY.enter);
		expect(screen()).toContain("Lib ✓");
		expect(screen()).toContain("Which library should we use for dates?");
		press(KEY.down, KEY.down, KEY.enter);
		expect(screen()).toContain("Which runtime?");
		press(KEY.shiftTab);
		expect(screen()).toContain("Which library should we use for dates?");
		press(KEY.tab, KEY.down, KEY.enter);
		expect(screen()).toContain("Submit answers");
		press(KEY.ctrlEnter);
		expect(answered(outcomes)?.map((a) => a.answer)).toEqual(["luxon", "node"]);
	});

	test("the last page's Submit answers row sends what is answered, leaving the rest unanswered", () => {
		const { press, screen, outcomes } = open(library, runtime);
		press(KEY.down, KEY.enter, KEY.tab);
		press(KEY.up, KEY.up);
		expect(screen()).toContain("›   Submit answers");
		press(KEY.enter);
		expect(answered(outcomes)?.map((a) => a.answer)).toEqual(["luxon"]);
	});

	test("Submit answers with nothing answered asks for an answer first", () => {
		const { press, screen, outcomes } = open(library, runtime);
		press(KEY.tab, KEY.up, KEY.up, KEY.enter);
		expect(screen()).toContain("Answer at least one question first, or press Esc to skip");
		expect(outcomes).toEqual([]);
	});

	test("Shift+Tab returns to an earlier question", () => {
		const { press, screen } = open(library, runtime);
		press(KEY.tab);
		expect(screen()).toContain("Which runtime?");
		press(KEY.shiftTab);
		expect(screen()).toContain("Which library should we use for dates?");
	});
});

describe("QuestionnaireComponent — layout", () => {
	test("every line fits the width, with and without previews", () => {
		for (const questions of [[library, targets], [withPreview], [library]]) {
			for (const width of [24, 40, 80, 100, 140]) {
				const { component, press } = open(...questions);
				press(KEY.down);
				for (const line of component.render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("a wide terminal puts the selected option's preview beside the options", () => {
		const { press, lines } = open(withPreview);
		press(KEY.down);
		const rows = lines(120);
		const preview = rows.find((line) => line.includes("Preview · Split"));
		expect(preview).toContain("│");
		expect(rows.some((line) => line.includes("○ Stacked") && line.includes("│"))).toBe(true);
	});

	test("a narrow terminal puts the preview below the options", () => {
		const { lines } = open(withPreview);
		const rows = lines(70);
		const chat = rows.findIndex((line) => line.includes("Chat about this"));
		const preview = rows.findIndex((line) => line.includes("Preview · Stacked"));
		expect(chat).toBeGreaterThan(-1);
		expect(preview).toBeGreaterThan(chat);
	});

	test("caps a long preview", () => {
		const long: AskUserQuestionItem = {
			...withPreview,
			options: [
				{
					label: "Long",
					description: "",
					preview: Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n\n"),
				},
				{ label: "Short", description: "" },
			],
		};
		const { screen } = open(long);
		expect(screen(70)).toMatch(/… \d+ more lines/);
	});
});

function terminalContext(drive: (component: QuestionnaireComponent) => void): ExtensionContext {
	const custom = (factory: (...args: unknown[]) => QuestionnaireComponent) =>
		new Promise((resolve) => {
			drive(factory(tui, theme, {}, resolve));
		});
	return { mode: "tui", hasUI: true, ui: { custom } } as unknown as ExtensionContext;
}

describe("askInTerminal", () => {
	const args: AskUserQuestionArgs = { questions: [library] };

	test("returns what the questionnaire settles", async () => {
		const ctx = terminalContext((component) => component.handleInput(KEY.escape));
		expect(await askInTerminal({ toolCallId: "tc", args, signal: undefined, ctx })).toEqual({
			kind: "answered",
			result: { answers: [], cancelled: true },
		});
	});

	test("a stop closes the questionnaire as abandoned, and later keys are ignored", async () => {
		const controller = new AbortController();
		let open: QuestionnaireComponent | undefined;
		const ctx = terminalContext((component) => {
			open = component;
		});
		const pending = askInTerminal({ toolCallId: "tc", args, signal: controller.signal, ctx });
		controller.abort();
		expect(await pending).toEqual({ kind: "abandoned" });
		open?.handleInput(KEY.enter);
	});

	test("an answer given before the stop wins", async () => {
		const controller = new AbortController();
		const ctx = terminalContext((component) => {
			component.handleInput(KEY.enter);
			component.handleInput(KEY.ctrlEnter);
			controller.abort();
		});
		const outcome = await askInTerminal({ toolCallId: "tc", args, signal: controller.signal, ctx });
		expect(outcome.kind).toBe("answered");
	});

	test("an already stopped run never opens the questionnaire", async () => {
		const controller = new AbortController();
		controller.abort();
		let opened = false;
		const ctx = terminalContext(() => {
			opened = true;
		});
		expect(await askInTerminal({ toolCallId: "tc", args, signal: controller.signal, ctx })).toEqual(
			{
				kind: "abandoned",
			},
		);
		expect(opened).toBe(false);
	});

	test("falls back to dialogs when the host cannot show the questionnaire", async () => {
		const ctx = {
			mode: "tui",
			hasUI: true,
			ui: {
				custom: async () => undefined,
				select: async (_title: string, choices: string[]) => choices[1],
				input: async () => undefined,
			},
		} as unknown as ExtensionContext;
		const outcome = await askInTerminal({ toolCallId: "tc", args, signal: undefined, ctx });
		expect(outcome.kind === "answered" && outcome.result.answers[0]?.answer).toBe("luxon");
	});
});

describe("transcript renderers", () => {
	const plain = (component: { render(width: number): string[] }) =>
		component
			.render(100)
			.map((line) => stripTerminalSequences(line).trimEnd())
			.join("\n");

	test("the call shows how many questions and their headers, also while streaming", () => {
		expect(plain(renderAskCall({ questions: [library, runtime] }, theme))).toBe(
			"ask_user_question 2 questions (Lib, Runtime)",
		);
		expect(plain(renderAskCall({ questions: [{ question: "q" }] }, theme))).toBe(
			"ask_user_question 1 question",
		);
		expect(plain(renderAskCall(undefined, theme))).toBe("ask_user_question 0 questions");
	});

	const render = (details: unknown, isError = false, text = "raw text") =>
		plain(
			renderAskResult(
				{ content: [{ type: "text", text }], details },
				{ expanded: false, isPartial: false },
				theme,
				{ args: { questions: [library, targets, runtime] }, isError },
			),
		);

	test("an answered result lists each question's answer, notes and the unanswered", () => {
		expect(
			render({
				cancelled: false,
				answers: [
					{
						questionIndex: 0,
						question: library.question,
						kind: "option",
						answer: "date-fns (Recommended)",
						notes: "tiny",
					},
					{
						questionIndex: 1,
						question: targets.question,
						kind: "multi",
						answer: "tray",
						selected: ["web"],
					},
				],
			}),
		).toBe("✓ Lib: date-fns\n    tiny\n✓ Targets: web, “tray”\n– Runtime: not answered");
	});

	test("skips, acks and errors read plainly", () => {
		expect(render({ answers: [], cancelled: true }, false, DECLINE_MESSAGE)).toBe("Skipped");
		expect(render({ answers: [], cancelled: true }, false, ASK_STOPPED_ERROR)).toBe(
			ASK_STOPPED_ERROR,
		);
		expect(render({ kind: "ack" })).toBe("Continuing in chat");
		expect(render(undefined)).toBe("raw text");
		expect(render({ answers: [], cancelled: true }, true)).toBe("raw text");
	});
});
