import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatRow } from "./rows";
import { ChatTurnView } from "./turns";

const tool = (id: string, toolName: string) => ({
	kind: "tool" as const,
	id,
	toolCallId: id,
	toolName,
	args: {},
	tool: undefined,
	dead: false,
	streaming: false,
});

describe("ThinkingGroup", () => {
	test("renders a collapsed Thinking disclosure that counts its child tools", () => {
		const row: ChatRow = {
			kind: "thinking",
			id: "a1:thinking:0",
			thought: {
				kind: "thinking",
				id: "a1:thinking:0",
				text: "I should inspect the files first.",
				streaming: false,
			},
			tools: [tool("t1", "read"), tool("t2", "bash")],
			live: false,
		};

		const markup = renderToStaticMarkup(<ChatTurnView row={row} />);

		expect(markup).toContain('data-testid="thinking-group"');
		expect(markup).toContain("Thinking");
		expect(markup).toContain("2 steps · read, bash");
		expect(markup).not.toContain("I should inspect the files first.");
	});
});
