import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingGroup } from "./ActivityGroup";

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
		const tools = [tool("t1", "read"), tool("t2", "bash")];
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:0"
				parentId="activity:a1"
				thought={{
					kind: "thinking",
					id: "a1:thinking:0",
					text: "I should inspect the files first.",
					streaming: false,
					tools,
				}}
				tools={tools}
				live={false}
			/>,
		);

		expect(markup).toContain('data-testid="thinking-group"');
		expect(markup).toContain('data-activity-node-id="a1:thinking:0"');
		expect(markup).toContain('data-activity-node-kind="thinking"');
		expect(markup).toContain('data-activity-parent-id="activity:a1"');
		expect(markup).toContain("data-activity-node-toggle");
		expect(markup).toContain("Thinking");
		expect(markup).toContain("2 steps · read, bash");
		expect(markup).not.toContain("I should inspect the files first.");
	});
});
