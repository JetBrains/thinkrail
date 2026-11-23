import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import defaultFactory, {
	createNextStepsExtension,
	createSuggestNextStepsTool,
	DEFAULT_DESCRIPTION,
	DEFAULT_PROMPT_GUIDELINES,
	MAX_SHORTCUTS,
	NEXT_STEPS_TOOL_NAME,
	normalizeSuggestions,
	suggestionsOnBranch,
} from "./index.ts";
import { WRITE_ANSWER_TEXT } from "./src/extension.ts";
import { renderNextStepsResult, SuggestionRow, shortcutLabel } from "./src/tui.ts";

type ExecResult = {
	content: Array<{ type: string; text: string }>;
	details: { suggestions: string[]; refused?: true };
	terminate?: boolean;
};
type Handler = (event: Record<string, unknown>, ctx: FakeContext) => void;
type WidgetFactory = (tui: unknown, theme: Theme) => { render(width: number): string[] };

interface FakeContext {
	mode: "tui" | "rpc";
	hasUI: boolean;
	sessionManager: { getBranch(): SessionEntry[] };
	ui: { setWidget(key: string, content: WidgetFactory | undefined): void };
}

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as Theme;

function load() {
	const handlers = new Map<string, Handler>();
	const shortcuts = new Map<string, (ctx: FakeContext) => void>();
	const sent: string[] = [];
	let tool:
		| {
				name: string;
				execute: (
					id: string,
					params: unknown,
					signal?: undefined,
					onUpdate?: undefined,
					ctx?: { sessionManager: { getBranch(): SessionEntry[] } },
				) => Promise<ExecResult>;
		  }
		| undefined;
	const pi = {
		registerTool: (definition: typeof tool) => {
			tool = definition;
		},
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerShortcut: (key: string, options: { handler: (ctx: FakeContext) => void }) =>
			shortcuts.set(key, options.handler),
		sendUserMessage: (text: string) => sent.push(text),
	};
	createNextStepsExtension()(pi as unknown as ExtensionAPI);
	if (!tool) throw new Error("no tool registered");
	return { tool, handlers, shortcuts, sent };
}

function leaf(suggestions: string[], overrides: Record<string, unknown> = {}): SessionEntry {
	return {
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: "",
		message: {
			role: "toolResult",
			toolCallId: "c1",
			toolName: NEXT_STEPS_TOOL_NAME,
			content: [],
			details: { suggestions },
			isError: false,
			timestamp: 0,
			...overrides,
		},
	} as SessionEntry;
}

function context(mode: "tui" | "rpc", entry: SessionEntry | undefined) {
	const widgets: Array<WidgetFactory | undefined> = [];
	const ctx: FakeContext = {
		mode,
		hasUI: true,
		sessionManager: { getBranch: () => (entry ? [entry] : []) },
		ui: { setWidget: (_key, content) => widgets.push(content) },
	};
	return { ctx, widgets };
}

describe("suggest_next_steps tool", () => {
	test("the default export is a ready factory", () => {
		expect(typeof defaultFactory).toBe("function");
	});

	test("normalizes suggestions and asks for the final message instead of ending the turn", async () => {
		const { tool } = load();
		const result = await tool.execute("c1", {
			suggestions: ["  Run the   e2e suite ", "", "run the e2e suite", "Open a PR"],
		});
		expect(result.details).toEqual({ suggestions: ["Run the e2e suite", "Open a PR"] });
		expect(result.terminate).toBe(false);
		expect(result.content[0]?.text).toEndWith(WRITE_ANSWER_TEXT);
	});

	test("blank suggestions still ask for the final message", async () => {
		const { tool } = load();
		const result = await tool.execute("c1", { suggestions: ["  "] });
		expect([result.details, result.terminate]).toEqual([{ suggestions: [] }, false]);
		expect(result.content[0]?.text).toBe(`No usable suggestions were given. ${WRITE_ANSWER_TEXT}`);
	});

	test("the guidance puts the final message after the call", () => {
		expect(DEFAULT_PROMPT_GUIDELINES[0]).toContain("call suggest_next_steps alone, then write");
		expect(DEFAULT_PROMPT_GUIDELINES[0]).toContain("Write none of that message before the call");
	});

	test("an embedder's guidance replaces only what it names", () => {
		const fallback = createSuggestNextStepsTool();
		expect([fallback.description, fallback.promptGuidelines]).toEqual([
			DEFAULT_DESCRIPTION,
			[...DEFAULT_PROMPT_GUIDELINES],
		]);
		const custom = createSuggestNextStepsTool({ guidance: { promptGuidelines: ["Host rule."] } });
		expect([custom.description, custom.promptGuidelines]).toEqual([
			DEFAULT_DESCRIPTION,
			["Host rule."],
		]);
	});

	test("normalizeSuggestions drops non-strings", () => {
		expect(normalizeSuggestions(["a", 3, null, " b "])).toEqual(["a", "b"]);
	});

	test("normalizeSuggestions keeps the first nine distinct suggestions, one per shortcut", () => {
		const twelve = Array.from({ length: 12 }, (_, index) => `Step ${index + 1}`);
		expect(normalizeSuggestions(["Step 1", ...twelve])).toEqual(twelve.slice(0, MAX_SHORTCUTS));
	});
});

