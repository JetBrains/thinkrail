import { describe, expect, it } from "bun:test";
import type { AskUserQuestionAnswer, AskUserQuestionItem } from "@thinkrail/contracts";
import {
	choiceKeyAction,
	createQuestionAttentionClaim,
	customTextPatch,
	deriveAnswer,
	deriveRecapState,
	noteKeyAction,
	parseQuestions,
	questionPageForKey,
	readAskResult,
	readRecommendation,
	shouldClaimQuestionFocus,
	splitRecommended,
} from "./AskUserQuestionCard";

const q = (over: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem => ({
	question: "Which?",
	header: "H",
	options: [
		{ label: "A", description: "a" },
		{ label: "B", description: "b" },
	],
	...over,
});

const state = (over: Partial<Parameters<typeof deriveAnswer>[2]> = {}) => ({
	option: null,
	customText: "",
	customActive: false,
	multi: [] as string[],
	cursor: 0,
	notes: {} as Record<string, string>,
	noteFor: null as string | null,
	...over,
});

describe("parseQuestions", () => {
	it("reads a well-formed questions array", () => {
		expect(parseQuestions({ questions: [q()] })).toHaveLength(1);
	});
	it("returns [] for missing / malformed args (defensive)", () => {
		expect(parseQuestions({})).toEqual([]);
		expect(parseQuestions({ questions: "nope" })).toEqual([]);
		expect(parseQuestions({ questions: [{ question: "x" }] })).toEqual([]); // no options[]
	});
});

describe("keyboard interaction", () => {
	it("wraps authored-choice movement and supports Home/End", () => {
		expect(choiceKeyAction("ArrowDown", 2, 3)).toEqual({ type: "move", index: 0 });
		expect(choiceKeyAction("ArrowUp", 0, 3)).toEqual({ type: "move", index: 2 });
		expect(choiceKeyAction("Home", 2, 3)).toEqual({ type: "move", index: 0 });
		expect(choiceKeyAction("End", 0, 3)).toEqual({ type: "move", index: 2 });
	});

	it("maps Space and Enter without consuming bare letter or number keys", () => {
		expect(choiceKeyAction(" ", 0, 2)).toEqual({ type: "select" });
		expect(choiceKeyAction("Enter", 0, 2)).toEqual({ type: "confirm" });
		expect(choiceKeyAction("N", 0, 2)).toEqual({ type: "none" });
		expect(choiceKeyAction("n", 0, 2)).toEqual({ type: "none" });
		expect(choiceKeyAction("1", 0, 2)).toEqual({ type: "none" });
	});

	it("includes Other as the final wrapping choice target", () => {
		expect(choiceKeyAction("ArrowDown", 2, 4)).toEqual({ type: "move", index: 3 });
		expect(choiceKeyAction("End", 0, 4)).toEqual({ type: "move", index: 3 });
		expect(choiceKeyAction("ArrowDown", 3, 4)).toEqual({ type: "move", index: 0 });
	});

	it("clamps Left/Right across questions plus review", () => {
		expect(questionPageForKey("ArrowLeft", 0, 2)).toBe(0);
		expect(questionPageForKey("ArrowRight", 0, 2)).toBe(1);
		expect(questionPageForKey("ArrowRight", 2, 2)).toBe(2);
		expect(questionPageForKey("ArrowDown", 1, 2)).toBeNull();
	});

	it("finishes notes on Enter/Escape but preserves Shift+Enter and IME composition", () => {
		expect(noteKeyAction("Enter", false, false)).toBe("finish");
		expect(noteKeyAction("Escape", false, false)).toBe("finish");
		expect(noteKeyAction("Enter", true, false)).toBe("none");
		expect(noteKeyAction("Escape", true, false)).toBe("none");
		expect(noteKeyAction("Enter", false, true)).toBe("none");
	});

	it("claims attention once per tool call and mounted-chat scope", () => {
		const claim = createQuestionAttentionClaim();
		const firstMount = {};
		const reopenedMount = {};
		expect(claim(firstMount, "ask-1")).toBe(true);
		expect(claim(firstMount, "ask-1")).toBe(false);
		expect(claim(firstMount, "ask-2")).toBe(true);
		expect(claim(reopenedMount, "ask-1")).toBe(true);
	});

	it("focuses from inert/empty-composer targets but preserves active editing and open modals", () => {
		expect(shouldClaimQuestionFocus("none")).toBe(true);
		expect(shouldClaimQuestionFocus("non-editing")).toBe(true);
		expect(shouldClaimQuestionFocus("empty-composer")).toBe(true);
		expect(shouldClaimQuestionFocus("draft-composer")).toBe(false);
		expect(shouldClaimQuestionFocus("editing")).toBe(false);
		expect(shouldClaimQuestionFocus("modal")).toBe(false);
	});
});

describe("customTextPatch", () => {
	it("typed text claims the answer, taking it off the authored pick (exclusive single-select)", () => {
		expect(customTextPatch("mine")).toEqual({
			customText: "mine",
			customActive: true,
			option: null,
		});
	});

	it("does NOT activate on blank text, so passing through Other keeps the current pick", () => {
		// The ↑/↓/Home/End cursor wraps through the Other row; activating there would clear `option` and
		// paint an empty row as chosen. Only text does that — and emptying the field hands the row back.
		expect(customTextPatch("")).toEqual({ customText: "", customActive: false });
		expect(customTextPatch("   ")).toEqual({ customText: "   ", customActive: false });
	});

	it("round-trips with deriveAnswer: blank text is never an answer, typed text always is", () => {
		const passedOver = state({ option: "A", ...customTextPatch("") });
		expect(deriveAnswer(q(), 0, passedOver)).toMatchObject({ kind: "option", answer: "A" });
		const typed = state({ option: "A", ...customTextPatch("mine") });
		expect(deriveAnswer(q(), 0, typed)).toMatchObject({ kind: "custom", answer: "mine" });
	});
});

describe("deriveAnswer", () => {
	it("is null while unanswered", () => {
		expect(deriveAnswer(q(), 0, state())).toBeNull();
	});

	it("single-select → option answer, echoing preview + note", () => {
		const question = q({
			options: [
				{ label: "A", description: "a", preview: "```ts\n1\n```" },
				{ label: "B", description: "b" },
			],
		});
		const a = deriveAnswer(question, 2, state({ option: "A", notes: { A: " keep it " } }));
		expect(a).toEqual({
			questionIndex: 2,
			question: "Which?",
			kind: "option",
			answer: "A",
			preview: "```ts\n1\n```",
			notes: "keep it",
		});
	});

	it("free text wins when the custom row is active and non-empty", () => {
		const a = deriveAnswer(
			q(),
			0,
			state({ option: "A", customActive: true, customText: "  my answer " }),
		);
		expect(a).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "custom",
			answer: "my answer",
		});
	});

	it("multi-select collects the toggled labels", () => {
		const a = deriveAnswer(q({ multiSelect: true }), 1, state({ multi: ["A", "B"] }));
		expect(a).toEqual({
			questionIndex: 1,
			question: "Which?",
			kind: "multi",
			answer: null,
			selected: ["A", "B"],
		});
	});

	it("multi-select with nothing checked and no text stays unanswered", () => {
		expect(deriveAnswer(q({ multiSelect: true }), 0, state())).toBeNull();
	});

	it("multi-select: typed free text rides along as an additional answer (issue #50)", () => {
		const a = deriveAnswer(
			q({ multiSelect: true }),
			1,
			state({ multi: ["A"], customText: "  extra  ", customActive: true }),
		);
		expect(a).toEqual({
			questionIndex: 1,
			question: "Which?",
			kind: "multi",
			answer: "extra",
			selected: ["A"],
		});
	});

	it("multi-select: typed free text alone (nothing checked) is a valid answer", () => {
		expect(
			deriveAnswer(q({ multiSelect: true }), 0, state({ customText: "solo", customActive: true })),
		).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "multi",
			answer: "solo",
			selected: [],
		});
	});

	it("multi-select: an unchecked 'Other' row keeps its text OUT of the answer", () => {
		// Typing checks the row; the user then unchecked it — the text stays visible but must not submit.
		expect(
			deriveAnswer(
				q({ multiSelect: true }),
				0,
				state({ multi: ["A"], customText: "extra", customActive: false }),
			),
		).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "multi",
			answer: null,
			selected: ["A"],
		});
	});

	it("drops a selected label that no longer exists in the options (clicked mid-stream, then renamed)", () => {
		expect(deriveAnswer(q(), 0, state({ option: "Gone" }))).toBeNull();
	});

	it("filters stale multi-select labels the same way (and stays unanswered if none survive)", () => {
		expect(deriveAnswer(q({ multiSelect: true }), 0, state({ multi: ["A", "Gone"] }))).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "multi",
			answer: null,
			selected: ["A"],
		});
		expect(deriveAnswer(q({ multiSelect: true }), 0, state({ multi: ["Gone"] }))).toBeNull();
	});
});

