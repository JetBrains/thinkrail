import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskUserQuestionArgs, AskUserQuestionResult } from "@thinkrail-pi/contracts";
import {
	answerQuestion,
	buildQuestionnaireResponse,
	cancelQuestionsForSession,
	createAskUserQuestionTool,
	validateQuestionnaire,
} from "./askUserQuestion";

const args = (over: Partial<AskUserQuestionArgs> = {}): AskUserQuestionArgs => ({
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
	...over,
});

/** Concatenate the text content of a tool result (its content is a `TextContent | ImageContent` union). */
const textOf = (r: { content: { type: string; text?: string }[] }): string =>
	r.content.map((c) => c.text ?? "").join("");

/** A minimal `ExtensionContext` for the tool: only `hasUI` + `sessionManager.getSessionId()` are read. */
const ctx = (sessionId: string, hasUI = true): ExtensionContext =>
	({ hasUI, sessionManager: { getSessionId: () => sessionId } }) as unknown as ExtensionContext;

const run = (
	toolCallId: string,
	sessionId: string,
	signal?: AbortSignal,
	hasUI = true,
	params: AskUserQuestionArgs = args(),
) =>
	createAskUserQuestionTool().execute(
		toolCallId,
		params as never,
		signal,
		undefined,
		ctx(sessionId, hasUI),
	);

test("validateQuestionnaire accepts a well-formed questionnaire", () => {
	expect(validateQuestionnaire(args()).ok).toBe(true);
});

test("validateQuestionnaire rejects empty, too-few-options, dupes, and reserved labels", () => {
	const one = (options: { label: string; description: string }[]): AskUserQuestionArgs => ({
		questions: [{ question: "q", header: "h", options }],
	});
	expect(validateQuestionnaire({ questions: [] }).ok).toBe(false);
	expect(validateQuestionnaire(one([{ label: "only", description: "" }])).ok).toBe(false);
	expect(
		validateQuestionnaire(
			one([
				{ label: "x", description: "" },
				{ label: "x", description: "" },
			]),
		).ok,
	).toBe(false);
	expect(
		validateQuestionnaire(
			one([
				{ label: "Chat about this", description: "" },
				{ label: "ok", description: "" },
			]),
		).ok,
	).toBe(false);
});

test("buildQuestionnaireResponse: cancelled → the canonical decline message", () => {
	const r = buildQuestionnaireResponse({ answers: [], cancelled: true }, args());
	expect(r.content[0]?.text).toBe("User declined to answer questions");
	expect(r.details.cancelled).toBe(true);
});

test("buildQuestionnaireResponse: a partial submission lists the unanswered questions as declined", () => {
	const two: AskUserQuestionArgs = {
		questions: [
			...args().questions,
			{
				question: "Which runtime?",
				header: "Runtime",
				options: [
					{ label: "bun", description: "" },
					{ label: "node", description: "" },
				],
			},
		],
	};
	const r = buildQuestionnaireResponse(
		{
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
		},
		two,
	);
	expect(r.content[0]?.text).toContain('"Which library?"="luxon"');
	expect(r.content[0]?.text).toContain('The user declined to answer: "Which runtime?".');
});

test("buildQuestionnaireResponse: an answer → the envelope with the option + note", () => {
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [
			{
				questionIndex: 0,
				question: "Which library?",
				kind: "option",
				answer: "luxon",
				notes: "for tz",
			},
		],
	};
	const r = buildQuestionnaireResponse(result, args());
	expect(r.content[0]?.text).toContain('"Which library?"="luxon"');
	expect(r.content[0]?.text).toContain("user notes: for tz");
});

test("execute blocks until answerQuestion resolves it, then formats the envelope", async () => {
	const promise = run("tc-1", "s1");
	answerQuestion("s1", "tc-1", {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "date-fns" }],
	});
	const r = await promise;
	expect(textOf(r)).toContain('"Which library?"="date-fns"');
});

test("an answer that arrives BEFORE execute is held and consumed on registration", async () => {
	// The inline card is interactive while the assistant message still streams, so a fast submit can land
	// before the tool call executes. The bridge must hold it — not drop it — or the tool blocks forever.
	answerQuestion("s5", "tc-5", {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	});
	const r = await run("tc-5", "s5");
	expect(textOf(r)).toContain('"Which library?"="luxon"');
});

test("cancelQuestionsForSession drops a held early answer (a disposed session's answer never leaks)", async () => {
	answerQuestion("s6", "tc-6", {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "date-fns" }],
	});
	cancelQuestionsForSession("s6");
	let resolvedEarly = false;
	const promise = run("tc-6", "s6").then((r) => {
		resolvedEarly = true;
		return r;
	});
	await new Promise((r) => setTimeout(r, 0)); // a held answer settles via microtasks — a macrotask flushes them all
	expect(resolvedEarly).toBe(false); // the dropped answer must NOT settle the fresh execute
	answerQuestion("s6", "tc-6", { cancelled: true, answers: [] });
	const r = await promise;
	expect(r.details.cancelled).toBe(true);
});

test("cancelQuestionsForSession settles a blocked execute as declined", async () => {
	const promise = run("tc-2", "s2");
	cancelQuestionsForSession("s2");
	const r = await promise;
	expect(r.details.cancelled).toBe(true);
});

test("a held early answer for a DIFFERENT session is dropped, never delivered", async () => {
	answerQuestion("s-other", "tc-7", {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	});
	let resolvedEarly = false;
	const promise = run("tc-7", "s7").then((r) => {
		resolvedEarly = true;
		return r;
	});
	await new Promise((r) => setTimeout(r, 0));
	expect(resolvedEarly).toBe(false); // the mismatched hold must not settle s7's execute
	answerQuestion("s7", "tc-7", { cancelled: true, answers: [] });
	expect((await promise).details.cancelled).toBe(true);
});

test("held early answers are bounded per session — the oldest is evicted", async () => {
	for (let i = 0; i < 9; i++) answerQuestion("s8", `tc-8-${i}`, { cancelled: true, answers: [] });
	// 9 holds > the cap of 8 → the first one was evicted, so its execute blocks…
	let resolvedEarly = false;
	const evicted = run("tc-8-0", "s8").then((r) => {
		resolvedEarly = true;
		return r;
	});
	await new Promise((r) => setTimeout(r, 0));
	expect(resolvedEarly).toBe(false);
	// …while the newest hold is still there and settles its execute immediately.
	const kept = await run("tc-8-8", "s8");
	expect(kept.details.cancelled).toBe(true);
	answerQuestion("s8", "tc-8-0", { cancelled: true, answers: [] });
	await evicted;
	cancelQuestionsForSession("s8"); // drop the remaining holds so this test leaves no residue
});

test("execute declines when the agent abort signal fires", async () => {
	const controller = new AbortController();
	const promise = run("tc-3", "s3", controller.signal);
	controller.abort();
	const r = await promise;
	expect(r.details.cancelled).toBe(true);
});

test("execute returns the no-UI error when hasUI is false (non-interactive host)", async () => {
	const r = await run("tc-4", "s4", undefined, false);
	expect(textOf(r)).toContain("UI not available");
	expect(r.details.cancelled).toBe(true);
});
