import { expect, test } from "bun:test";
import askUserQuestion, { AskUserQuestionCard } from "@thinkrail/ext-ask-user-question/web";
import visualize, { MermaidView } from "@thinkrail/ext-visualize/web";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	DefaultToolRenderer,
	getToolChrome,
	getToolRenderer,
	getToolSummary,
	resolveProminence,
} from "../chat/toolRegistry";
import { registerWebExtensions, webExtensions } from "./index";

const props: ToolRenderProps = {
	toolCallId: "diagram-1",
	toolName: "visualize",
	args: {},
	result: null,
	status: "done",
	streaming: false,
};

test("the ordered web registry composes the public visualize descriptor without replacing fallback", () => {
	expect(webExtensions).toEqual([visualize, askUserQuestion]);
	expect(typeof MermaidView).toBe("function");
	for (let i = 0; i < 2; i++) {
		registerWebExtensions();
		expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
		expect(resolveProminence("visualize")).toEqual({
			prominence: "primary",
			defaultExpanded: true,
		});
		expect(getToolChrome("visualize")).toBe("card");
		expect(getToolRenderer("unregistered-extension-tool")).toBe(DefaultToolRenderer);
	}
});

test("visualize summaries preserve titles and diagram/comparison fallbacks", () => {
	registerWebExtensions();
	for (const [args, summary] of [
		[{}, "diagram"],
		[{ type: "diagram", title: "Architecture" }, "Architecture"],
		[{ type: "comparison" }, "comparison — 0 options"],
		[{ type: "comparison", options: [{ name: "One" }] }, "comparison — 1 option"],
		[{ type: "comparison", options: [{ name: "One" }, { name: "Two" }] }, "comparison — 2 options"],
		[{ type: "comparison", title: "Trade-offs" }, "Trade-offs"],
	] as const) {
		expect(getToolSummary(currentTranslator(), "visualize", { ...props, args })).toBe(summary);
	}
});

test("the ask_user_question card registers bare from its extension, the same one the plan page renders", () => {
	registerWebExtensions();
	expect(getToolRenderer("ask_user_question")).toBe(AskUserQuestionCard);
	expect(askUserQuestion.toolRenderers.ask_user_question.renderer).toBe(AskUserQuestionCard);
	expect(getToolChrome("ask_user_question")).toBe("bare");
});
