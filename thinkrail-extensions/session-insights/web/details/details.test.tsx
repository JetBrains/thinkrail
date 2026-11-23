import { describe, expect, test } from "bun:test";
import type { PanelHost, PanelToolCall } from "@thinkrail/extension-api/web";
import type { EventBody } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { llm, sampleEvents, T0, tool, turn } from "../trace/events.test";
import { TraceModel } from "../trace/model";
import { chatTargetOf, DetailsPanel, TabBody } from "./DetailsPanel";
import { initialTab, RENDERED_TOOLS, tabsFor } from "./tabs";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function fakeHost(rendered: PanelToolCall[] = []): PanelHost {
	return {
		query: () => new Promise(() => {}),
		openChat: () => {},
		openPanel: () => {},
		renderToolCall: (call) => {
			rendered.push(call);
			return <div data-testid="host-rendered">{call.toolName}</div>;
		},
		openFile: () => {},
		scope: { workspaceId: "w1", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: 11,
	};
}

describe("detail tabs", () => {
	test("adapt to the row kind", () => {
		expect(tabsFor(turn("u", 1, T0))).toEqual(["prompt", "raw"]);
		expect(tabsFor(llm("a", "u", T0, T0 + 1))).toEqual(["reply", "raw"]);
		expect(tabsFor(tool("t", "a", T0, T0 + 1))).toEqual(["input", "result", "raw"]);
		expect(RENDERED_TOOLS.has("edit")).toBe(true);
		expect(RENDERED_TOOLS.has("spec_get")).toBe(false);
	});

	test("open on a failing call's result, else on the last tab the kind has, else the first", () => {
		expect(initialTab(tool("t", "a", T0, T0 + 1, { error: true }), null)).toBe("result");
		expect(initialTab(tool("t", "a", T0, T0 + 1, { error: true }), "input")).toBe("input");
		expect(initialTab(llm("a", "u", T0, T0 + 1), "input")).toBe("reply");
		expect(initialTab(turn("u", 1, T0), "raw")).toBe("raw");
	});
});

const BASH: EventBody = {
	kind: "tool",
	tool: "bash",
	toolCallId: "call-1",
	input: { value: { command: "bun test retry" }, cuts: [] },
	result: { text: "head\nTAIL", chars: 9000, cut: { at: 5, chars: 8991, lines: 120 } },
	error: { text: "head", chars: 9000 },
	details: { value: { exitCode: 1 }, cuts: [] },
	raw: [
		{ value: { type: "toolCall", id: "call-1" }, cuts: [] },
		{ value: { type: "message" }, cuts: [] },
	],
};

describe("tab bodies", () => {
	const model = new TraceModel(sampleEvents());
	const failing = tool("t1", "a1", T0, T0 + 3_000, { error: true, exit: "1" });

	test("a tool's input goes through the chat's renderer where it fits", () => {
		const rendered: PanelToolCall[] = [];
		const markup = html(
			<TabBody
				sessionId="s"
				host={fakeHost(rendered)}
				tab="input"
				event={failing}
				body={BASH}
				query=""
				model={model}
				onSelect={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="host-rendered"');
		expect(rendered).toEqual([
			{
				toolCallId: "call-1",
				toolName: "bash",
				args: { command: "bun test retry" },
				result: { content: [{ type: "text", text: "head\nTAIL" }], details: { exitCode: 1 } },
				status: "error",
			},
		]);
	});

	test("a tool without a fitting renderer shows its arguments in the JSON viewer", () => {
		const spec = tool("t9", "a1", T0, T0 + 1, { tool: "spec_get", family: "planning" });
		const markup = html(
			<TabBody
				sessionId="s"
				host={fakeHost()}
				tab="input"
				event={spec}
				body={{ ...BASH, tool: "spec_get" }}
				query=""
				model={model}
				onSelect={() => {}}
			/>,
		);
		expect(markup).not.toContain('data-testid="host-rendered"');
		expect(markup).toContain('data-testid="details-input"');
	});

	test("a failing result reads as error output with the cut marked and its original size", () => {
		const markup = html(
			<TabBody
				sessionId="s"
				host={fakeHost()}
				tab="result"
				event={failing}
				body={BASH}
				query="TAIL"
				model={model}
				onSelect={() => {}}
			/>,
		);
		const plain = text(markup);
		expect(plain).toContain("Error output");
		expect(plain).toContain("Cut when read: 9 of 9,000 characters shown");
		expect(plain).toContain("120 lines · 8,991 characters omitted");
		expect(markup).toContain("text-feedback-error");
		expect(markup).toContain("<mark");
		expect(markup).toContain('data-testid="details-result-details"');
	});

	test("a model reply shows the usage pi recorded, encrypted thinking and the calls it made", () => {
		const body: EventBody = {
			kind: "llm",
			model: "anthropic/claude-test",
			stop: "toolUse",
			requestedAt: T0,
			reply: { text: "Running the tests.", chars: 18 },
			encryptedThinking: 2,
			usage: {
				input: 10,
				output: 20,
				cacheRead: 300,
				cacheWrite: 40,
				context: 350,
				reasoning: 5,
				cost: 0.25,
			},
			issued: [{ toolCallId: "call-t1", name: "bash", eventId: "t1" }],
			raw: [{ value: {}, cuts: [] }],
		};
		const call = llm("a1", "u1", T0, T0 + 4_000);
		const plain = text(
			html(
				<TabBody
					sessionId="s"
					host={fakeHost()}
					tab="reply"
					event={call}
					body={body}
					query=""
					model={model}
					onSelect={() => {}}
				/>,
			),
		);
		expect(plain).toContain("Running the tests.");
		expect(plain).toContain("2 thinking blocks are encrypted by the provider");
		expect(plain).toContain("Context of the call 350");
		expect(plain).toContain("Of which reasoning 5");
		expect(plain).toContain("$0.25");
		expect(plain).toContain("message[assistant].usage");
		expect(plain).toContain("Tool calls it made");
	});

	test("the raw tab shows every entry behind the event with the redaction note", () => {
		const markup = html(
			<TabBody
				sessionId="s"
				host={fakeHost()}
				tab="raw"
				event={failing}
				body={BASH}
				query=""
				model={model}
				onSelect={() => {}}
			/>,
		);
		expect(markup.match(/data-testid="details-raw"/g)).toHaveLength(2);
		expect(text(markup)).toContain("your home folder reads ~");
	});
});

describe("the details panel", () => {
	test("shows the selected row's header, path and actions while its body loads", () => {
		const model = new TraceModel(sampleEvents());
		const markup = html(
			<DetailsPanel
				host={fakeHost()}
				sessionId="s1"
				model={model}
				index={3}
				overview={null}
				query=""
				onSelect={() => {}}
				onZoom={() => {}}
				tabsRef={{ current: null }}
			/>,
		);
		const plain = text(markup);
		expect(markup).toContain('data-event-id="t1"');
		expect(plain).toContain("bash");
		expect(plain).toContain("failed");
		expect(plain).toContain("Session › #1 › claude-test › bash");
		expect(markup).toMatch(/aria-selected="true"[^>]*data-testid="details-tab-result"/);
		expect(markup).toMatch(/data-testid="details-open-chat"[^>]*disabled/);
		expect(plain).toContain("What happened next");
	});

	test("opens the chat only where the session's workspace is open", () => {
		expect(chatTargetOf(null)).toBeNull();
	});
});