describe("deriveRecapState", () => {
	const base = { questionIndex: 0, question: "Which?" };

	it("shows every option for an unanswered review but not for a resolved skipped record", () => {
		expect(deriveRecapState(undefined, "review")).toEqual({
			selectedLabels: [],
			customAnswer: null,
			showOptions: true,
		});
		expect(deriveRecapState(undefined, "resolved")).toEqual({
			selectedLabels: [],
			customAnswer: null,
			showOptions: false,
		});
	});

	it("marks a single authored option selected in both recap variants", () => {
		const answer: AskUserQuestionAnswer = {
			...base,
			kind: "option",
			answer: "A",
		};
		const expected = { selectedLabels: ["A"], customAnswer: null, showOptions: true };
		expect(deriveRecapState(answer, "review")).toEqual(expected);
		expect(deriveRecapState(answer, "resolved")).toEqual(expected);
	});

	it("keeps multi selections and additive custom text in both recap variants", () => {
		const answer: AskUserQuestionAnswer = {
			...base,
			kind: "multi",
			answer: "extra",
			selected: ["A", "B"],
		};
		const expected = {
			selectedLabels: ["A", "B"],
			customAnswer: "extra",
			showOptions: true,
		};
		expect(deriveRecapState(answer, "review")).toEqual(expected);
		expect(deriveRecapState(answer, "resolved")).toEqual(expected);
	});

	it("shows authored options around a custom answer only during review", () => {
		const answer: AskUserQuestionAnswer = {
			...base,
			kind: "custom",
			answer: "mine",
		};
		expect(deriveRecapState(answer, "review")).toEqual({
			selectedLabels: [],
			customAnswer: "mine",
			showOptions: true,
		});
		expect(deriveRecapState(answer, "resolved")).toEqual({
			selectedLabels: [],
			customAnswer: "mine",
			showOptions: false,
		});
	});
});