describe("legacy refused results", () => {
	test("a result refused by 0.1.0 still renders as a request for the answer", () => {
		const component = renderNextStepsResult(
			{ content: [], details: { suggestions: [], refused: true } },
			plainTheme,
		);
		expect(component.render(80).join("\n")).toContain("Asked for the answer as text first.");
	});
});

function finalMessage(overrides: Record<string, unknown> = {}): SessionEntry {
	return {
		type: "message",
		id: "a2",
		parentId: "e1",
		timestamp: "",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Fixed: the parser now skips blanks." }],
			stopReason: "stop",
			timestamp: 3,
			...overrides,
		},
	} as SessionEntry;
}

describe("suggestionsOnBranch", () => {
	test("reads only a successful suggest_next_steps result", () => {
		expect(suggestionsOnBranch([leaf(["Open a PR"])])).toEqual(["Open a PR"]);
		expect(suggestionsOnBranch([leaf(["Open a PR"], { isError: true })])).toEqual([]);
		expect(suggestionsOnBranch([leaf(["Open a PR"], { toolName: "read" })])).toEqual([]);
		expect(suggestionsOnBranch([])).toEqual([]);
	});

	test("skips bookkeeping entries pi appends after the turn, but not later conversation", () => {
		const thinking = {
			type: "thinking_level_change",
			id: "t",
			parentId: "e1",
			timestamp: "",
			thinkingLevel: "off",
		};
		const later = { ...leaf([]), message: { role: "user", content: "next", timestamp: 4 } };
		expect(suggestionsOnBranch([leaf(["Open a PR"]), thinking as SessionEntry])).toEqual([
			"Open a PR",
		]);
		expect(suggestionsOnBranch([leaf(["Open a PR"]), later as SessionEntry])).toEqual([]);
	});

	test("reads through the final text message written after the call", () => {
		expect(suggestionsOnBranch([leaf(["Open a PR"]), finalMessage()])).toEqual(["Open a PR"]);
	});

	test("a later tool call or an unfinished final message hides the suggestions", () => {
		const working = finalMessage({
			content: [{ type: "toolCall", id: "c2", name: "read", arguments: {} }],
			stopReason: "toolUse",
		});
		expect(suggestionsOnBranch([leaf(["Open a PR"]), working])).toEqual([]);
		expect(
			suggestionsOnBranch([leaf(["Open a PR"]), finalMessage({ stopReason: "error" })]),
		).toEqual([]);
		expect(suggestionsOnBranch([finalMessage()])).toEqual([]);
	});
});

describe("terminal suggestion row", () => {
	test("a settled turn ending in suggestions shows the row; Alt+N sends and clears it", () => {
		const { handlers, shortcuts, sent } = load();
		const { ctx, widgets } = context("tui", leaf(["Run the e2e suite", "Open a PR"]));
		handlers.get("agent_settled")?.({ aborted: false }, ctx);
		const row = widgets.at(-1)?.(undefined, plainTheme).render(200) ?? [];
		expect(row.join("\n")).toContain("Run the e2e suite");
		expect(row.join("\n")).toContain("Open a PR");

		shortcuts.get("alt+2")?.(ctx);
		expect(sent).toEqual(["Open a PR"]);
		expect(widgets.at(-1)).toBeUndefined();
		shortcuts.get("alt+1")?.(ctx);
		expect(sent).toEqual(["Open a PR"]);
	});

	test("the next run clears the row, and an aborted run never shows one", () => {
		const { handlers, shortcuts, sent } = load();
		const { ctx, widgets } = context("tui", leaf(["Open a PR"]));
		handlers.get("agent_settled")?.({ aborted: false }, ctx);
		handlers.get("agent_start")?.({}, ctx);
		expect(widgets.at(-1)).toBeUndefined();
		shortcuts.get("alt+1")?.(ctx);
		expect(sent).toEqual([]);

		const aborted = context("tui", leaf(["Open a PR"]));
		handlers.get("agent_settled")?.({ aborted: true }, aborted.ctx);
		expect(aborted.widgets).toEqual([]);
	});

	test("a resumed session whose leaf holds suggestions shows the row again", () => {
		const { handlers } = load();
		const { ctx, widgets } = context("tui", leaf(["Open a PR"]));
		handlers.get("session_start")?.({ reason: "resume" }, ctx);
		expect(widgets).toHaveLength(1);
	});

	test("non-terminal hosts never get the row or working shortcuts", () => {
		const { handlers, shortcuts, sent } = load();
		const { ctx, widgets } = context("rpc", leaf(["Open a PR"]));
		handlers.get("agent_settled")?.({ aborted: false }, ctx);
		shortcuts.get("alt+1")?.(ctx);
		expect(widgets).toEqual([]);
		expect(sent).toEqual([]);
	});

	test("the row wraps chips to the width and labels keys per platform", () => {
		const lines = new SuggestionRow(["Run the e2e suite", "Open a PR"], plainTheme, "linux").render(
			24,
		);
		expect(lines).toEqual([" Alt+1 Run the e2e suite", " Alt+2 Open a PR"]);
		expect(shortcutLabel(0, "darwin")).toBe("⌥1");
	});

	test("the result lists suggestions numbered", () => {
		const component = renderNextStepsResult(
			{ content: [], details: { suggestions: ["Run the tests", "Open a PR"] } },
			plainTheme,
		);
		expect(component.render(80).join("\n")).toContain("2. Open a PR");
	});
});
