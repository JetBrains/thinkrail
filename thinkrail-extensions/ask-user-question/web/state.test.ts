import { describe, expect, it } from "bun:test";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from "@thinkrail/pi-ask-user-question/core";
import { localKeys } from "@thinkrail/ui/local-keys";
import { CARD_COMMANDS, CARD_KEYS, CARD_SCOPE } from "./keys";
import {
	choiceKeyAction,
	customTextPatch,
	deriveAnswer,
	deriveAnswers,
	deriveRecapState,
	discussReasonPatch,
	emptyQState,
	fieldKeyAction,
	footKeyAction,
	nudgeShowsOnPage,
	openNotePatch,
	paneOptionIndex,
	parseQuestions,
	type QState,
	questionPageForKey,
	readRecommendation,
	selectOptionPatch,
	splitRecommended,
	toggleCustomPatch,
	toggleMultiPatch,
} from "./state";

const q = (over: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem => ({
	question: "Which?",
	header: "H",
	options: [
		{ label: "A", description: "a" },
		{ label: "B", description: "b" },
	],
	...over,
});

const state = (over: Partial<QState> = {}): QState => ({ ...emptyQState(), ...over });

describe("parseQuestions", () => {
	it("reads a well-formed questions array", () => {
		expect(parseQuestions({ questions: [q()] })).toHaveLength(1);
	});
	it("returns [] for missing / malformed args (defensive)", () => {
		expect(parseQuestions({})).toEqual([]);
		expect(parseQuestions({ questions: "nope" })).toEqual([]);
		expect(parseQuestions({ questions: [{ question: "x" }] })).toEqual([]);
	});
});

const keys = localKeys(
	{ platform: "Linux x86_64", scopes: new Map(), isTextEntry: () => false },
	CARD_SCOPE,
	CARD_COMMANDS,
);
const typed = (code: string, key: string, shiftKey = false) => ({
	code,
	key,
	shiftKey,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	isComposing: false,
	keyCode: 0,
	target: null,
});
const row = (event: ReturnType<typeof typed>, index = 0, count = 6, other = 3) =>
	choiceKeyAction(event.key, keys.match(event), index, count, other);

describe("keyboard interaction", () => {
	it("arrows only move: they wrap through the options, Other, Skip and the primary button", () => {
		const count = 6;
		const other = 3;
		expect(choiceKeyAction("ArrowDown", null, 2, count, other)).toEqual({ type: "move", index: 3 });
		expect(choiceKeyAction("ArrowDown", null, 3, count, other)).toEqual({ type: "move", index: 4 });
		expect(choiceKeyAction("ArrowDown", null, 4, count, other)).toEqual({ type: "move", index: 5 });
		expect(choiceKeyAction("ArrowDown", null, 5, count, other)).toEqual({ type: "move", index: 0 });
		expect(choiceKeyAction("ArrowUp", null, 0, count, other)).toEqual({ type: "move", index: 5 });
		expect(choiceKeyAction("Home", null, 3, count, other)).toEqual({ type: "move", index: 0 });
		expect(choiceKeyAction("End", null, 0, count, other)).toEqual({ type: "move", index: other });
	});

	it("skips a primary button that cannot be pressed but always reaches Skip", () => {
		expect(choiceKeyAction("ArrowDown", null, 3, 5, 3)).toEqual({ type: "move", index: 4 });
		expect(choiceKeyAction("ArrowDown", null, 4, 5, 3)).toEqual({ type: "move", index: 0 });
		expect(choiceKeyAction("ArrowUp", null, 0, 5, 3)).toEqual({ type: "move", index: 4 });
	});

	it("Enter picks and Space opens the note; other letters and digits stay free", () => {
		expect(row(typed("Enter", "Enter"))).toEqual({ type: "select" });
		expect(row(typed("Space", " "))).toEqual({ type: "note" });
		expect(row(typed("KeyN", "n"))).toEqual({ type: "none" });
		expect(row(typed("Digit1", "1"))).toEqual({ type: "none" });
	});

	it("d, i and c act by physical key on any layout, never with Shift", () => {
		expect(row(typed("KeyD", "d"))).toEqual({ type: "discuss" });
		expect(row(typed("KeyD", "в"))).toEqual({ type: "discuss" });
		expect(row(typed("KeyI", "ш"))).toEqual({ type: "interact" });
		expect(row(typed("KeyC", "с"))).toEqual({ type: "compare" });
		expect(row(typed("KeyD", "D", true))).toEqual({ type: "none" });
		expect(row(typed("KeyS", "d"))).toEqual({ type: "none" });
	});

	it("a rebound letter replaces its default", () => {
		const rebound = localKeys(
			{
				platform: "Linux x86_64",
				scopes: new Map([
					[CARD_SCOPE, [{ id: CARD_KEYS.discuss, chord: { code: "KeyX", key: "X" } }]],
				]),
				isTextEntry: () => false,
			},
			CARD_SCOPE,
			CARD_COMMANDS,
		);
		const action = (event: ReturnType<typeof typed>) =>
			choiceKeyAction(event.key, rebound.match(event), 0, 6, 3);
		expect(action(typed("KeyX", "x"))).toEqual({ type: "discuss" });
		expect(action(typed("KeyD", "d"))).toEqual({ type: "none" });
	});

	it("on Skip and the primary button, ↑/↓ continue the ring and ←/→ move between the two", () => {
		expect(footKeyAction("ArrowUp", "skip", true)).toBe("other");
		expect(footKeyAction("ArrowDown", "skip", true)).toBe("primary");
		expect(footKeyAction("ArrowDown", "skip", false)).toBe("first");
		expect(footKeyAction("ArrowRight", "skip", true)).toBe("primary");
		expect(footKeyAction("ArrowRight", "skip", false)).toBe("stay");
		expect(footKeyAction("ArrowLeft", "skip", true)).toBe("stay");
		expect(footKeyAction("ArrowUp", "primary", true)).toBe("skip");
		expect(footKeyAction("ArrowLeft", "primary", true)).toBe("skip");
		expect(footKeyAction("ArrowDown", "primary", true)).toBe("first");
		expect(footKeyAction("ArrowRight", "primary", true)).toBe("stay");
		expect(footKeyAction("Enter", "skip", true)).toBeNull();
	});

	it("clamps Left/Right to the question pages; Home/End jump only on the tabs", () => {
		expect(questionPageForKey("ArrowLeft", 0, 2)).toBe(0);
		expect(questionPageForKey("ArrowRight", 0, 2)).toBe(1);
		expect(questionPageForKey("ArrowRight", 2, 2)).toBe(2);
		expect(questionPageForKey("ArrowDown", 1, 2)).toBeNull();
		expect(questionPageForKey("Home", 1, 2)).toBeNull();
		expect(questionPageForKey("Home", 1, 2, true)).toBe(0);
		expect(questionPageForKey("End", 1, 2, true)).toBe(2);
	});

	const key = (
		k: string,
		mods: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {},
	) => ({
		key: k,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...mods,
	});

	it("a field finishes on plain Enter or Escape and keeps Shift+Enter and the submit chord", () => {
		expect(fieldKeyAction(key("Enter"), false)).toBe("finish");
		expect(fieldKeyAction(key("Escape"), false)).toBe("finish");
		expect(fieldKeyAction(key("Enter", { shiftKey: true }), false)).toBe("none");
		expect(fieldKeyAction(key("Enter", { metaKey: true }), false)).toBe("none");
		expect(fieldKeyAction(key("Enter", { ctrlKey: true }), false)).toBe("none");
	});

	it("closes the note on Shift+Escape rather than letting it skip the questionnaire", () => {
		expect(fieldKeyAction(key("Escape", { shiftKey: true }), false)).toBe("finish");
	});

	it("keeps Escape inside the editor mid-composition — consumed, not finished, and never bubbled", () => {
		expect(fieldKeyAction(key("Escape", { shiftKey: true }), true)).toBe("consume");
		expect(fieldKeyAction(key("Escape"), true)).toBe("consume");
		expect(fieldKeyAction(key("Enter"), true)).toBe("none");
	});

	it("the submit and skip chords match on the main and the numpad Enter, per platform", () => {
		const chord = (
			code: string,
			mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey", boolean>>,
		) => ({
			...typed(code, code === "Escape" ? "Escape" : "Enter"),
			...mods,
		});
		expect(keys.match(chord("Enter", { ctrlKey: true }))).toBe(CARD_KEYS.submit);
		expect(keys.match(chord("NumpadEnter", { ctrlKey: true }))).toBe(CARD_KEYS.submit);
		expect(keys.match(chord("Enter", { metaKey: true }))).toBeNull();
		expect(keys.match(chord("Escape", { shiftKey: true }))).toBe(CARD_KEYS.skip);
		expect(keys.aria(CARD_KEYS.submit, CARD_KEYS.skip)).toBe("Control+Enter Shift+Escape");
		const mac = localKeys(
			{ platform: "MacIntel", scopes: new Map(), isTextEntry: () => false },
			CARD_SCOPE,
			CARD_COMMANDS,
		);
		expect(mac.match(chord("NumpadEnter", { metaKey: true }))).toBe(CARD_KEYS.submit);
		expect(mac.aria(CARD_KEYS.submit)).toBe("Meta+Enter");
	});
});

describe("openNotePatch", () => {
	it("single-select: picks the option (carrying the question's note) and opens its editor", () => {
		expect(openNotePatch(state({ option: "A", notes: { A: "why" } }), false, "B", 1)).toEqual({
			cursor: 1,
			option: "B",
			customActive: false,
			notes: { B: "why" },
			noteFor: "B",
		});
	});

	it("multi-select: checks an unchecked option, keeps a checked one, and cancels Discuss", () => {
		expect(openNotePatch(state({ multi: ["A"] }), true, "B", 1)).toEqual({
			cursor: 1,
			noteFor: "B",
			multi: ["A", "B"],
		});
		expect(openNotePatch(state({ multi: ["A"], discuss: true }), true, "A", 0)).toEqual({
			cursor: 0,
			noteFor: "A",
			discuss: false,
		});
	});
});

describe("paneOptionIndex", () => {
	const question = q({
		options: [
			{ label: "A", description: "a", preview: "a" },
			{ label: "B", description: "b" },
		],
	});
	it("shows the option under the cursor, whatever is picked", () => {
		expect(paneOptionIndex(question, state({ option: "A" }), 1)).toBe(1);
	});
	it("on Other or the button it shows the pick, and nothing for an own answer", () => {
		expect(paneOptionIndex(question, state({ option: "A" }), 2)).toBe(0);
		expect(paneOptionIndex(question, state({ option: null }), 2)).toBeNull();
		expect(paneOptionIndex(question, state({ customActive: true, option: "A" }), 2)).toBeNull();
	});
});

describe("nudgeShowsOnPage", () => {
	const nudge = { question: 1, seq: 3 };

	it("shows only on the question that raised it", () => {
		expect(nudgeShowsOnPage(nudge, 1, false)).toBe(true);
		expect(nudgeShowsOnPage(nudge, 0, false)).toBe(false);
		expect(nudgeShowsOnPage(nudge, 2, false)).toBe(false);
	});

	it("clears once that question is answerable", () => {
		expect(nudgeShowsOnPage(nudge, 1, true)).toBe(false);
	});

	it("is absent with no outstanding gesture", () => {
		expect(nudgeShowsOnPage(null, 0, false)).toBe(false);
	});
});

describe("customTextPatch", () => {
	it("typed text claims the answer, taking it off the authored pick and any discuss mark", () => {
		expect(customTextPatch("mine")).toEqual({
			customText: "mine",
			customActive: true,
			option: null,
			discuss: false,
		});
	});

	it("does NOT activate on blank text, so passing through Other keeps the current pick", () => {
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

	it("a file preview is echoed as its path (and the diff's before), never its content", () => {
		const question = q({
			options: [
				{ label: "A", description: "a", previewFile: "mock/a.html" },
				{ label: "B", description: "b", previewFile: "src/b.ts", previewBefore: "src/b.old.ts" },
			],
		});
		expect(deriveAnswer(question, 0, state({ option: "A" }))).toMatchObject({
			previewFile: "mock/a.html",
		});
		const diff = deriveAnswer(question, 0, state({ option: "B" }));
		expect(diff).toMatchObject({ previewFile: "src/b.ts", previewBefore: "src/b.old.ts" });
		expect(diff).not.toHaveProperty("preview");
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

	it("multi-select: each checked option's note joins the answer as a labelled line", () => {
		expect(
			deriveAnswer(
				q({
					multiSelect: true,
					options: [...q().options, { label: "C (Recommended)", description: "c" }],
				}),
				0,
				state({
					multi: ["A", "C (Recommended)"],
					notes: { A: " note a ", B: "unchecked note", "C (Recommended)": "note c" },
				}),
			),
		).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "multi",
			answer: null,
			selected: ["A", "C (Recommended)"],
			notes: "A: note a\nC: note c",
		});
	});

	it("multi-select: blank notes leave the notes field off entirely", () => {
		expect(
			deriveAnswer(q({ multiSelect: true }), 0, state({ multi: ["A"], notes: { A: "   " } })),
		).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "multi",
			answer: null,
			selected: ["A"],
		});
	});

	it("multi-select: an unchecked 'Other' row keeps its text OUT of the answer", () => {
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

describe("deriveAnswers", () => {
	const questions = [q({ question: "First?" }), q({ question: "Second?", multiSelect: true })];

	it("collects only the answerable questions, keyed by their own index", () => {
		expect(deriveAnswers(questions, { 1: state({ multi: ["B"] }) })).toEqual([
			{ questionIndex: 1, question: "Second?", kind: "multi", answer: null, selected: ["B"] },
		]);
	});

	it("treats a missing entry as a fresh state, so a sparse map is never a partial answer", () => {
		expect(deriveAnswers(questions, {})).toEqual([]);
		expect(deriveAnswers(questions, { 0: state({ option: "A" }) })).toHaveLength(1);
	});
});

describe("deriveRecapState", () => {
	const base = { questionIndex: 0, question: "Which?" };

	it("marks nothing for a skipped or discussed question", () => {
		const empty = { selectedLabels: [], customAnswer: null };
		expect(deriveRecapState(undefined)).toEqual(empty);
		expect(deriveRecapState({ ...base, kind: "discuss", answer: null })).toEqual(empty);
	});

	it("marks a single authored option selected", () => {
		const answer: AskUserQuestionAnswer = { ...base, kind: "option", answer: "A" };
		expect(deriveRecapState(answer)).toEqual({ selectedLabels: ["A"], customAnswer: null });
	});

	it("keeps multi selections and additive custom text", () => {
		const answer: AskUserQuestionAnswer = {
			...base,
			kind: "multi",
			answer: "extra",
			selected: ["A", "B"],
		};
		expect(deriveRecapState(answer)).toEqual({ selectedLabels: ["A", "B"], customAnswer: "extra" });
	});

	it("reports a custom answer as the own-answer row", () => {
		const answer: AskUserQuestionAnswer = { ...base, kind: "custom", answer: "mine" };
		expect(deriveRecapState(answer)).toEqual({ selectedLabels: [], customAnswer: "mine" });
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

describe("choice patches", () => {
	it("unchecking the option whose note editor is open closes the editor, keeps the text", () => {
		const s = state({ multi: ["A", "B"], noteFor: "A", notes: { A: "kept" } });
		expect(toggleMultiPatch(s, "A", 0)).toEqual({ cursor: 0, multi: ["B"], noteFor: null });
	});
	it("unchecking another option leaves the open editor alone", () => {
		const s = state({ multi: ["A", "B"], noteFor: "A" });
		expect(toggleMultiPatch(s, "B", 1)).toEqual({ cursor: 1, multi: ["A"] });
	});
	it("checking an option never touches noteFor", () => {
		expect(toggleMultiPatch(state({ multi: [] }), "A", 0)).toEqual({ cursor: 0, multi: ["A"] });
	});
	it("selecting a different single-select option closes a stale open editor and carries the note", () => {
		const s = state({ option: "A", noteFor: "A", notes: { A: "kept" } });
		expect(selectOptionPatch(s, "B", 1)).toEqual({
			cursor: 1,
			option: "B",
			customActive: false,
			notes: { B: "kept" },
			noteFor: null,
		});
	});
	it("a single-select note follows the pick and is sent with it", () => {
		const question = q();
		let s = state({ option: "A", notes: { A: "why" } });
		s = { ...s, ...selectOptionPatch(s, "B", 1) };
		expect(deriveAnswer(question, 0, s)).toMatchObject({ answer: "B", notes: "why" });
	});
	it("a note left behind by an Other answer re-attaches to the next pick", () => {
		const s = state({ option: null, customText: "own", notes: { A: "why" } });
		expect(selectOptionPatch(s, "B", 1).notes).toEqual({ B: "why" });
	});
	it("never overwrites a note the new pick already has", () => {
		const s = state({ option: "A", notes: { A: "first", B: "second" } });
		expect(selectOptionPatch(s, "B", 1).notes).toBeUndefined();
	});
	it("re-selecting the option that owns the open editor keeps it open", () => {
		const s = state({ option: "A", noteFor: "A" });
		expect(selectOptionPatch(s, "A", 0)).toEqual({ cursor: 0, option: "A", customActive: false });
	});
});

describe("discuss first", () => {
	it("is a distinct answer carrying the optional reason and text, never a selection", () => {
		const s = state({
			option: "A",
			discuss: true,
			discussReason: "unclear",
			discussText: " why? ",
		});
		expect(deriveAnswer(q(), 0, s)).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "discuss",
			answer: null,
			reason: "unclear",
			notes: "why?",
		});
		expect(deriveAnswer(q(), 0, state({ discuss: true }))).toEqual({
			questionIndex: 0,
			question: "Which?",
			kind: "discuss",
			answer: null,
		});
	});

	it("a reason marks the question and toggles off when chosen again", () => {
		expect(discussReasonPatch(state(), "context")).toEqual({
			discuss: true,
			discussReason: "context",
		});
		expect(discussReasonPatch(state({ discussReason: "context" }), "context")).toEqual({
			discuss: true,
			discussReason: null,
		});
	});

	it("choosing an option cancels the mark but keeps what was typed for it", () => {
		const s = state({ discuss: true, discussText: "kept" });
		expect(selectOptionPatch(s, "A", 0)).toMatchObject({ discuss: false });
		expect(toggleMultiPatch(s, "A", 0)).toMatchObject({ discuss: false });
		expect(selectOptionPatch(s, "A", 0)).not.toHaveProperty("discussText");
		expect(customTextPatch("")).not.toHaveProperty("discuss");
	});

	it("checking the multi-select own answer cancels the mark; unchecking leaves it", () => {
		const marked = state({ discuss: true, customText: "own" });
		expect(toggleCustomPatch(marked)).toEqual({ customActive: true, discuss: false });
		expect(toggleCustomPatch({ ...marked, customActive: true })).toEqual({ customActive: false });
	});
});