describe("splitRecommended", () => {
	it("strips a trailing (Recommended) marker and flags it", () => {
		expect(splitRecommended("Postgres (Recommended)")).toEqual({
			text: "Postgres",
			recommended: true,
		});
		expect(splitRecommended("postgres (recommended)")).toEqual({
			text: "postgres",
			recommended: true,
		});
	});
	it("leaves a plain label untouched", () => {
		expect(splitRecommended("MySQL")).toEqual({ text: "MySQL", recommended: false });
	});
});

describe("readRecommendation", () => {
	it("suffix only → recommended, no reason", () => {
		expect(readRecommendation({ label: "Postgres (Recommended)" })).toEqual({
			text: "Postgres",
			recommended: true,
			reason: undefined,
		});
	});
	it("suffix + reason → recommended with a trimmed reason", () => {
		expect(
			readRecommendation({ label: "Postgres (Recommended)", recommendedReason: "  scales best  " }),
		).toEqual({ text: "Postgres", recommended: true, reason: "scales best" });
	});
	it("reason WITHOUT the suffix still implies recommended (defensive)", () => {
		expect(readRecommendation({ label: "Postgres", recommendedReason: "scales best" })).toEqual({
			text: "Postgres",
			recommended: true,
			reason: "scales best",
		});
	});
	it("neither → not recommended", () => {
		expect(readRecommendation({ label: "MySQL" })).toEqual({
			text: "MySQL",
			recommended: false,
			reason: undefined,
		});
	});
	it("a whitespace-only reason is ignored (no icon, suffix decides)", () => {
		expect(readRecommendation({ label: "MySQL", recommendedReason: "   " })).toEqual({
			text: "MySQL",
			recommended: false,
			reason: undefined,
		});
	});
});

describe("readAskResult", () => {
	const result = { answers: [], cancelled: true };
	it("reads from the live tool-result envelope ({ content, details })", () => {
		expect(readAskResult({ content: [{ type: "text", text: "x" }], details: result })).toEqual(
			result,
		);
	});
	it("reads a bare result object (hydrated details)", () => {
		expect(readAskResult(result)).toEqual(result);
	});
	it("returns null for shapes without a questionnaire result", () => {
		expect(readAskResult({ content: [{ type: "text", text: "x" }] })).toBeNull();
		expect(readAskResult("nope")).toBeNull();
		expect(readAskResult(null)).toBeNull();
	});
});
